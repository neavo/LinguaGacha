import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../../shared/utils/json-tool";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type RuleMigrationRow = Record<string, unknown>;

// 旧 Python 枚举名到当前物理规则槽位的唯一映射，冲突时保留当前小写槽位。
const LEGACY_RULE_TYPE_TO_CURRENT_TYPE = new Map([
  ["GLOSSARY", "glossary"],
  ["TEXT_PRESERVE", "text_preserve"],
  ["PRE_REPLACEMENT", "pre_translation_replacement"],
  ["POST_REPLACEMENT", "post_translation_replacement"],
  ["TRANSLATION_PROMPT", "translation_prompt"],
  ["ANALYSIS_PROMPT", "analysis_prompt"],
]);
// 条目规则最终只能落为单行数组。
const CURRENT_RULE_ENTRY_TYPES = new Set([
  "glossary",
  "text_preserve",
  "pre_translation_replacement",
  "post_translation_replacement",
]);
// 文本规则最终只能落为 `{ text }` 对象，旧语言提示词槽位保留给后续业务迁移读取。
const CURRENT_RULE_TEXT_TYPES = new Set([
  "translation_prompt",
  "analysis_prompt",
  "CUSTOM_PROMPT_ZH",
  "CUSTOM_PROMPT_EN",
]);

/**
 * 迁移背景：
 * Python 旧工程把规则类型持久化为大写枚举，且同一规则可能拆成多行；
 * 文本规则也可能直接存 JSON 字符串。当前规则表只暴露小写物理槽位，
 * 条目规则落为单行数组，文本规则落为 `{ text }` 对象。
 *
 * 生效场景：
 * `.lg` schema 可用后，打开旧工程时一次性归一 rules 表。
 *
 * 不处理范围：
 * 旧翻译提示词 ZH/EN 槽位是否要补写到当前 `translation_prompt`，
 * 属于项目打开期业务语义迁移，不在本文件读应用语言或生成 operation。
 */
export const project_rule_storage_migration: MigrationDescriptor = {
  id: "project-rule-storage",
  order: 200,
  /**
   * rules 表迁移必须早于项目打开期提示词槽位迁移，确保读取到当前 payload 形状。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    ProjectRuleStorageMigration.run(context.db);
  },
};

/**
 * 负责把 rules 表从旧多行/大写/散装 payload 收敛为当前规则存储契约。
 */
export class ProjectRuleStorageMigration {
  /**
   * 先归一规则类型名，再归一同类型多行 payload，避免旧大写槽位重复参与合并。
   */
  public static run(db: DatabaseSync): void {
    this.migrate_rule_types(db);
    this.migrate_rule_payloads(db);
  }

  /**
   * 旧类型与当前类型冲突时保留当前事实，删除旧槽位残留。
   */
  private static migrate_rule_types(db: DatabaseSync): void {
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
   * 同类型规则压成一行：条目规则为数组，文本规则为 `{ text }`。
   */
  private static migrate_rule_payloads(db: DatabaseSync): void {
    const rows = db.prepare("SELECT id, type, data FROM rules ORDER BY id").all();
    const rows_by_type = new Map<string, RuleMigrationRow[]>();
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
      const first_row = rule_rows[0];
      if (first_row === undefined) {
        continue;
      }
      const normalized_data = CURRENT_RULE_TEXT_TYPES.has(rule_type)
        ? { text: this.deserialize_rule_text_rows(rule_rows) }
        : this.deserialize_rule_entry_rows(rule_rows);
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
   * 文本规则按行读取第一个非空文本，兼容旧字符串和当前对象载荷。
   */
  private static deserialize_rule_text_rows(rows: RuleMigrationRow[]): string {
    for (const row of rows) {
      const text = this.deserialize_rule_text(row_text(row, "data"));
      if (text.trim() !== "") {
        return text;
      }
    }
    return "";
  }

  /**
   * 条目规则兼容旧对象、多行数组和散落原始值，最终输出当前数组形状。
   */
  private static deserialize_rule_entry_rows(rows: RuleMigrationRow[]): unknown[] {
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
   * 单行文本规则可能是 JSON 字符串，也可能已经是 `{ text }` 对象。
   */
  private static deserialize_rule_text(raw_data: string): string {
    const data = this.try_parse_json(raw_data);
    if (typeof data === "string") {
      return data;
    }
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const text = (data as RuleMigrationRow)["text"];
      return typeof text === "string" ? text : String(text ?? "");
    }
    return "";
  }

  /**
   * 旧规则单行损坏时按空值处理，保证工程仍可打开。
   */
  private static try_parse_json(raw_data: string): unknown {
    try {
      return JsonTool.parseStrict(raw_data) as unknown;
    } catch {
      return null;
    }
  }
}

/**
 * rules 表读取文本统一收窄，避免 SQLite 底层类型差异影响迁移。
 */
function row_text(row: RuleMigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * rules 表 id 写回前统一转 number，兼容 bigint 返回。
 */
function row_number(row: RuleMigrationRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}
