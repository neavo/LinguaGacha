import JSZip from "jszip";
import { create_item } from "../../../domain/item";
import { read_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import type { GenericItem } from "../../../shared/generic-package";
import { project_asset_extension } from "../../../shared/project/project-asset-paths";
import type { ProjectAssetRecord, ProjectDatabaseWrite } from "../../database/database-operations";
import type { ProjectOpenMigrationInput } from "../migration-types";

const LEGACY_ASSET_TYPES = new Set(["XLSX", "WOLFXLSX", "TRANS"]);
const WORKBOOK_EXTENSION = ".xlsx";
const TRANS_EXTENSION = ".trans";

/** 无旧格式身份的历史资产仍可按原稿后缀识别。 */
export function is_legacy_xlsx_or_trans(asset: ProjectAssetRecord): boolean {
  if (LEGACY_ASSET_TYPES.has(asset.file_type)) return true;
  if (asset.file_type !== "NONE") return false;
  const extension = project_asset_extension(asset.path).toLowerCase();
  return extension === WORKBOOK_EXTENSION || extension === TRANS_EXTENSION;
}

/** 只保存可用的文件内定位，缺失时留给写回阶段核对底稿。 */
function read_trans_ref(extra_field: JsonValue | undefined): JsonRecord | null {
  const ref = read_json_record(read_json_record(extra_field)["trans_ref"]);
  const { file_key, row_index } = ref;
  return typeof file_key === "string" &&
    typeof row_index === "number" &&
    Number.isInteger(row_index) &&
    row_index >= 0
    ? { file_key, row_index }
    : null;
}

/** 生成旧迁移包的定位与写回说明，供重置会话或换机后独立恢复。 */
function build_migration_readme(is_trans: boolean, file_type: string): string {
  if (is_trans) {
    return `# 旧版 Translator++ 迁移包

适用技能：\`generic-package\`

- 底稿成员：\`source.trans\`（原资产类型：\`${file_type}\`）。
- 条目定位：\`items.json\` 按新行号顺序存储，\`trans_ref\` 对应 \`project.files[file_key].data[row_index]\`；\`trans_ref\` 为 \`null\` 时结合 \`tag\`、\`legacy_row\` 与底稿复核。
- 列与标签：\`project.indexOriginal\` 与 \`project.indexTranslation\` 缺省为 \`0\`、\`1\`；历史 \`aqua\` 标签留在底稿中供核对。
- 写回约束：对齐同一工程版本的 \`items/entries.jsonl\` 与 \`generateFiles()\` 写回输入，仅修改已完成行的目标列（含空译文与同文译文，\`DUPLICATED\` 仅在同文件、同原文、同原名组内存在已完成项时写回），保留未完成行及 \`tags\`、\`parameters\` 等旁路数据；交付时恢复 \`.trans\` 后缀。
`;
  }
  const layout =
    file_type === "WOLFXLSX"
      ? "默认首表 F 列为原文、G 列为译文；首行含 `code`、`flag`、`type`、`info`，原文单元格索引色 `9` 标记待译资格。"
      : file_type === "XLSX"
        ? "默认首表 A 列为原文、B 列为译文。"
        : "历史类型为 `NONE`，写回前需按底稿调查工作表与列布局。";
  return `# 旧版原生工作簿迁移包

适用技能：\`xlsx\`、\`generic-package\`

- 底稿成员：\`source.xlsx\`（原资产类型：\`${file_type}\`）。
- 列布局：${layout}
- 条目定位：\`items.json\` 按新行号顺序存储，\`sheet_row\` 为从 1 开始的工作表行号，\`legacy_file_type\` 记录原资产类型。
- 写回约束：对齐同一工程版本的 \`items/entries.jsonl\` 与 \`generateFiles()\` 写回输入，仅修改已完成行的目标单元格（含空译文与同文译文，\`DUPLICATED\` 仅在同文件、同原文、同原名组内存在已完成项时写回），保留未完成行的原值与样式；以 \`=\` 开头的普通译文按文本写入；交付时恢复 \`.xlsx\` 后缀。
`;
}

/**
 * 迁移背景：
 * 旧 `XLSX`、`WOLFXLSX` 和 `TRANS` 的标准条目已保存原文和翻译进度，可直接迁入通用包流程。
 *
 * 生效场景：
 * 打开含旧格式资产或对应后缀的历史 `NONE` 资产时，封存底稿、说明和旧定位。
 * 通用包与重排行号的条目在同一事务提交，保留条目主键，包下标与新行号对齐。
 *
 * 不处理范围：
 * 底稿按原始字节封存。原稿缺失时跳过该资产，缺失的历史定位留给写回阶段核对。
 */
export async function legacy_xlsx_trans_to_generic_migration(
  { database, project_path }: ProjectOpenMigrationInput,
  assets: readonly ProjectAssetRecord[],
  items: readonly JsonRecord[],
  allocate_path: (file_path: string) => string,
): Promise<ProjectDatabaseWrite[]> {
  if (assets.length === 0) return [];
  const items_by_path = new Map(assets.map((asset) => [asset.path, [] as JsonRecord[]]));
  for (const record of items) {
    const file_path = record["file_path"];
    if (typeof file_path === "string") items_by_path.get(file_path)?.push(record);
  }
  const writes: ProjectDatabaseWrite[] = [];
  for (const asset of assets) {
    const source = await database.read_asset_content(project_path, asset.path);
    if (source === null) continue; // 原稿暂不可用，保留快照中的资产和条目。

    const is_trans =
      asset.file_type === "TRANS" ||
      project_asset_extension(asset.path).toLowerCase() === TRANS_EXTENSION;
    const next_path = allocate_path(asset.path);
    const records = items_by_path.get(asset.path)!.map((record) => {
      const row = record["row"];
      return { record, old_row: typeof row === "number" && Number.isInteger(row) ? row : null };
    });
    // 数据库已按主键读取条目。稳定排序保留同一旧行内的主键顺序。
    records.sort((left, right) => (left.old_row ?? Infinity) - (right.old_row ?? Infinity));
    const generic_items: (GenericItem & JsonRecord)[] = [];
    const migrated_items = records.map(({ record, old_row }, row) => {
      const item = create_item({
        ...record,
        file_type: "GENERIC",
        file_path: next_path,
        row,
        extra_field: "",
        tag: "",
      });
      generic_items.push({
        message: item.src,
        ...(item.name_src === null ? {} : { name: item.name_src }),
        legacy_file_type: asset.file_type,
        ...(is_trans
          ? {
              trans_ref: read_trans_ref(record["extra_field"]),
              tag: typeof record["tag"] === "string" ? record["tag"] : "",
              legacy_row: old_row,
            }
          : { sheet_row: old_row }),
      });
      return item;
    });
    const zip = new JSZip();
    zip.file(is_trans ? "source.trans" : "source.xlsx", source);
    zip.file("items.json", JSON.stringify(generic_items));
    zip.file("README.md", build_migration_readme(is_trans, asset.file_type));
    // 资产写入时已有 Zstd 压缩，ZIP 只存储成员。
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    writes.push((writer) => {
      writer.delete_asset_items(project_path, asset.path);
      writer.rename_asset(project_path, asset.path, next_path);
      writer.update_asset(project_path, next_path, bytes, "GENERIC");
      if (migrated_items.length > 0) writer.insert_items(project_path, migrated_items);
    });
  }
  return writes;
}
