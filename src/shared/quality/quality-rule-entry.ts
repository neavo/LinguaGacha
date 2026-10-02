import {
  type QualityRule,
  type QualityRuleKind,
  type QualityRuleEntryByKind,
  type QualityRuleEntry,
  type QualityRuleGlossaryEntry,
  type TextPreserveEntry,
  type TextReplacementEntry,
} from "../../domain/quality";
import { compile_text_replacements } from "../text/text-replacement-rules";
import { build_text_preserve_rule } from "../text/text-preserve-rules";
import { compile_glossary } from "./glossary";
import { random_id } from "../utils/base62";

export const QUALITY_RULE_ENTRY_ID_LENGTH = 5;

/** 为明确的新规则分配短身份，并立即保留到调用方集合中避免同批碰撞。 */
export function create_quality_rule_entry_id(entry_ids: Set<string>): string {
  let entry_id = "";
  do {
    entry_id = random_id(QUALITY_RULE_ENTRY_ID_LENGTH);
  } while (entry_ids.has(entry_id));
  entry_ids.add(entry_id);
  return entry_id;
}

/** 为无项目身份的规则输入分配全新身份，并执行与项目条目相同的语义校验。 */
export function create_quality_rule_entries<K extends QualityRuleKind>(
  rule: QualityRule<K>,
  value: unknown,
  existing_entry_ids: readonly string[] = [],
): QualityRuleEntryByKind[K][] {
  const entry_ids = new Set(existing_entry_ids);
  const entries = rule.normalize_entries(value).map((entry) => ({
    ...entry,
    entry_id: create_quality_rule_entry_id(entry_ids),
  }));
  // 字段由具体规则归一并验证；此处恢复 TypeScript 无法追踪的规则与条目关联。
  return validate_quality_rule_entries(rule, entries) as QualityRuleEntryByKind[K][];
}

/** 项目质量规则进入任一消费链前只在这里归一身份、字段并验证真实执行语义。 */
export function normalize_quality_rule_entries<K extends QualityRuleKind>(
  rule: QualityRule<K>,
  value: unknown,
): QualityRuleEntryByKind[K][] {
  const entries = rule.normalize_entries(value).map((entry) => ({
    ...entry,
    entry_id: normalize_quality_rule_entry_id(entry.entry_id),
  }));
  // 字段由具体规则归一并验证；此处恢复 TypeScript 无法追踪的规则与条目关联。
  return validate_quality_rule_entries(rule, entries) as QualityRuleEntryByKind[K][];
}

/** 收窄项目身份；格式保持不透明，只约束可用性。 */
function normalize_quality_rule_entry_id(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Quality rule entry_id must not be empty.");
  }
  return value.trim();
}

/** 集中校验 kind 内身份唯一性和各规则真实执行语义。 */
function validate_quality_rule_entries(
  rule: QualityRule,
  entries: QualityRuleEntry[],
): QualityRuleEntry[] {
  const entry_ids = new Set<string>();
  for (const entry of entries) {
    if (entry_ids.has(entry.entry_id)) {
      throw new TypeError(`Duplicate quality rule entry_id: ${entry.entry_id}.`);
    }
    entry_ids.add(entry.entry_id);
  }
  if (rule.kind === "glossary") {
    compile_glossary(entries as QualityRuleGlossaryEntry[]);
    return entries;
  }
  try {
    if (rule.kind === "text_preserve") {
      build_text_preserve_rule({
        mode: "custom",
        text_type: "NONE",
        entries: entries as TextPreserveEntry[],
      });
    } else {
      compile_text_replacements(entries as TextReplacementEntry[]);
    }
  } catch (cause) {
    throw new TypeError("Quality rule regex is invalid.", { cause });
  }
  return entries;
}
