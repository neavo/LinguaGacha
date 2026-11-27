import { remove_additional_files_migration } from "./project/remove-additional-files-migration";
import { empty_asset_file_type_migration } from "./project/empty-asset-file-type-migration";
import type { ProjectDatabaseWrite } from "../database/database-operations";
import type { ProjectOpenMigrationInput } from "./migration-types";
import { EpubRubyBlockTextMigration } from "./project/epub-ruby-block-text-migration";
import { MarkdownV2BlockMigration } from "./project/markdown-v2-block-migration";
import { legacy_pdf_to_generic_migration } from "./project/legacy-pdf-to-generic-migration";
import {
  is_legacy_xlsx_or_trans,
  legacy_xlsx_trans_to_generic_migration,
} from "./project/legacy-xlsx-trans-to-generic-migration";
import {
  normalize_project_asset_path,
  SourceFilePathIndex,
} from "../../shared/project/project-asset-paths";

/** 准备阶段共享打开瞬间事实，所有写入仍由项目生命周期在同一事务提交。 */
export async function build_project_open_writes(
  input: ProjectOpenMigrationInput,
): Promise<ProjectDatabaseWrite[]> {
  const snapshot = await input.database.read(input.project_path, (reader) => {
    const meta = reader.get_all_meta(input.project_path);
    const assets = reader.get_all_asset_records(input.project_path);
    const legacy_xlsx_trans = assets.filter(is_legacy_xlsx_or_trans);
    const has_epub = assets.some((asset) => asset.file_type === "EPUB");
    const has_markdown = assets.some((asset) => asset.file_type === "MD");
    // 只有文本格式迁移需要扫描条目，普通工程留到打开事务内读取。
    const items =
      has_epub || has_markdown || legacy_xlsx_trans.length > 0
        ? reader.get_all_items(input.project_path)
        : [];
    const legacy_pdf = reader.read_legacy_pdf(
      input.project_path,
      assets.filter((asset) => asset.file_type === "PDF").map((asset) => asset.path),
    );
    return { meta, assets, items, legacy_pdf, legacy_xlsx_trans, has_epub, has_markdown };
  });
  const { meta, assets, items, legacy_pdf, legacy_xlsx_trans, has_epub, has_markdown } = snapshot;
  const context = { ...input, meta, assets };
  const writes: ProjectDatabaseWrite[] = [];
  if (has_epub) {
    writes.push(
      ...(await new EpubRubyBlockTextMigration(input.database).build_writes(
        input.project_path,
        items,
      )),
    );
  }
  if (has_markdown) {
    writes.push(...new MarkdownV2BlockMigration().build_writes(input.project_path, items));
  }
  writes.push(...(await empty_asset_file_type_migration(context)));
  writes.push(...(await remove_additional_files_migration(context)));
  const paths = new SourceFilePathIndex(); // 通用包同时避让现有资产与游戏独占的输出目录。
  if (legacy_pdf.documents.length > 0 || legacy_xlsx_trans.length > 0) {
    for (const { path, file_type } of assets) paths.reserve(path, file_type);
  }
  const allocate_path = (file_path: string) => allocate_generic_asset_path(paths, file_path);
  writes.push(...(await legacy_pdf_to_generic_migration(context, legacy_pdf, allocate_path)));
  writes.push(
    ...(await legacy_xlsx_trans_to_generic_migration(
      input,
      legacy_xlsx_trans,
      items,
      allocate_path,
    )),
  );
  return writes;
}

/** 旧工程可能已有多层路径重叠，逐次在冲突层级改名，并为同批迁移保留结果。 */
function allocate_generic_asset_path(paths: SourceFilePathIndex, file_path: string): string {
  const parts = normalize_project_asset_path(file_path).split("/");
  const names = [...parts];
  const suffixes = new Map<number, number>();
  for (;;) {
    const next = names.join("/") + ".generic";
    const conflict = paths.find_conflict(next);
    if (conflict === null) {
      paths.reserve(next);
      return next;
    }
    const index = conflict.split("/").length - 1;
    const suffix = (suffixes.get(index) ?? 1) + 1;
    suffixes.set(index, suffix);
    names[index] = `${parts[index]}_${suffix}`;
  }
}
