import type { DatabaseSync } from "node:sqlite";
import { compare_app_version, parse_app_version, type AppVersion } from "../../shared/app-version";
import { JsonTool } from "../../shared/utils/json-tool";

export const PROJECT_TARGET_APP_VERSION_META_KEY = "target_app_version";

/** 旧工程可缺少 meta 表。SQLite 查询失败仍由存储边界报告。 */
export function read_project_file_version(db: DatabaseSync): AppVersion | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get())
    return null;
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(PROJECT_TARGET_APP_VERSION_META_KEY);
  if (!row) return null;
  try {
    return parse_app_version(JsonTool.parseStrict(String(row["value"])));
  } catch {
    return null; // 产品要求损坏的版本字段按未知处理，允许后续准备修正。
  }
}

/** 调用者的创建或迁移事务拥有版本写入，合法高版本保留原始存储值。 */
export function update_project_file_version(db: DatabaseSync, current_app_version: string): void {
  const target = read_project_file_version(db);
  const current = parse_app_version(current_app_version)!; // 应用元信息遵循 version.txt 的发布格式。
  if (target && compare_app_version(target, current) >= 0) return;
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    PROJECT_TARGET_APP_VERSION_META_KEY,
    JsonTool.stringifyStrict(current.value),
  );
}
