import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../shared/utils/json-tool";

type ProjectDatabaseMigrationRow = Record<string, unknown>;

export const PROJECT_DATABASE_SCHEMA_VERSION = 2;

const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST";
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED";
const CURRENT_NONE = "NONE";
const LEGACY_RULE_TYPE_TO_CURRENT_TYPE = new Map([
  ["GLOSSARY", "glossary"],
  ["TEXT_PRESERVE", "text_preserve"],
  ["PRE_REPLACEMENT", "pre_translation_replacement"],
  ["POST_REPLACEMENT", "post_translation_replacement"],
  ["TRANSLATION_PROMPT", "translation_prompt"],
  ["ANALYSIS_PROMPT", "analysis_prompt"],
]);
const VALID_ITEM_STATUSES = new Set([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

function row_text(row: ProjectDatabaseMigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function row_number(row: ProjectDatabaseMigrationRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}

/**
 * 封装 .lg 打开期 schema 与旧物理格式兼容迁移。
 */
export class ProjectDatabaseMigrationService {
  /**
   * database 服务打开工程时的唯一迁移入口，避免 Core 承担 .lg 旧物理格式。
   */
  public static migrate(db: DatabaseSync): void {
    this.ensure_schema(db);
    this.migrate_rule_types_if_needed(db);
    this.migrate_asset_sort_order_if_needed(db);
    this.migrate_item_status_if_needed(db);
  }

  /**
   * 初始化缺失表结构，让旧工程补齐当前数据库能力。
   */
  private static ensure_schema(db: DatabaseSync): void {
    // 新旧工程都经过同一个 schema 入口，避免建表逻辑散回 database 操作层。
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_item_checkpoint (
        item_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_candidate_aggregate (
        src TEXT PRIMARY KEY,
        dst_votes TEXT NOT NULL,
        info_votes TEXT NOT NULL,
        observation_count INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        case_sensitive INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path);
      CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);
      CREATE INDEX IF NOT EXISTS idx_analysis_item_checkpoint_status ON analysis_item_checkpoint(status);
    `);
  }

  /**
   * 归一旧枚举泄露出的规则槽位名，保证运行态只读取当前物理类型。
   */
  private static migrate_rule_types_if_needed(db: DatabaseSync): void {
    const target_exists = db.prepare("SELECT 1 FROM rules WHERE type = ? LIMIT 1");
    const update_legacy = db.prepare("UPDATE rules SET type = ? WHERE type = ?");
    const delete_legacy = db.prepare("DELETE FROM rules WHERE type = ?");
    for (const [legacy_type, current_type] of LEGACY_RULE_TYPE_TO_CURRENT_TYPE) {
      if (target_exists.get(current_type) === undefined) {
        update_legacy.run(current_type, legacy_type);
      } else {
        delete_legacy.run(legacy_type);
      }
    }
  }

  /**
   * 为旧 asset 补齐排序字段，保持文件顺序可稳定回放。
   */
  private static migrate_asset_sort_order_if_needed(db: DatabaseSync): void {
    // 旧 .lg 没有 sort_order 时，用自增 id 顺序还原用户导入顺序。
    const columns = db
      .prepare("PRAGMA table_info(assets)")
      .all()
      .map((row) => row_text(row, "name"));
    if (columns.includes("sort_order")) {
      return;
    }

    db.exec("ALTER TABLE assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    const rows = db.prepare("SELECT id FROM assets ORDER BY id").all();
    const statement = db.prepare("UPDATE assets SET sort_order = ? WHERE id = ?");
    for (const [index, row] of rows.entries()) {
      statement.run(index, row_number(row, "id"));
    }
  }

  /**
   * 归一旧 item 状态，防止历史运行态污染当前任务语义。
   */
  private static migrate_item_status_if_needed(db: DatabaseSync): void {
    // item 状态是业务事实，打开旧工程时直接写回当前允许集合。
    const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
    const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = row_text(row, "data");
      try {
        const parsed = JsonTool.parseStrict<ProjectDatabaseMigrationRow>(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          continue;
        }
        const normalized = this.normalize_item_payload(parsed);
        if (normalized.changed) {
          update.run(JsonTool.stringifyStrict(normalized.data), row_number(row, "id"));
        }
      } catch {
        // 旧工程中损坏的单行 item 不阻塞打开；坏数据仍保留原样等待人工处理。
      }
    }
  }

  /**
   * 规范 item payload 中的状态字段，兼容旧 JSON 形状。
   */
  private static normalize_item_payload(item_data: ProjectDatabaseMigrationRow): {
    data: ProjectDatabaseMigrationRow;
    changed: boolean;
  } {
    const raw_status = item_data["status"];
    const normalized_status = this.normalize_status_value(raw_status);
    if (raw_status === normalized_status) {
      return { data: item_data, changed: false };
    }
    return { data: { ...item_data, status: normalized_status }, changed: true };
  }

  /**
   * 把旧状态映射到当前有效枚举，保持前后端状态口径一致。
   */
  private static normalize_status_value(value: unknown): string {
    // 未知状态宁可回到待处理，也不要把历史运行态泄露给当前任务链路。
    const raw_value = String(value ?? "");
    if (raw_value === LEGACY_PROCESSED_IN_PAST) {
      return CURRENT_PROCESSED;
    }
    if (raw_value === LEGACY_PROCESSING) {
      return CURRENT_NONE;
    }
    if (VALID_ITEM_STATUSES.has(raw_value)) {
      return raw_value;
    }
    return CURRENT_NONE;
  }
}
