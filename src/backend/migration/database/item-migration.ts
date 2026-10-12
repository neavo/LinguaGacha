import type { DatabaseSync } from "node:sqlite";
import { is_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";

// 固定已发布 `.lg` 的条目类型，新增解析器不应扩大历史迁移值域；`MD` 留给打开期重建。
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

/** 历史条目迁移共用逐行写回机制，各迁移步骤拥有字段和顺序语义。 */
export function write_item_migration(
  db: DatabaseSync,
  normalize: (item: ItemMigrationPayload) => { data: ItemMigrationPayload; changed: boolean },
): void {
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").iterate();
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

/** 历史条目只接纳已发布的文件类型，未知值统一归为 `NONE`。 */
export function normalize_migration_file_type(value: unknown): string {
  return typeof value === "string" && LEGACY_ITEM_FILE_TYPES.has(value) ? value : "NONE";
}
