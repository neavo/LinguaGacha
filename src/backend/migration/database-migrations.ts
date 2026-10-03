import type { DatabaseSync } from "node:sqlite";
import type { DatabaseSchemaMigration, DatabaseWritebackMigration } from "./migration-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { row_text } from "./migration-row";
import { project_schema_migration } from "./migrations/project-schema-migration";
import { project_item_public_contract_migration } from "./migrations/project-item-public-contract-migration";
import { project_item_stable_metadata_migration } from "./migrations/project-item-stable-metadata-migration";
import { project_rule_storage_migration } from "./migrations/project-rule-storage-migration";
import { quality_rule_entry_identity_migration } from "./migrations/quality-rule-entry-identity-migration";
import { trans_item_metadata_migration } from "./migrations/trans-item-metadata-migration";

const DATABASE_SCHEMA_MIGRATIONS: readonly DatabaseSchemaMigration[] = [project_schema_migration];
const DATABASE_WRITEBACK_MIGRATIONS: readonly DatabaseWritebackMigration[] = [
  project_item_public_contract_migration,
  project_item_stable_metadata_migration,
  project_rule_storage_migration,
  quality_rule_entry_identity_migration,
  trans_item_metadata_migration,
];
export const PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY =
  "applied_writeback_migrations";

/** 首次打开连接先补结构，再执行逐项原子写回；完成标记与数据在同一事务保存。 */
export function run_project_database_migrations(
  db: DatabaseSync,
  schema_migrations: readonly DatabaseSchemaMigration[] = DATABASE_SCHEMA_MIGRATIONS,
  writeback_migrations: readonly DatabaseWritebackMigration[] = DATABASE_WRITEBACK_MIGRATIONS,
): void {
  const context = { db };
  for (const migration of schema_migrations.toSorted((left, right) => left.order - right.order)) {
    run_in_transaction(db, () => migration.run_project_database_schema(context));
  }
  const ordered = writeback_migrations.toSorted((left, right) => left.order - right.order);
  const writeback_ids = ordered.map(({ id }) => id);
  const applied_ids = read_applied_writeback_migration_ids(db);
  for (const migration of ordered) {
    if (applied_ids.has(migration.id)) continue;
    run_in_transaction(db, () => {
      migration.run_project_database_writeback(context);
      applied_ids.add(migration.id);
      write_applied_writeback_migration_ids(db, applied_ids, writeback_ids);
    });
  }
}

/**
 * 读取已完成迁移 id；损坏或旧格式值视为未执行，让幂等迁移重新修正项目事实。
 */
function read_applied_writeback_migration_ids(db: DatabaseSync): Set<string> {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY);
  if (row === undefined) {
    return new Set<string>();
  }
  try {
    const value = JsonTool.parseStrict<unknown>(row_text(row, "value"));
    return Array.isArray(value)
      ? new Set(value.filter((entry): entry is string => typeof entry === "string"))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/**
 * 按执行顺序保存迁移 ID，便于核对持久化标记。
 */
function write_applied_writeback_migration_ids(
  db: DatabaseSync,
  applied_ids: Set<string>,
  writeback_ids: readonly string[],
): void {
  const ordered_ids = writeback_ids.filter((id) => applied_ids.has(id));
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
    JsonTool.stringifyStrict(ordered_ids),
  );
}

/**
 * 单项结构迁移或数据写回原子提交，失败时回滚并保留原始异常。
 */
function run_in_transaction(db: DatabaseSync, callback: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    callback();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 回滚失败时保留原始异常，避免掩盖真正的迁移错误
    }
    throw error;
  }
}
