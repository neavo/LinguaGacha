import { empty_asset_file_type_migration } from "./project/empty-asset-file-type-migration";
import type { ProjectDatabaseWrite } from "../database/database-operations";
import type { ProjectOpenMigrationInput } from "./migration-types";
import { EpubRubyBlockTextMigration } from "./project/epub-ruby-block-text-migration";
import { MarkdownV2BlockMigration } from "./project/markdown-v2-block-migration";

/** 准备阶段共享打开瞬间事实，所有写入仍由项目生命周期在同一事务提交。 */
export async function build_project_open_writes(
  input: ProjectOpenMigrationInput,
): Promise<ProjectDatabaseWrite[]> {
  const snapshot = await input.database.read(input.project_path, (reader) => {
    const meta = reader.get_all_meta(input.project_path);
    const assets = reader.get_all_asset_records(input.project_path);
    // 只有文本格式迁移需要扫描条目，普通工程留到打开事务内读取。
    const items = assets.some((asset) => asset.file_type === "EPUB" || asset.file_type === "MD")
      ? reader.get_all_items(input.project_path)
      : [];
    return { meta, assets, items };
  });
  const { meta, assets, items } = snapshot;
  const writes: ProjectDatabaseWrite[] = [];
  if (assets.some((asset) => asset.file_type === "EPUB")) {
    writes.push(
      ...(await new EpubRubyBlockTextMigration(input.database).build_writes(
        input.project_path,
        items,
      )),
    );
  }
  if (assets.some((asset) => asset.file_type === "MD")) {
    writes.push(...new MarkdownV2BlockMigration().build_writes(input.project_path, items));
  }
  writes.push(...(await empty_asset_file_type_migration({ ...input, meta, assets })));
  return writes;
}
