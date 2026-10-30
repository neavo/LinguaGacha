import type { DatabaseSync } from "node:sqlite";
import { write_item_migration } from "./item-migration";

/**
 * 迁移背景：
 * 历史姓名数组收敛为单个姓名，格式附加信息由源资产保留。
 *
 * 生效场景：
 * 独立迁移使已完成早期迁移的工程仍能升级姓名字段。
 *
 * 不处理范围：
 * 非数组姓名和其它条目字段保留原值。
 */
export function run_item_name_text_migration(db: DatabaseSync): void {
  write_item_migration(db, (data) => {
    let changed = false;
    for (const field of ["name_src", "name_dst"] as const) {
      const value = data[field];
      if (!Array.isArray(value)) continue;
      data[field] = value.find((entry) => typeof entry === "string") ?? null; // 空字符串也是有效姓名。
      changed = true;
    }
    return { data, changed };
  });
}
