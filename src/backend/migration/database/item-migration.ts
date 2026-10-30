import type { DatabaseSync } from "node:sqlite";
import { is_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";

// 固定已发布 `.lg` 的条目类型，避免新增解析器改写历史升级结果。
const LEGACY_ITEM_FILE_TYPES = new Set<string>([
  "NONE",
  "MD",
  "MD_V2",
  "TXT",
  "SRT",
  "ASS",
  "VTT",
  "LRC",
  "EPUB",
  "XLSX",
  "WOLFXLSX",
  "RENPY",
  "TRANS",
  "KVJSON",
  "MESSAGEJSON",
]);
export type ItemMigrationPayload = Record<string, unknown>;

/**
 * 损坏 JSON 与非对象载荷保留原文。
 * 转换、序列化和写入错误交给调度入口回滚本项事务。
 */
export function write_item_migration(
  db: DatabaseSync,
  normalize: (
    item: ItemMigrationPayload,
    id: number,
  ) => { data: ItemMigrationPayload; changed: boolean },
): void {
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").iterate();
  const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JsonTool.parseStrict<unknown>(row_text(row, "data"));
    } catch {
      continue; // 保留仍可恢复的原始内容。
    }
    if (!is_json_record(parsed)) continue;
    const result = normalize(parsed, row_number(row, "id"));
    if (result.changed) update.run(JsonTool.stringifyStrict(result.data), row_number(row, "id"));
  }
}

/** 历史条目只接纳已发布的文件类型，未知值统一归为 `NONE`。 */
export function normalize_migration_file_type(value: unknown): string {
  return typeof value === "string" && LEGACY_ITEM_FILE_TYPES.has(value) ? value : "NONE";
}
