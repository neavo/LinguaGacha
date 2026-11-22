import JSZip from "jszip";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import {
  normalize_project_asset_path,
  ProjectAssetPathIndex,
} from "../../../shared/project/project-asset-paths";
import type {
  ProjectDatabaseAccess,
  ProjectDatabaseWrite,
} from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

const LEGACY_PDF_REVISION = "project_runtime_revision.pdf";
const GENERIC_SUFFIX = ".generic";
const ARCHIVE_README = `# 旧版原生 PDF 静态迁移包

技能：\`pdf\`、\`generic-data\`

- \`source.pdf\` 保存原始 PDF。
- \`legacy-pdf.json\` 保存历史页数据与译稿处置。
- \`items.json\` 当前为空，尚未转换为通用数据条目。

继续翻译、审校或导出前，请按 \`pdf\` 技能的 \`references/migration.md\` 完成迁移与旧译稿回填。
`;

function read_record(data: unknown): JsonRecord | null {
  if (typeof data !== "string") return null;
  try {
    const value: unknown = JSON.parse(data);
    return is_json_record(value) ? value : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null; // 损坏的历史 JSON 由封存包保留原字符串。
  }
}

/**
 * 迁移背景：
 * 旧工程以原生 `PDF` 资产配合 `pdf_documents`、`pdf_pages` 两张表保存页级译稿与处置。
 * 当前后端已移除原生 PDF 解析依赖与页面模型，统一收敛为 `.generic` 资产与标准条目。
 * 由于旧库未持久化原稿提取文本，且封存 ZIP 需异步使用 `JSZip`，本迁移在打开期将旧数据
 * 无损冷封存为 `GENERIC` 资产，供 Agent 侧 `pdf` 技能按 `references/migration.md` 恢复。
 *
 * 生效场景：
 * 打开工程且存在 `file_type` 为 `PDF` 的资产、残留 `pdf_documents`／`pdf_pages` 旧表，
 * 或 `meta` 含 `project_runtime_revision.pdf` 时触发；新工程与已迁移工程直接短路跳过。
 * 每份可读旧 PDF 按原路径追加 `.generic`（路径冲突时在冲突层级递增 `_2`、`_3` 后缀），
 * 封入 `source.pdf`、`legacy-pdf.json`、空 `items.json` 与 `README.md`，并在打开事务中
 * 保留原资产 ID 与排序位完成就地替换，随后删除旧表与旧修订键。
 *
 * 不处理范围：
 * 不解析 PDF 原文、不伪造占位条目，也不直接将历史页译稿写入 `items` 表。
 * 资产内容缺失时跳过封存，损坏的历史文档或页记录保留至 `raw_document`／`raw_pages`，
 * 均不阻断工程打开与旧表清理。
 */
export async function legacy_pdf_to_generic_migration(
  context: ProjectOpenMigrationContext,
  legacy: ReturnType<ProjectDatabaseAccess["read_legacy_pdf"]>,
): Promise<ProjectDatabaseWrite[]> {
  const { project_path } = context;
  const has_revision = Object.hasOwn(context.meta, LEGACY_PDF_REVISION);
  if (!legacy.has_tables && !legacy.documents.length && !has_revision) return [];

  const paths = new ProjectAssetPathIndex();
  for (const asset of context.assets) paths.reserve(asset.path);
  const writes: ProjectDatabaseWrite[] = [];
  for (const { file_path, document, pages } of legacy.documents) {
    const source = await context.database.read_asset_content(project_path, file_path);
    if (source === null) continue; // 读取时已无资产行，旧表仍可清理。

    const parts = normalize_project_asset_path(file_path).split("/");
    let next = parts.join("/") + GENERIC_SUFFIX;
    const conflict = paths.find_conflict(next);
    if (conflict !== null) {
      // 早期工程可能有文件占用父目录名，从实际冲突的层级分配后缀。
      const index = conflict.split("/").length - 1;
      const name = parts[index];
      for (let suffix = 2; paths.find_conflict(next) !== null; suffix++) {
        parts[index] = `${name}_${suffix}`;
        next = parts.join("/") + GENERIC_SUFFIX;
      }
    }
    paths.reserve(next); // 上方已检查冲突，下一份资产需避开已分配路径。

    const metadata = read_record(document);
    const records: JsonRecord[] = [];
    const raw_pages: typeof pages = [];
    for (const row of pages) {
      const record = read_record(row.data);
      if (record?.["page"] === row.page) records.push(record);
      else raw_pages.push(row);
    }
    const zip = new JSZip();
    zip.file("items.json", "[]");
    zip.file("source.pdf", source);
    zip.file(
      "legacy-pdf.json",
      JSON.stringify({
        original_file_path: file_path,
        digest: typeof metadata?.["digest"] === "string" ? metadata["digest"] : null,
        pages: records,
        ...(document !== undefined && metadata === null ? { raw_document: document } : {}),
        ...(raw_pages.length ? { raw_pages } : {}),
      }),
    );
    zip.file("README.md", ARCHIVE_README);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    writes.push((writer) => {
      // 保留资产 ID，排序位相同的旧资产仍按原导入顺序显示。
      writer.delete_asset_items(project_path, file_path);
      writer.rename_asset(project_path, file_path, next);
      writer.update_asset(project_path, next, bytes, "GENERIC");
    });
  }
  if (legacy.has_tables) writes.push((writer) => writer.drop_legacy_pdf_tables(project_path));
  if (has_revision) writes.push((writer) => writer.delete_meta(project_path, LEGACY_PDF_REVISION));
  return writes;
}
