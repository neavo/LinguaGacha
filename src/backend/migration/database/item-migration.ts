import type { DatabaseSync } from "node:sqlite";
import { Item } from "../../../domain/item";
import { is_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";

const LEGACY_MARKDOWN_FILE_TYPE = "MD";
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set(["XLSX", "KVJSON", "MESSAGEJSON"]);
export type ItemMigrationPayload = Record<string, unknown>;

/** 三个历史步骤共用逐行写回机制，具体字段和先后语义由各 Case 拥有。 */
export function write_item_migration(
  db: DatabaseSync,
  normalize: (item: ItemMigrationPayload) => { data: ItemMigrationPayload; changed: boolean },
): void {
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
  const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
  for (const row of rows) {
    try {
      const parsed = JsonTool.parseStrict<unknown>(row_text(row, "data"));
      if (!is_json_record(parsed)) continue;
      const result = normalize(parsed);
      if (result.changed) update.run(JsonTool.stringifyStrict(result.data), row_number(row, "id"));
    } catch {
      // 保留历史逐行容错边界：失败行原文留存。收窄到解析异常属于独立行为修正。
    }
  }
}

/** 历史 MD 必须留给打开期重建，不能提前按当前领域值域折叠为 NONE。 */
export function normalize_migration_file_type(value: unknown): string {
  return value === LEGACY_MARKDOWN_FILE_TYPE
    ? LEGACY_MARKDOWN_FILE_TYPE
    : Item.normalize_file_type(value);
}

/** 两个公共字段 Case 使用相同的历史文本语义推断范围。 */
export function normalize_migration_text_type(
  value: unknown,
  file_type: string,
  src: string,
): string {
  const text_type = Item.normalize_text_type(value);
  return text_type === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)
    ? Item.infer_text_type_from_source(src)
    : text_type;
}
