import type { DatabaseSync } from "node:sqlite";
import type { ProjectPreview } from "../../shared/project-preview";
import { build_project_translation_stats } from "../../shared/project-translation-stats";
import { JsonTool } from "../../shared/utils/json-tool";

/** 只查询概览所需事实，旧状态仅在统计中解释，不触发结构或数据迁移。 */
export function read_project_preview(db: DatabaseSync): ProjectPreview {
  const meta = Object.fromEntries(
    db
      .prepare("SELECT key, value FROM meta WHERE key IN ('created_at', 'updated_at')")
      .all()
      .map((row) => [String(row["key"]), JsonTool.parseStrict(String(row["value"]))]),
  );
  const file_paths = db
    .prepare("SELECT path FROM assets ORDER BY id ASC")
    .all()
    .map((row) => String(row["path"]));
  const items = db
    .prepare("SELECT json_extract(data, '$.status') AS status FROM items")
    .all()
    .map((row) => ({
      status: row["status"] === "PROCESSED_IN_PAST" ? "PROCESSED" : String(row["status"] ?? "NONE"),
    }));
  return {
    file_paths,
    created_at: String(meta["created_at"] ?? ""),
    updated_at: String(meta["updated_at"] ?? ""),
    translation_stats: build_project_translation_stats(items),
  };
}
