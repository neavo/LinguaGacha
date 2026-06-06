import {
  resolve_quality_statistics_text_source,
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
  type QualityStatisticsRuleMode,
} from "./quality-statistics";
import {
  build_legacy_quality_rule_entry_id,
  normalize_quality_rule_entry_id,
} from "./quality-rule-entry-id";
import {
  read_item_source_text_parts,
  read_item_translation_text_parts,
  type ItemTextGroup,
} from "../item-text";

export type QualityStatisticsPreparedTaskInput = {
  rule_key: QualityStatisticsRuleMode; // worker 输出仍需知道当前统计规则类型。
  rules: QualityStatisticsRuleInput[]; // 已过滤空规则后的可计算规则集合。
  src_text_groups: ItemTextGroup[]; // 当前项目原文文本组快照。
  dst_text_groups: ItemTextGroup[]; // 当前项目译文文本组快照。
  relation_candidates: QualityStatisticsRelationCandidate[]; // 父子关系计算的完整候选集合。
  completed_snapshot: QualityStatisticsDependencySnapshot; // 本次统计结果对应的依赖快照。
  completed_entry_ids: string[]; // worker 输出表必须覆盖的规则 key 列表。
};

type QualityStatisticsPrepareTaskInputArgs = {
  rule_key: QualityStatisticsRuleMode; // 决定规则解释口径和统计文本源。
  entries: unknown[]; // 后端 quality block 中的原始规则条目。
  items: Array<Record<string, unknown>>; // 项目条目快照，调用方保证来自同一 cache 读点。
};

/**
 * 从 quality 条目构造 worker 可直接消费的规则输入，空规则在边界处丢弃。
 */
export function build_quality_statistics_rules(
  rule_key: QualityStatisticsRuleMode,
  entries: unknown[],
): QualityStatisticsRuleInput[] {
  return entries.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const pattern = String(record["src"] ?? "");
    if (pattern.trim() === "") {
      return [];
    }
    return [
      {
        key: build_quality_entry_id(record, index),
        pattern,
        mode: rule_key,
        regex: rule_key === "text_preserve" ? true : Boolean(record["regex"]),
        case_sensitive: Boolean(record["case_sensitive"]),
      },
    ];
  });
}

/**
 * 父子关系只依赖规则 key 与匹配文本，和统计命中结果解耦。
 */
export function build_quality_relation_candidates(
  rules: QualityStatisticsRuleInput[],
): QualityStatisticsRelationCandidate[] {
  return rules.map((rule) => {
    return {
      key: rule.key,
      src: rule.pattern,
    };
  });
}

/**
 * 构造统计缓存依赖快照；dependency_signature 表示可复用性，snapshot_signature 保留 UI key 身份。
 */
export function build_quality_statistics_dependency_snapshot(
  rule_key: QualityStatisticsRuleMode,
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
): QualityStatisticsDependencySnapshot {
  const text_source = resolve_quality_statistics_text_source(rule_key);
  const text_signature = build_quality_text_signature(text_groups);
  // 相同规则配置可以出现多次，按出现次数补 token，避免把 entry_id 混进依赖语义。
  const occurrence_by_dependency = new Map<string, number>();
  const snapshot_rules = rules.map((rule) => {
    const dependency_signature = JSON.stringify([
      rule.mode,
      rule.pattern,
      Boolean(rule.regex),
      Boolean(rule.case_sensitive),
    ]);
    const occurrence_index = occurrence_by_dependency.get(dependency_signature) ?? 0;
    occurrence_by_dependency.set(dependency_signature, occurrence_index + 1);
    return {
      key: rule.key,
      dependency_signature,
      relation_label: rule.pattern,
      token: `${dependency_signature}:${occurrence_index.toString()}`,
    };
  });
  // dependency_signature 只表达文本源、文本内容和规则配置，允许同依赖规则复用计算结果。
  const dependency_signature = JSON.stringify({
    text_source,
    text_signature,
    tokens: snapshot_rules.map((rule) => rule.token),
  });

  return {
    text_source,
    text_signature,
    dependency_signature,
    // snapshot_signature 额外包含 key，保证 UI 缓存不会把不同条目身份混在一起。
    snapshot_signature: JSON.stringify({
      dependency_signature,
      keys: snapshot_rules.map((rule) => rule.key),
    }),
    rules: snapshot_rules,
  };
}

/**
 * 统一准备后端 cache、worker 和测试共享的统计输入，避免多处各自构造依赖签名。
 */
export function prepare_quality_statistics_task_input(
  args: QualityStatisticsPrepareTaskInputArgs,
): QualityStatisticsPreparedTaskInput {
  const src_text_groups = args.items.map((item) => read_item_source_text_parts(item));
  const dst_text_groups = args.items.map((item) => read_item_translation_text_parts(item));
  const rules = build_quality_statistics_rules(args.rule_key, args.entries);
  const relation_candidates = build_quality_relation_candidates(rules);
  const text_groups =
    resolve_quality_statistics_text_source(args.rule_key) === "dst"
      ? dst_text_groups
      : src_text_groups;
  const completed_snapshot = build_quality_statistics_dependency_snapshot(
    args.rule_key,
    rules,
    text_groups,
  );

  return {
    rule_key: args.rule_key,
    rules,
    src_text_groups,
    dst_text_groups,
    relation_candidates,
    completed_snapshot,
    completed_entry_ids: rules.map((rule) => rule.key),
  };
}

/**
 * 用字段名、字段顺序、文本长度和文本内容构造轻量签名，避免拼接歧义影响缓存身份。
 */
function build_quality_text_signature(text_groups: ItemTextGroup[]): string {
  // FNV-1a 只用来生成进程内缓存签名，安全性由完整字段 framing 保证。
  let hash = 2166136261;
  for (const [group_index, text_group] of text_groups.entries()) {
    const group_header = `${group_index.toString()}:${text_group.length.toString()}`;
    for (let char_index = 0; char_index < group_header.length; char_index += 1) {
      hash ^= group_header.charCodeAt(char_index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    for (const [part_index, part] of text_group.entries()) {
      const framed_text = [
        part_index.toString(),
        part.field,
        part.text.length.toString(),
        part.text,
      ].join(":");
      for (let char_index = 0; char_index < framed_text.length; char_index += 1) {
        hash ^= framed_text.charCodeAt(char_index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
  }
  return `${text_groups.length.toString()}:${hash.toString(36)}`;
}

/**
 * 优先使用持久化 entry_id，旧数据缺失时回到 legacy id 规则。
 */
function build_quality_entry_id(entry: Record<string, unknown>, index: number): string {
  const entry_id = normalize_quality_rule_entry_id(entry["entry_id"]);
  if (entry_id !== null) {
    return entry_id;
  }
  return build_legacy_quality_rule_entry_id(entry, index);
}
