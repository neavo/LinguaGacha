import type { DatabaseSync } from "node:sqlite";
import { is_item_status } from "../../../domain/item";
import { read_project_settings } from "../../../domain/project-settings";
import {
  coordinate_project_duplicate_statuses,
  type ProjectDuplicateItem,
} from "../../../shared/project/project-item-duplicates";
import { JsonTool } from "../../../shared/utils/json-tool";
import { write_item_migration } from "./item-migration";
import { row_text } from "../migration-row";

/**
 * 历史 `ERROR` 归回待翻译，原条目的译文与私有字段保留。
 * 重建重复代表，迁移调度器在同一事务提交数据和完成标记。
 */
export function run_item_error_status_migration(db: DatabaseSync): void {
  const meta = Object.fromEntries(
    db
      .prepare(
        "SELECT key, value FROM meta WHERE key IN ('skip_duplicate_source_text_enable', 'prefilter_config')",
      )
      .all()
      .map((row) => [row_text(row, "key"), JsonTool.parseStrict(row_text(row, "value"))]),
  );
  const items: ProjectDuplicateItem[] = [];
  write_item_migration(db, (data, item_id) => {
    const changed = data["status"] === "ERROR";
    if (changed) data["status"] = "NONE";
    if (is_item_status(data["status"]))
      items.push({
        item_id,
        status: data["status"],
        file_path: String(data["file_path"] ?? ""),
        src: String(data["src"] ?? ""),
        name_src: typeof data["name_src"] === "string" ? data["name_src"] : null,
      });
    return { data, changed };
  });
  const changes = coordinate_project_duplicate_statuses(
    items,
    read_project_settings(meta).skip_duplicate_source_text_enable,
  );
  const update = db.prepare("UPDATE items SET data = json_set(data, '$.status', ?) WHERE id = ?");
  for (const { item_id, status } of changes) update.run(status, item_id);
}
