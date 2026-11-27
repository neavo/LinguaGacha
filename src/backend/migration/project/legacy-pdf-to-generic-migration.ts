import JSZip from "jszip";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import type {
  ProjectDatabaseAccess,
  ProjectDatabaseWrite,
} from "../../database/database-operations";
import type { ProjectOpenMigrationContext } from "../migration-types";

const LEGACY_PDF_REVISION = "project_runtime_revision.pdf";
const ARCHIVE_README = `# 旧版原生 PDF 静态迁移包

技能：\`pdf\`、\`generic-package\`

- \`source.pdf\` 保存原始 PDF。
- \`legacy-pdf.json\` 保存历史页数据与译稿处置。
- \`items.json\` 当前为空，尚未转换为通用包条目。

继续翻译、审校或导出前，请按 \`pdf\` 技能的 \`references/migration.md\` 完成迁移与旧译稿回填。
`;

/** 无法解析的历史记录由调用者保留原值。 */
function read_record(data: unknown): JsonRecord | null {
  if (typeof data !== "string") return null;
  try {
    const value: unknown = JSON.parse(data);
    return is_json_record(value) ? value : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

/**
 * 迁移背景：
 * 旧 PDF 库仅保存页级译稿和处置记录。通用包封存底稿及历史记录，供 Agent 恢复。
 *
 * 生效场景：
 * 打开含旧 PDF 资产、历史表或修订键的工程时，在同一事务替换可读资产并清理旧表和修订键。
 *
 * 不处理范围：
 * 正文提取与译稿回填交由 `pdf` 技能完成。原稿缺失时跳过该资产，无法解析的历史记录按原值封存。
 */
export async function legacy_pdf_to_generic_migration(
  context: ProjectOpenMigrationContext,
  legacy: ReturnType<ProjectDatabaseAccess["read_legacy_pdf"]>,
  allocate_path: (file_path: string) => string,
): Promise<ProjectDatabaseWrite[]> {
  const { project_path } = context;
  const has_revision = Object.hasOwn(context.meta, LEGACY_PDF_REVISION);
  if (!legacy.has_tables && !legacy.documents.length && !has_revision) return [];

  const writes: ProjectDatabaseWrite[] = [];
  for (const { file_path, document, pages } of legacy.documents) {
    const source = await context.database.read_asset_content(project_path, file_path);
    if (source === null) continue; // 读取时已无资产行，旧表仍可清理。

    const next = allocate_path(file_path);

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
