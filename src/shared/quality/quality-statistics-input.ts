import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import {
  read_item_source_text_parts,
  read_item_translation_text_parts,
  split_item_text_parts_by_line,
  type ItemTextGroup,
} from "../item-text";
import type { QualityStatisticsRuleInput } from "./quality-statistics";
import { normalize_quality_rule_entries } from "./quality-rule-entry";

export type QualityStatisticsPreparedTaskInput = {
  rule_key: QualityRuleKind;
  rules: QualityStatisticsRuleInput[]; // worker 执行规则
  text_groups: ItemTextGroup[]; // worker 扫描的 item 字段组
  entry_ids: string[]; // 按规则顺序约束结果身份
  text_source: "src" | "dst"; // examples 投影使用的实际文本侧
};

type QualityStatisticsPrepareTaskInputArgs = {
  rule_key: QualityRuleKind; // 决定规则结构和扫描文本侧
  entries: unknown; // 来自 cache 的未信任规则批次
  items: Array<Record<string, unknown>>; // cache item 快照，不向 worker 传可变引用
};

/** 在主线程完成规则类型、文本来源和缓存身份解析，worker 只做纯计算。 */
export function prepare_quality_statistics_task_input(
  args: QualityStatisticsPrepareTaskInputArgs,
): QualityStatisticsPreparedTaskInput {
  const rule = QualityRule.from_json(args.rule_key);
  const entries = normalize_quality_rule_entries(rule, args.entries);
  const rules = entries.map((entry): QualityStatisticsRuleInput => {
    const pattern_kind =
      args.rule_key === "text_preserve" ||
      ((args.rule_key === "pre_replacement" || args.rule_key === "post_replacement") &&
        "regex" in entry &&
        entry.regex)
        ? "regex"
        : "literal";
    return {
      entry_id: entry.entry_id,
      pattern: entry.src,
      pattern_kind,
      case_sensitive:
        args.rule_key === "text_preserve"
          ? false
          : "case_sensitive" in entry && entry.case_sensitive,
    };
  });
  const text_source = args.rule_key === "post_replacement" ? "dst" : "src";
  const text_groups = args.items.map((item) => {
    const parts =
      text_source === "dst"
        ? read_item_translation_text_parts(item)
        : read_item_source_text_parts(item);
    return args.rule_key === "glossary" ? parts : split_item_text_parts_by_line(parts);
  });
  return {
    rule_key: args.rule_key,
    rules,
    text_groups,
    entry_ids: rules.map((statistics_rule) => statistics_rule.entry_id),
    text_source,
  };
}
