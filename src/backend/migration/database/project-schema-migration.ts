import type { DatabaseSync } from "node:sqlite";

import { row_number, row_text } from "../migration-row";

/**
 * 迁移背景：
 * 当前 `.lg` 是 SQLite 项目文件，所有工程在业务读取前必须具备同一组表、索引和基础列。
 * 旧工程可能缺少新表或 `assets.sort_order`，而当前文件顺序、asset 读取和后续写回迁移都依赖它。
 *
 * 生效场景：
 * `ProjectDatabase` 首次打开任意 `.lg` 连接时执行，先补齐 schema，再允许其它迁移读取项目事实。
 *
 * 不处理范围：
 * 本文件只补物理结构，不写业务版本标记。规则和 Item 的数据写回由后续独立 Case 处理。
 */
export function run_project_schema_migration(db: DatabaseSync): void {
  ensure_current_schema(db);
  ensure_asset_sort_order_column(db);
}

/**
 * 当前 `.lg` 所有表和索引集中幂等创建，避免物理结构规则散落到业务写入口。
 */
function ensure_current_schema(db: DatabaseSync): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_chats (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL CHECK (json_valid(data))
      );
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pdf_documents (
        file_path TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pdf_pages (
        file_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (file_path, page)
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
      CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path);
      CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);
  `);
}

/**
 * 旧 assets 表缺少 sort_order 时，用自增 id 顺序还原稳定导入顺序。
 */
function ensure_asset_sort_order_column(db: DatabaseSync): void {
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
