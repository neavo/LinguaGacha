import type { DatabaseSync } from "node:sqlite";
import { is_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";

/**
 * 迁移背景：
 * 历史 `name_src` 和 `name_dst` 可能保存数组。当前姓名字段只消费字符串或 `null`。
 * 本迁移将姓名数组收敛为单个姓名，格式附加信息由源资产保留。
 *
 * 生效场景：
 * 数据库写回时，将姓名数组替换为首个字符串。没有字符串时写入 `null`。
 * 数据和完成标记在同一事务提交，写入失败时回滚。
 *
 * 不处理范围：
 * 非数组姓名和其它条目字段保留原值。损坏 JSON 与非对象载荷保留原始记录。
 */
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
