import type { DatabaseSync } from "node:sqlite";
import type { DatabaseWritebackMigration } from "./migration-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { row_text } from "./migration-row";
import { run_project_schema_migration } from "./database/project-schema-migration";
import { run_project_item_public_contract_migration } from "./database/project-item-public-contract-migration";
import { run_project_item_stable_metadata_migration } from "./database/project-item-stable-metadata-migration";
import { run_project_rule_storage_migration } from "./database/project-rule-storage-migration";
import { run_quality_rule_entry_identity_migration } from "./database/quality-rule-entry-identity-migration";
import { run_trans_item_metadata_migration } from "./database/trans-item-metadata-migration";

// 顺序是历史升级契约：规则存储先于身份，基础 Item 先于 TRANS，最后补公开字段。
const DATABASE_WRITEBACK_MIGRATIONS: readonly DatabaseWritebackMigration[] = [
  { id: "project-rule-storage", run: run_project_rule_storage_migration },
  { id: "quality-rule-entry-identity", run: run_quality_rule_entry_identity_migration },
  { id: "project-item-stable-metadata", run: run_project_item_stable_metadata_migration },
  { id: "trans-item-metadata", run: run_trans_item_metadata_migration },
  { id: "project-item-public-contract", run: run_project_item_public_contract_migration },
];
export const PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY =
  "applied_writeback_migrations";

/** 首次打开连接先补结构，再执行逐项原子写回。完成标记与数据在同一事务保存。 */
export function run_project_database_migrations(
  db: DatabaseSync,
  writeback_migrations: readonly DatabaseWritebackMigration[] = DATABASE_WRITEBACK_MIGRATIONS,
): void {
  run_in_transaction(db, () => run_project_schema_migration(db));
  const writeback_ids = writeback_migrations.map(({ id }) => id);
  const applied_ids = read_applied_writeback_migration_ids(db);
  for (const migration of writeback_migrations) {
    if (applied_ids.has(migration.id)) continue;
    run_in_transaction(db, () => {
      migration.run(db);
      applied_ids.add(migration.id);
      write_applied_writeback_migration_ids(db, applied_ids, writeback_ids);
    });
  }
}

/**
 * 读取已完成迁移 id。损坏或旧格式值视为未执行，让幂等迁移重新修正项目事实。
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
