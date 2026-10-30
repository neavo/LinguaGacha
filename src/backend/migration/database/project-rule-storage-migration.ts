import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../../shared/utils/json-tool";
import { is_json_record, read_json_record } from "../../../domain/json";
import { row_number, row_text } from "../migration-row";

type RuleMigrationRow = Record<string, unknown>;

// 旧 Python 枚举名到当前物理规则槽位的唯一映射，冲突时保留当前小写槽位。
const LEGACY_RULE_TYPE_TO_CURRENT_TYPE = new Map([
  ["GLOSSARY", "glossary"],
  ["TEXT_PRESERVE", "text_preserve"],
  ["PRE_REPLACEMENT", "pre_translation_replacement"],
  ["POST_REPLACEMENT", "post_translation_replacement"],
  ["TRANSLATION_PROMPT", "translation_prompt"],
]);
// 条目规则最终只能落为单行数组。
const CURRENT_RULE_ENTRY_TYPES = new Set([
  "glossary",
  "text_preserve",
  "pre_translation_replacement",
  "post_translation_replacement",
]);
const CURRENT_RULE_TEXT_TYPE = "translation_prompt"; // 当前文本规则统一保存为 `{ text }` 对象。

/**
 * 迁移背景：
 * Python 旧工程使用大写规则类型，同类规则可能分散在多行。
 * 本迁移统一现行规则槽位，将条目规则保存为单行数组，将文本规则保存为 `{ text }`。
 *
 * 生效场景：
 * 数据库结构准备完成后执行规则写回。新旧槽位同时存在时保留当前小写槽位。
 * 规则身份迁移随后读取归一后的条目数组。
 *
 * 不处理范围：
 * 停用槽位保留原始记录，供历史数据恢复。当前读取只消费现行槽位。
 */
export function run_project_rule_storage_migration(db: DatabaseSync): void {
  migrate_rule_types(db);
  migrate_rule_payloads(db);
}

/**
 * 旧类型与当前类型冲突时保留当前事实，删除旧槽位残留。
 */
function migrate_rule_types(db: DatabaseSync): void {
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
function migrate_rule_payloads(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, type, data FROM rules ORDER BY id").iterate();
  const rows_by_type = new Map<string, RuleMigrationRow[]>();
  for (const row of rows) {
    const type = row_text(row, "type");
    if (!CURRENT_RULE_ENTRY_TYPES.has(type) && type !== CURRENT_RULE_TEXT_TYPE) {
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
    const normalized_data =
      rule_type === CURRENT_RULE_TEXT_TYPE
        ? { text: deserialize_rule_text_rows(rule_rows) }
        : deserialize_rule_entry_rows(rule_rows);
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
function deserialize_rule_text_rows(rows: RuleMigrationRow[]): string {
  for (const row of rows) {
    const text = deserialize_rule_text(row_text(row, "data"));
    if (text.trim() !== "") {
      return text;
    }
  }
  return "";
}

/**
 * 条目规则兼容旧对象、多行数组和散落原始值，最终输出当前数组形状。
 */
function deserialize_rule_entry_rows(rows: RuleMigrationRow[]): unknown[] {
  const first_data = try_parse_json(row_text(rows[0] ?? {}, "data"));
  if (Array.isArray(first_data)) {
    return first_data.map((entry) => (is_json_record(entry) ? entry : { value: entry }));
  }

  const entries: unknown[] = [];
  for (const row of rows) {
    const data = try_parse_json(row_text(row, "data"));
    if (Array.isArray(data)) {
      entries.push(...data.map((entry) => (is_json_record(entry) ? entry : { value: entry })));
    } else if (is_json_record(data)) {
      entries.push(data);
    }
  }
  return entries;
}

/**
 * 单行文本规则可能是 JSON 字符串，也可能已经是 `{ text }` 对象。
 */
function deserialize_rule_text(raw_data: string): string {
  const data = try_parse_json(raw_data);
  if (typeof data === "string") {
    return data;
  }
  const text = read_json_record(data)["text"];
  return typeof text === "string" ? text : String(text ?? "");
}

/**
 * 旧规则单行损坏时按空值处理，保证工程仍可打开。
 */
function try_parse_json(raw_data: string): unknown {
  try {
    return JsonTool.parseStrict(raw_data) as unknown;
  } catch {
    return null;
  }
}
