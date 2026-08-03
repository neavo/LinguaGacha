import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import {
  read_item_source_text_parts,
  read_item_translation_text_parts,
  type ItemTextGroup,
} from "../item-text";
import {
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
} from "./quality-statistics";
import { normalize_quality_rule_entries } from "./quality-rule-entry";
import { ensure_quality_rule_entry_ids } from "./quality-rule-entry-id";

export type QualityStatisticsPreparedTaskInput = {
  rules: QualityStatisticsRuleInput[]; // worker 执行规则
  text_groups: ItemTextGroup[]; // worker 扫描的 item 字段组
  relation_candidates: QualityStatisticsRelationCandidate[]; // 字面量父子关系输入
  completed_snapshot: QualityStatisticsDependencySnapshot; // cache 与页面共同校验的依赖快照
  completed_entry_ids: string[]; // worker 完成后允许页面展示的条目身份
  collect_literal_evidence: boolean; // 仅 Agent glossary 查询开启有限证据
};

type QualityStatisticsPrepareTaskInputArgs = {
  rule_key: QualityRuleKind; // 决定规则结构和扫描文本侧
  entries: unknown; // 来自 cache 的未信任规则批次
  items: Array<Record<string, unknown>>; // cache item 快照，不向 worker 传可变引用
  collect_literal_evidence?: boolean; // 默认 false，不扩大 GUI/cache 响应
};

/** 在主线程完成规则类型、文本来源和缓存身份解析，worker 只做纯计算。 */
export function prepare_quality_statistics_task_input(
  args: QualityStatisticsPrepareTaskInputArgs,
): QualityStatisticsPreparedTaskInput {
  const rule = QualityRule.from_json(args.rule_key);
  const entries = ensure_quality_rule_entry_ids(normalize_quality_rule_entries(rule, args.entries));
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
  const text_groups = args.items.map((item) =>
    text_source === "dst"
      ? read_item_translation_text_parts(item)
      : read_item_source_text_parts(item),
  );
  const relation_candidates = rules.flatMap((statistics_rule) =>
    statistics_rule.pattern_kind === "literal"
      ? [{ entry_id: statistics_rule.entry_id, src: statistics_rule.pattern }]
      : [],
  );
  const completed_snapshot = build_dependency_snapshot(text_source, rules, text_groups);
  return {
    rules,
    text_groups,
    relation_candidates,
    completed_snapshot,
    completed_entry_ids: rules.map((statistics_rule) => statistics_rule.entry_id),
    collect_literal_evidence: args.collect_literal_evidence === true,
  };
}

/** 规则依赖签名不混入 entry_id，相同配置仍按出现序号保持独立。 */
function build_dependency_snapshot(
  text_source: "src" | "dst",
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
): QualityStatisticsDependencySnapshot {
  const text_signature = build_quality_text_signature(text_groups);
  const occurrence_by_dependency = new Map<string, number>();
  const snapshot_rules = rules.map((rule) => {
    const dependency_signature = JSON.stringify([
      rule.pattern_kind,
      rule.pattern,
      rule.case_sensitive,
    ]);
    const occurrence = occurrence_by_dependency.get(dependency_signature) ?? 0;
    occurrence_by_dependency.set(dependency_signature, occurrence + 1);
    return {
      key: rule.entry_id,
      dependency_signature,
      token: `${dependency_signature}:${occurrence.toString()}`,
    };
  });
  const dependency_signature = JSON.stringify({
    text_source,
    text_signature,
    tokens: snapshot_rules.map((rule) => rule.token),
  });
  return {
    text_source,
    text_signature,
    dependency_signature,
    snapshot_signature: JSON.stringify({
      dependency_signature,
      entry_ids: snapshot_rules.map((rule) => rule.key),
    }),
    rules: snapshot_rules,
  };
}

/**
 * 构造进程内文本缓存签名。
 * ponytail: 当前 32 位签名延续既有缓存成本；若实测碰撞风险不可接受，再替换为共享稳定哈希。
 */
function build_quality_text_signature(text_groups: ItemTextGroup[]): string {
  let hash = 2166136261;
  for (const [group_index, text_group] of text_groups.entries()) {
    for (const value of [
      `${group_index.toString()}:${text_group.length.toString()}`,
      ...text_group.map(
        (part, part_index) =>
          `${part_index.toString()}:${part.field}:${part.text.length.toString()}:${part.text}`,
      ),
    ]) {
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
  }
  return `${text_groups.length.toString()}:${hash.toString(36)}`;
}
