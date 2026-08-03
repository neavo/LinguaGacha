import {
  type GlossaryEntry,
  type QualityRule,
  type QualityRuleEntry,
  type TextPreserveEntry,
  type TextReplacementEntry,
} from "../../domain/quality";
import { compile_text_replacements } from "../text/text-replacement-rules";
import { build_text_preserve_rule } from "../text/text-preserve-rules";
import { compile_glossary } from "./glossary";
import { ensure_quality_rule_entry_ids } from "./quality-rule-entry-id";

/** 质量规则进入任一消费链前只在这里归一字段并验证真实执行语义。 */
export function normalize_quality_rule_entries(
  rule: QualityRule,
  value: unknown,
): QualityRuleEntry[] {
  const entries = rule.normalize_entries(value);
  ensure_quality_rule_entry_ids(entries); // 补齐后的身份必须唯一，但迁移期 ID 不写回持久化条目
  if (rule.kind === "glossary") {
    compile_glossary(entries as GlossaryEntry[]);
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
    throw new TypeError("质量规则正则不是合法正则", { cause });
  }
  return entries;
}
