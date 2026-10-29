import type { DatabaseSync } from "node:sqlite";
import { is_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";

/** 历史姓名数组一次性收敛为当前姓名，源资产独立保留格式附加信息。 */
export function run_item_name_text_migration(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").iterate();
  const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
  for (const row of rows) {
    let data: unknown;
    try {
      data = JsonTool.parseStrict<unknown>(row_text(row, "data"));
    } catch {
      continue; // 损坏 JSON 保留物理原值，避免迁移破坏仍可恢复的内容。
    }
    if (!is_json_record(data)) continue;
    let changed = false;
    for (const field of ["name_src", "name_dst"] as const) {
      const value = data[field];
      if (!Array.isArray(value)) continue;
      data[field] = value.find((entry) => typeof entry === "string") ?? null;
      changed = true;
    }
    // 写入异常必须交给迁移事务回滚，完成标记不能早于数据提交。
    if (changed) update.run(JsonTool.stringifyStrict(data), row_number(row, "id"));
  }
}
