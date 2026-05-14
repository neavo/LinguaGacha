import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../shared/utils/json-tool";
import { Item, is_item_file_type, is_item_status, is_item_text_type } from "../../base/item";
import { is_task_progress_status } from "../../shared/task";

type ProjectDatabaseMigrationRow = Record<string, unknown>;
type ProjectDatabaseMigrationItem = Record<string, unknown>;

export const PROJECT_DATABASE_SCHEMA_VERSION = 2; // schema_version 只表达当前表结构能力，不作为业务数据写回标记
export const PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION = 1; // 写回型迁移独立标记，避免旧工程因 schema_version 跳过数据归一

const SCHEMA_VERSION_META_KEY = "schema_version";
const WRITEBACK_MIGRATION_VERSION_META_KEY = "writeback_migration_version";

const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST"; // 旧任务状态曾经把运行中和历史已处理态持久化到 item payload
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED"; // 当前 item status 只允许稳定事实，不保留运行中临时态
const CURRENT_NONE = "NONE";
// Python 旧规则枚举是大写槽位，TS 当前物理类型统一为小写业务名
const LEGACY_RULE_TYPE_TO_CURRENT_TYPE = new Map([
  ["GLOSSARY", "glossary"],
  ["TEXT_PRESERVE", "text_preserve"],
  ["PRE_REPLACEMENT", "pre_translation_replacement"],
  ["POST_REPLACEMENT", "post_translation_replacement"],
  ["TRANSLATION_PROMPT", "translation_prompt"],
  ["ANALYSIS_PROMPT", "analysis_prompt"],
]);
const CURRENT_RULE_ENTRY_TYPES = new Set([
  "glossary",
  "text_preserve",
  "pre_translation_replacement",
  "post_translation_replacement",
]);
const CURRENT_RULE_TEXT_TYPES = new Set([
  "translation_prompt",
  "analysis_prompt",
  "CUSTOM_PROMPT_ZH",
  "CUSTOM_PROMPT_EN",
]);
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set(["XLSX", "KVJSON", "MESSAGEJSON"]);
/**
 * SQLite 行值可能来自不同底层类型，迁移读取文本统一在这里收窄
 */
