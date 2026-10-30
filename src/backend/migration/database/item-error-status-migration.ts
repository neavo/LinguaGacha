import type { DatabaseSync } from "node:sqlite";
import { normalize_batch_translation_progress } from "../../../domain/batch-translation";
import { is_item_status } from "../../../domain/item";
import { read_project_prefilter_settings } from "../../../domain/project-settings";
import {
  coordinate_project_duplicate_statuses,
  type ProjectDuplicateItem,
} from "../../../shared/project/project-item-duplicates";
import { JsonTool } from "../../../shared/utils/json-tool";
import { write_item_migration } from "./item-migration";
import { row_text } from "../migration-row";

/**
 * 历史 `ERROR` 归回待翻译，原条目的译文与私有字段保留。
 * 独立重建重复代表与工程计数，避免打开期无状态变化时漏刷统计。
 * 本项数据、计数及完成标记由迁移调度器在同一事务提交。
 */
export function run_item_error_status_migration(db: DatabaseSync): void {
  const meta = Object.fromEntries(
    db
      .prepare(
        "SELECT key, value FROM meta WHERE key IN ('translation_extras', 'skip_duplicate_source_text_enable', 'prefilter_config')",
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
  // 空工程尚未建立进度，沿用首次业务写入时初始化的语义。
  if (items.length === 0 && meta["translation_extras"] === undefined) return;
  const changes = coordinate_project_duplicate_statuses(
    items,
    read_project_prefilter_settings(meta).skip_duplicate_source_text_enable,
  );
  const statuses = new Map(changes.map(({ item_id, status }) => [item_id, status]));
  const update = db.prepare("UPDATE items SET data = json_set(data, '$.status', ?) WHERE id = ?");
  for (const { item_id, status } of changes) update.run(status, item_id);
  const final_statuses = items.map((item) => statuses.get(item.item_id) ?? item.status);
  const progress = {
    ...normalize_batch_translation_progress(meta["translation_extras"]),
    total_line: final_statuses.filter((status) => status === "NONE" || status === "PROCESSED")
      .length,
    processed_line: final_statuses.filter((status) => status === "PROCESSED").length,
  };
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('translation_extras', ?)").run(
    JsonTool.stringifyStrict(progress),
  );
}
