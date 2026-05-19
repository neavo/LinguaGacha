import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../../shared/utils/json-tool";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type SchemaRow = Record<string, unknown>;

export const PROJECT_DATABASE_SCHEMA_VERSION = 2; // 只表达当前表结构能力，不承载业务写回完成状态

/**
 * 迁移背景：
 * 当前 `.lg` 是 SQLite 项目文件，所有工程在业务读取前必须具备同一组表、索引和基础列。
 * 旧工程可能缺少新表或 `assets.sort_order`，而当前文件顺序、asset 读取和后续写回迁移都依赖它。
 *
 * 生效场景：
 * `ProjectDatabase` 首次打开任意 `.lg` 连接时执行，先补齐 schema，再允许其它迁移读取项目事实。
 *
 * 不处理范围：
 * 本文件只补物理结构和当前 schema 版本；规则、item、checkpoint 等业务数据写回由独立迁移点处理。
 */
export const project_schema_migration: MigrationDescriptor = {
  id: "project-schema",
  order: 100,
  /**
   * schema hook 每次首次打开都执行，确保空库和旧库都能补齐当前结构。
   */
  run_project_database_schema(context: ProjectDatabaseMigrationContext): void {
    ProjectSchemaMigration.run(context.db);
  },
};

/**
 * 负责补齐 `.lg` 的物理表结构、索引和 schema_version，是所有项目数据库迁移的前置层。
 */
export class ProjectSchemaMigration {
  /**
   * schema 迁移先建表/索引，再补旧 asset 排序列，最后写 schema_version。
   */
  public static run(db: DatabaseSync): void {
    this.ensure_current_schema(db);
    this.ensure_asset_sort_order_column(db);
    this.write_meta_version(db, "schema_version", PROJECT_DATABASE_SCHEMA_VERSION);
  }

  /**
   * 当前 `.lg` 所有表和索引集中在这里创建，避免建表规则散落到 operation 层。
   */
  private static ensure_current_schema(db: DatabaseSync): void {
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
   * 旧 assets 表缺少 sort_order 时，用自增 id 顺序还原导入顺序。
   */
  private static ensure_asset_sort_order_column(db: DatabaseSync): void {
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
   * schema_version 使用严格 JSON 数字写入 meta，和其它 meta 序列化保持一致。
   */
  private static write_meta_version(db: DatabaseSync, key: string, version: number): void {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      key,
      JsonTool.stringifyStrict(version),
    );
  }
}

/**
 * PRAGMA / SQLite 行值可能不是字符串，读取列名时统一收窄。
 */
function row_text(row: SchemaRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * SQLite INTEGER 可能以 number 或 bigint 返回，写回 id 前统一转 number。
 */
function row_number(row: SchemaRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}