function row_text(row: ProjectDatabaseMigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * SQLite INTEGER 可能以 number 或 bigint 返回，迁移写回 id 前统一转 number
 */
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
 * 封装 .lg 打开期 schema 与旧物理格式兼容迁移
 */
export class ProjectDatabaseMigrationService {
  /**
   * database 服务打开工程时的唯一迁移入口，避免 Core 承担 .lg旧物理格式
   */
  public static migrate(db: DatabaseSync): void {
    this.ensure_schema(db);
    this.write_meta_version(db, SCHEMA_VERSION_META_KEY, PROJECT_DATABASE_SCHEMA_VERSION);
    if (
      this.read_meta_version(db, WRITEBACK_MIGRATION_VERSION_META_KEY) >=
        PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION
    ) {
      return;
    }
    this.migrate_rule_types_if_needed(db);
    this.migrate_rule_payloads_if_needed(db);
    this.migrate_asset_sort_order_if_needed(db);
    this.migrate_item_status_if_needed(db);
    this.migrate_analysis_checkpoint_status_if_needed(db);
    this.write_meta_version(
      db,
      WRITEBACK_MIGRATION_VERSION_META_KEY,
      PROJECT_DATABASE_WRITEBACK_MIGRATION_VERSION,
    );
  }

  /**
   * 初始化缺失表结构，让旧工程补齐当前数据库能力
   */
  private static ensure_schema(db: DatabaseSync): void {
    // 新旧工程都经过同一个 schema 入口，避免建表逻辑散回 database 操作层
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
   * meta 版本值统一用严格 JSON 存储，损坏时回退为未执行
   */
  private static read_meta_version(db: DatabaseSync, key: string): number {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    if (row === undefined) {
      return 0;
    }
    try {
      const value = JsonTool.parseStrict<unknown>(row_text(row, "value"));
      const version = Number(value ?? 0);
      return Number.isFinite(version) ? Math.trunc(version) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * 版本写入集中到 meta，避免结构版本和数据写回版本混用
   */
  private static write_meta_version(db: DatabaseSync, key: string, version: number): void {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      key,
      JsonTool.stringifyStrict(version),
    );
  }

  /**
   * 归一旧枚举泄露出的规则槽位名，保证运行态只读取当前物理类型
   */
  private static migrate_rule_types_if_needed(db: DatabaseSync): void {
    const target_exists = db.prepare("SELECT 1 FROM rules WHERE type = ? LIMIT 1");
    const update_legacy = db.prepare("UPDATE rules SET type = ? WHERE type = ?");
    const delete_legacy = db.prepare("DELETE FROM rules WHERE type = ?");
    for (const [legacy_type, current_type] of LEGACY_RULE_TYPE_TO_CURRENT_TYPE) {
      // 当前物理类型已存在时保留当前事实，旧槽位视为重复历史残留
      if (target_exists.get(current_type) === undefined) {
        update_legacy.run(current_type, legacy_type);
      } else {
        delete_legacy.run(legacy_type);
      }
    }
  }

  /**
   * 归一规则 payload 物理形状，让运行态只读取当前规则表格式
   */
  private static migrate_rule_payloads_if_needed(db: DatabaseSync): void {
    const rows = db.prepare("SELECT id, type, data FROM rules ORDER BY id").all();
    const rows_by_type = new Map<string, ProjectDatabaseMigrationRow[]>();
    for (const row of rows) {
      const type = row_text(row, "type");
      if (!CURRENT_RULE_ENTRY_TYPES.has(type) && !CURRENT_RULE_TEXT_TYPES.has(type)) {
        continue;
      }
      const bucket = rows_by_type.get(type) ?? [];
      bucket.push(row);
      rows_by_type.set(type, bucket);
    }

    const update = db.prepare("UPDATE rules SET data = ? WHERE id = ?");
    const delete_row = db.prepare("DELETE FROM rules WHERE id = ?");
    for (const [rule_type, rule_rows] of rows_by_type) {
      if (rule_rows.length === 0) {
        continue;
      }
      const normalized_data = CURRENT_RULE_TEXT_TYPES.has(rule_type)
        ? { text: this.deserialize_rule_text_rows(rule_rows) }
        : this.deserialize_rule_entry_rows(rule_rows);
      const first_row = rule_rows[0];
      if (first_row === undefined) {
        continue;
      }
      const normalized_raw = JsonTool.stringifyStrict(normalized_data);
      if (row_text(first_row, "data") !== normalized_raw) {
        update.run(normalized_raw, row_number(first_row, "id"));
      }
      for (const extra_row of rule_rows.slice(1)) {
        delete_row.run(row_number(extra_row, "id"));
      }
    }
  }

  /**
   * 为旧 asset 补齐排序字段，保持文件顺序可稳定回放
   */
  private static migrate_asset_sort_order_if_needed(db: DatabaseSync): void {
    // 旧 .lg 没有 sort_order 时，用自增 id 顺序还原用户导入顺序
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
   * 归一旧 item 状态，防止历史运行态污染当前任务语义
   */
  private static migrate_item_status_if_needed(db: DatabaseSync): void {
    const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all(); // item 状态是业务事实，打开旧工程时直接写回当前允许集合
    const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = row_text(row, "data");
      try {
        const parsed = JsonTool.parseStrict<ProjectDatabaseMigrationRow>(raw); // item JSON 可能来自更早版本，只有对象 payload 才具备可迁移状态字段
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          continue;
        }
        const normalized = this.normalize_item_payload(parsed);
        if (normalized.changed) {
          update.run(JsonTool.stringifyStrict(normalized.data), row_number(row, "id"));
        }
      } catch {
        // 旧工程中损坏的单行 item 不阻塞打开；坏数据仍保留原样等待人工处理
      }
    }
  }

  /**
   * 规范 item payload 中的状态字段，兼容旧 JSON 形状
   */
  private static normalize_item_payload(item_data: ProjectDatabaseMigrationRow): {
    data: ProjectDatabaseMigrationRow;
    changed: boolean;
  } {
    const normalized: ProjectDatabaseMigrationItem = { ...item_data };
    let changed = false;

    const raw_status = normalized["status"];
    const normalized_status = this.normalize_item_status_value(raw_status);
    if (raw_status !== normalized_status) {
      normalized["status"] = normalized_status;
      changed = true;
    }

    if (normalized["row"] === undefined && normalized["row_number"] !== undefined) {
      normalized["row"] = row_value_number(normalized["row_number"], 0);
      changed = true;
    }
    if (normalized["row_number"] !== undefined) {
      delete normalized["row_number"];
      changed = true;
    }

    const raw_file_type = normalized["file_type"];
    const normalized_file_type =
      typeof raw_file_type === "string" && is_item_file_type(raw_file_type)
        ? raw_file_type
        : "NONE";
    if (raw_file_type !== normalized_file_type) {
      normalized["file_type"] = normalized_file_type;
      changed = true;
    }

    const raw_text_type = normalized["text_type"];
    const normalized_text_type = this.normalize_item_text_type_value(
      raw_text_type,
      normalized_file_type,
      row_value_text(normalized["src"]),
    );
    if (raw_text_type !== normalized_text_type) {
      normalized["text_type"] = normalized_text_type;
      changed = true;
    }

    const raw_row = normalized["row"];
    const normalized_row = row_value_number(raw_row, 0);
    if (raw_row !== normalized_row) {
      normalized["row"] = normalized_row;
      changed = true;
    }

    const raw_retry_count = normalized["retry_count"];
    const normalized_retry_count = row_value_number(raw_retry_count, 0);
    if (raw_retry_count !== normalized_retry_count) {
      normalized["retry_count"] = normalized_retry_count;
      changed = true;
    }

    return { data: normalized, changed };
  }

  /**
   * 把旧状态映射到当前有效枚举，保持前后端状态口径一致
   */
  private static normalize_item_status_value(value: unknown): string {
    const raw_value = String(value ?? ""); // 未知状态宁可回到待处理，也不要把历史运行态泄露给当前任务链路
    if (raw_value === LEGACY_PROCESSED_IN_PAST) {
      return CURRENT_PROCESSED;
    }
    if (raw_value === LEGACY_PROCESSING) {
      return CURRENT_NONE;
    }
    if (is_item_status(raw_value)) {
      return raw_value;
    }
    return CURRENT_NONE;
  }

  /**
   * text_type 缺失或无效时写回当前文本规则语义
   */
  private static normalize_item_text_type_value(
    value: unknown,
    file_type: string,
    src: string,
  ): string {
    const raw_value = typeof value === "string" && is_item_text_type(value) ? value : "NONE";
    if (raw_value === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
      return Item.infer_text_type_from_source(src);
    }
    return raw_value;
  }

  /**
   * 归一分析 checkpoint 状态，避免运行态继续过滤持久旧值
   */
  private static migrate_analysis_checkpoint_status_if_needed(db: DatabaseSync): void {
    const rows = db.prepare("SELECT item_id, status FROM analysis_item_checkpoint").all();
    const update = db.prepare("UPDATE analysis_item_checkpoint SET status = ? WHERE item_id = ?");
    for (const row of rows) {
      const raw_status = row_text(row, "status");
      const normalized_status = this.normalize_checkpoint_status_value(raw_status);
      if (raw_status !== normalized_status) {
        update.run(normalized_status, row_number(row, "item_id"));
      }
    }
  }

  /**
   * checkpoint 只保留任务进度三态
   */
  private static normalize_checkpoint_status_value(value: unknown): string {
    const raw_value = String(value ?? "");
    if (raw_value === LEGACY_PROCESSED_IN_PAST) {
      return CURRENT_PROCESSED;
    }
    if (raw_value === LEGACY_PROCESSING) {
      return CURRENT_NONE;
    }
    return is_task_progress_status(raw_value) ? raw_value : CURRENT_NONE;
  }

  /**
   * 读取文本规则旧载荷并输出当前 { text } 形状
   */
  private static deserialize_rule_text_rows(rows: ProjectDatabaseMigrationRow[]): string {
    for (const row of rows) {
      const text = this.deserialize_rule_text(row_text(row, "data"));
      if (text.trim() !== "") {
        return text;
      }
    }
    return "";
  }

  /**
   * 读取条目规则旧载荷并输出当前单行数组形状
   */
  private static deserialize_rule_entry_rows(rows: ProjectDatabaseMigrationRow[]): unknown[] {
    const first_data = this.try_parse_json(row_text(rows[0] ?? {}, "data"));
    if (Array.isArray(first_data)) {
      return first_data.map((entry) =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
          ? entry
          : { value: entry },
      );
    }

    const entries: unknown[] = [];
    for (const row of rows) {
      const data = this.try_parse_json(row_text(row, "data"));
      if (Array.isArray(data)) {
        entries.push(
          ...data.map((entry) =>
            typeof entry === "object" && entry !== null && !Array.isArray(entry)
              ? entry
              : { value: entry },
          ),
        );
      } else if (typeof data === "object" && data !== null) {
        entries.push(data);
      }
    }
    return entries;
  }

  /**
   * 读取文本规则字符串或对象载荷
   */
  private static deserialize_rule_text(raw_data: string): string {
    const data = this.try_parse_json(raw_data);
    if (typeof data === "string") {
      return data;
    }
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const text = (data as ProjectDatabaseMigrationRow)["text"];
      return typeof text === "string" ? text : String(text ?? "");
    }
    return "";
  }

  /**
   * JSON 损坏时返回 null，让迁移保留可打开性
   */
  private static try_parse_json(raw_data: string): unknown {
    try {
      return JsonTool.parseStrict(raw_data) as unknown;
    } catch {
      return null;
    }
  }
}

function row_value_text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function row_value_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
