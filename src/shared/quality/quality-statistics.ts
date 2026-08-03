import type { ItemTextGroup } from "../item-text";
import { compile_literal_patterns, fold_literal_text } from "../text/literal-matcher";
import { compile_text_pattern, matches_text_pattern } from "../text/text-pattern";

export type QualityStatisticsRuleInput = {
  entry_id: string; // worker 结果与页面条目的唯一关联键
  pattern: string; // 已通过真实编译校验的规则文本
  pattern_kind: "literal" | "regex"; // 决定共享 matcher 或独立正则路径
  case_sensitive: boolean; // 匹配大小写策略
};

export type QualityStatisticsRelationCandidate = {
  entry_id: string; // 与统计规则共享的结果键
  src: string; // 仅字面量规则参与父子包含关系
};

type QualityStatisticsDependencyRuleSnapshot = {
  key: string; // 当前 entry_id，变更时只影响结果身份
  dependency_signature: string; // 不含身份的规则执行配置
  token: string; // 同配置规则按出现顺序区分的依赖令牌
};

export type QualityStatisticsDependencySnapshot = {
  text_source: "src" | "dst"; // 当前规则实际扫描的 item 文本侧
  text_signature: string; // 进程内判断文本事实是否改变的签名
  dependency_signature: string; // 忽略 entry_id 的计算依赖签名
  snapshot_signature: string; // 包含 entry_id 的页面结果身份签名
  rules: QualityStatisticsDependencyRuleSnapshot[]; // 按输入顺序保存规则依赖
};

export type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[]; // 主线程完成归一后交给 worker 的规则
  text_groups: ItemTextGroup[]; // 每个 item 的 src/name_src 或 dst/name_dst 字段组
  relation_candidates: QualityStatisticsRelationCandidate[]; // 仅需计算包含关系的字面量规则
};

export type QualityStatisticsTaskResult = {
  results: Record<
    string,
    {
      matched_item_count: number; // 至少一个字段命中的 item 数，不累计同 item 次数
      subset_parents: string[]; // 包含当前 src 的更长字面量源文
    }
  >;
};

/** 对调用方准备好的单一文本源计算命中 item 数和字面量包含关系。 */
export function run_quality_statistics_task_sync(
  input: QualityStatisticsTaskInput,
): QualityStatisticsTaskResult {
  const results = Object.fromEntries(
    input.rules.map((rule) => [
      rule.entry_id,
      { matched_item_count: 0, subset_parents: [] as string[] },
    ]),
  );
  assign_literal_counts(input.rules, input.text_groups, results);
  assign_regex_counts(input.rules, input.text_groups, results);

  const subset_parents = build_subset_relation_map(input.relation_candidates);
  for (const [entry_id, parents] of Object.entries(subset_parents)) {
    const result = results[entry_id];
    if (result !== undefined) result.subset_parents = parents;
  }
  return { results };
}

/** 字面量规则共用一次 matcher 扫描，并在每个 item 内按 entry_id 去重。 */
function assign_literal_counts(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  results: QualityStatisticsTaskResult["results"],
): void {
  const literal_rules = rules.filter((rule) => rule.pattern_kind === "literal");
  const matcher = compile_literal_patterns(
    literal_rules.map((rule) => ({
      key: rule.entry_id,
      text: rule.pattern,
      case_sensitive: rule.case_sensitive,
    })),
  );
  for (const text_group of text_groups) {
    const matched = new Set<string>();
    for (const part of text_group) {
      for (const match of matcher.match(part.text)) matched.add(match.key);
    }
    for (const entry_id of matched) {
      const result = results[entry_id];
      if (result !== undefined) result.matched_item_count += 1;
    }
  }
}

/** 正则规则独立统计至少命中一个字段的 item 数。 */
function assign_regex_counts(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  results: QualityStatisticsTaskResult["results"],
): void {
  const compiled = rules
    .filter((rule) => rule.pattern_kind === "regex")
    .map((rule) => {
      const pattern = compile_text_pattern({
        source_text: rule.pattern,
        mode: "regex",
        case_sensitive: rule.case_sensitive,
        trim: false,
      });
      if (pattern === null) throw new TypeError("质量统计正则不能为空");
      return { rule, pattern };
    });
  for (const { rule, pattern } of compiled) {
    for (const text_group of text_groups) {
      if (text_group.some((part) => matches_text_pattern(part.text, pattern))) {
        const result = results[rule.entry_id];
        if (result !== undefined) result.matched_item_count += 1;
      }
    }
  }
}

/** 包含关系只比较显式字面量候选，并按父文本首次出现顺序输出。 */
function build_subset_relation_map(
  candidates: QualityStatisticsRelationCandidate[],
): Record<string, string[]> {
  const snapshots = candidates.map((candidate) => ({
    ...candidate,
    folded: fold_literal_text(candidate.src),
  }));
  const snapshot_by_entry_id = new Map(
    snapshots.map((snapshot) => [snapshot.entry_id, snapshot] as const),
  );
  const matcher = compile_literal_patterns(
    snapshots.map((snapshot) => ({
      key: snapshot.entry_id,
      text: snapshot.folded,
      case_sensitive: true,
    })),
  );
  const result: Record<string, string[]> = {};
  const seen_parent_text = new Set<string>();
  for (const parent of snapshots) {
    if (seen_parent_text.has(parent.folded)) continue;
    seen_parent_text.add(parent.folded);
    for (const match of matcher.match(parent.folded)) {
      const child = snapshot_by_entry_id.get(match.key);
      if (
        child === undefined ||
        child.entry_id === parent.entry_id ||
        child.folded.length >= parent.folded.length
      ) {
        continue;
      }
      const parents = result[child.entry_id] ?? [];
      parents.push(parent.src);
      result[child.entry_id] = parents;
    }
  }
  return result;
}
