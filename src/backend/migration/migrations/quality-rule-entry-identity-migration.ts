import type { DatabaseSync } from "node:sqlite";

import { is_json_record, type JsonValue } from "../../../domain/json";
import { QualityRule } from "../../../domain/quality";
import { create_quality_rule_entry_id } from "../../../shared/quality/quality-rule-entry";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_text } from "../migration-row";
import type {
  DatabaseWritebackMigration,
  ProjectDatabaseMigrationContext,
} from "../migration-types";

/** 依赖 project-rule-storage 先把条目规则归一为单行数组。 */
export const quality_rule_entry_identity_migration: DatabaseWritebackMigration = {
  id: "quality-rule-entry-identity",
  order: 250,
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    run_quality_rule_entry_identity_migration(context.db);
  },
};

/** 补齐或修复规则身份，重放时保留已分配的合法身份。 */
export function run_quality_rule_entry_identity_migration(db: DatabaseSync): void {
  const read_rule_row = db.prepare("SELECT data FROM rules WHERE type = ?");
  const update_rule_row = db.prepare("UPDATE rules SET data = ? WHERE type = ?");
  const changed_rules: QualityRule[] = []; // 只推进真实变化 kind 的 revision。

  for (const rule of QualityRule.all()) {
    const row = read_rule_row.get(rule.database_type);
    if (row === undefined) {
      continue;
    }
    const entries = read_rule_entries(row_text(row, "data"));
    const migrated = migrate_rule_entries(entries);
    if (!migrated.changed) {
      continue;
    }
    update_rule_row.run(JsonTool.stringifyStrict(migrated.entries), rule.database_type);
    changed_rules.push(rule);
  }

  if (changed_rules.length > 0) {
    bump_changed_rule_revisions(db, changed_rules);
  }
}

/** 先预留全部非空身份，避免新身份抢占后续事实。迁移重放沿用已有编码。 */
function migrate_rule_entries(entries: JsonValue[]): { entries: JsonValue[]; changed: boolean } {
  const occupied_entry_ids = new Set(
    entries.flatMap((entry) => {
      if (!is_json_record(entry)) {
        return [];
      }
      const entry_id = read_entry_id(entry["entry_id"]);
      return entry_id === "" ? [] : [entry_id];
    }),
  );
  const kept_entry_ids = new Set<string>(); // 同类重复身份只保留首项。
  let changed = false;
  const migrated_entries = entries.map((entry) => {
    if (!is_json_record(entry)) {
      return entry;
    }
    const entry_id = read_entry_id(entry["entry_id"]);
    const next_id =
      entry_id !== "" && !kept_entry_ids.has(entry_id)
        ? entry_id
        : create_quality_rule_entry_id(occupied_entry_ids);
    kept_entry_ids.add(next_id);
    if (next_id === entry["entry_id"]) return entry;
    changed = true;
    return { ...entry, entry_id: next_id };
  });
  return { entries: migrated_entries, changed };
}

/** 与运行期采用相同的去空白规则，缺失或无效类型由迁移分配新身份。 */
function read_entry_id(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 多个 kind 的同批身份变化共用一个 aggregate quality revision。 */
function bump_changed_rule_revisions(db: DatabaseSync, changed_rules: QualityRule[]): void {
  const next_revision =
    Math.max(...QualityRule.all().map((rule) => read_revision(db, rule.revision_meta_key)), 0) + 1;
  const write = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  for (const rule of changed_rules) {
    write.run(rule.revision_meta_key, JsonTool.stringifyStrict(next_revision));
  }
}

/** 对齐项目读取边界，把缺失、非有限或负数 revision 收窄为稳定基线。 */
function read_revision(db: DatabaseSync, key: string): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (row === undefined) {
    return 0;
  }
  const value = Number(JsonTool.parseStrict(row_text(row, "value")) ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** 前置存储迁移保证条目规则为数组，违约时直接阻止错误事实继续写回。 */
function read_rule_entries(raw_data: string): JsonValue[] {
  const value = JsonTool.parseStrict<JsonValue>(raw_data);
  if (!Array.isArray(value)) {
    throw new TypeError("Quality rule migration payload must be an array.");
  }
  return value;
}
