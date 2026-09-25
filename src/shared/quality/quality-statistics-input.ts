import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import { read_item_source_text_parts, read_item_translation_text_parts } from "../item-text";
import { split_text_lines } from "../text/text-lines";
import {
  project_text_resource_references,
  split_text_around_resource_references,
} from "../text/text-resource-reference";
import type { QualityStatisticsRuleInput, QualityStatisticsTextGroup } from "./quality-statistics";
import { normalize_quality_rule_entries } from "./quality-rule-entry";

export type QualityStatisticsPreparedTaskInput = {
  rule_key: QualityRuleKind;
  rules: QualityStatisticsRuleInput[]; // worker 执行规则
  text_groups: QualityStatisticsTextGroup[]; // worker 扫描的 item 字段组
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
  const text_groups = args.items.map((item): QualityStatisticsTextGroup => {
    if (args.rule_key === "glossary") return read_item_source_text_parts(item);
    if (args.rule_key === "text_preserve") {
      return read_item_source_text_parts(item).flatMap((part) => {
        const texts = part.field === "src" ? split_text_lines(part.text) : [part.text];
        return texts.map((text) => {
          const projection = project_text_resource_references(text);
          return {
            field: part.field,
            text: projection.text,
            reference_mappings: projection.mappings,
          };
        });
      });
    }
    // 替换只作用于正文，资源两侧独立匹配；统计不重放替换链或依赖翻译开关。
    const parts =
      text_source === "dst"
        ? read_item_translation_text_parts(item)
        : read_item_source_text_parts(item);
    return parts
      .filter((part) => part.field === text_source)
      .flatMap((part) =>
        split_text_lines(part.text).map((line) => ({
          field: part.field,
          text: line,
          matching_texts: split_text_around_resource_references(line),
        })),
      );
  });
  return {
    rule_key: args.rule_key,
    rules,
    text_groups,
    entry_ids: rules.map((statistics_rule) => statistics_rule.entry_id),
    text_source,
  };
}
