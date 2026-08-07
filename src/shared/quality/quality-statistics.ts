import type { ItemTextGroup } from "../item-text";
import { compile_literal_patterns, type TextRange } from "../text/literal-matcher";
import { compile_text_pattern, matches_text_pattern } from "../text/text-pattern";
import {
  find_quality_rule_subset_parents,
  type QualityRuleRelationCandidate,
} from "./quality-rule-relations";

const LITERAL_CONTEXT_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;

export type QualityStatisticsRuleInput = {
  entry_id: string; // worker 结果与页面条目的唯一关联键
  pattern: string; // 已通过真实编译校验的规则文本
  pattern_kind: "literal" | "regex"; // 决定共享 matcher 或独立正则路径
  case_sensitive: boolean; // 匹配大小写策略
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
  relation_candidates: QualityRuleRelationCandidate[]; // 仅需计算包含关系的字面量规则
  collect_context_samples?: boolean; // Agent glossary 查询才收集有限代表语境
};

export type QualityStatisticsContextSample = {
  item_index: number; // 与输入 text_groups 和 captured items 的稳定数组索引一致
};

export type QualityStatisticsTaskResult = {
  results: Record<
    string,
    {
      matched_item_count: number; // 至少一个字段命中的 item 数，不累计同 item 次数
      subset_parents: string[]; // 包含当前 src 的更长字面量源文
    }
  >;
  context_samples_by_entry_id?: Record<string, QualityStatisticsContextSample[]>; // 仅显式请求时返回
};

/** 内部候选额外携带稳定抽样分数，不越过 worker 边界。 */
type QualityStatisticsContextSampleCandidate = QualityStatisticsContextSample & {
  score: number; // 越小越优先，最终结果只保留两个候选
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
  const context_sample_candidates_by_entry_id = input.collect_context_samples
    ? Object.fromEntries(
        input.rules
          .filter((rule) => rule.pattern_kind === "literal")
          .map((rule) => [rule.entry_id, [] as QualityStatisticsContextSampleCandidate[]]),
      )
    : undefined;
  assign_literal_counts(
    input.rules,
    input.text_groups,
    results,
    context_sample_candidates_by_entry_id,
  );
  assign_regex_counts(input.rules, input.text_groups, results);

  const subset_parents = find_quality_rule_subset_parents(input.relation_candidates);
  for (const [entry_id, parents] of Object.entries(subset_parents)) {
    const result = results[entry_id];
    if (result !== undefined) result.subset_parents = parents;
  }
  return {
    results,
    ...(context_sample_candidates_by_entry_id === undefined
      ? {}
      : {
          context_samples_by_entry_id: Object.fromEntries(
            Object.entries(context_sample_candidates_by_entry_id).map(([entry_id, candidates]) => [
              entry_id,
              candidates
                .toSorted((left, right) => left.item_index - right.item_index)
                .map(({ item_index }) => ({ item_index })),
            ]),
          ),
        }),
  };
}

/** 字面量规则共用一次 matcher 扫描，并在每个 item 内累计覆盖数与有限证据。 */
function assign_literal_counts(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  results: QualityStatisticsTaskResult["results"],
  context_sample_candidates_by_entry_id:
    | Record<string, QualityStatisticsContextSampleCandidate[]>
    | undefined,
): void {
  const literal_rules = rules.filter((rule) => rule.pattern_kind === "literal");
  const sample_seed_by_entry_id = new Map(
    literal_rules.map((rule) => [rule.entry_id, hash_context_sample_key(rule.entry_id)] as const),
  );
  const matcher = compile_literal_patterns(
    literal_rules.map((rule) => ({
      key: rule.entry_id,
      text: rule.pattern,
      case_sensitive: rule.case_sensitive,
    })),
  );
  for (const [item_index, text_group] of text_groups.entries()) {
    const matched_entry_ids = new Set<string>();
    const ranges_by_entry_id =
      context_sample_candidates_by_entry_id === undefined
        ? undefined
        : new Map<string, Map<number, TextRange[]>>();
    for (const [part_index, part] of text_group.entries()) {
      matcher.scan(part.text, (entry_id, range) => {
        matched_entry_ids.add(entry_id);
        if (ranges_by_entry_id === undefined) return;
        const part_ranges = ranges_by_entry_id.get(entry_id) ?? new Map<number, TextRange[]>();
        const ranges = part_ranges.get(part_index) ?? [];
        ranges.push(range);
        part_ranges.set(part_index, ranges);
        ranges_by_entry_id.set(entry_id, part_ranges);
      });
    }
    for (const entry_id of matched_entry_ids) {
      const result = results[entry_id];
      if (result !== undefined) result.matched_item_count += 1;
      const candidates = context_sample_candidates_by_entry_id?.[entry_id];
      const ranges_by_part = ranges_by_entry_id?.get(entry_id);
      if (
        candidates !== undefined &&
        ranges_by_part !== undefined &&
        has_literal_context(text_group, ranges_by_part)
      ) {
        candidates.push({
          item_index,
          score: score_context_sample(sample_seed_by_entry_id.get(entry_id) ?? 0, item_index),
        });
        candidates.sort(
          (left, right) => left.score - right.score || left.item_index - right.item_index,
        );
        if (candidates.length > 2) candidates.pop();
      }
    }
  }
}

/** 同一 entry 与 item 在相同快照中得到稳定分数，bottom-2 不偏向自然顺序首尾。 */
function hash_context_sample_key(entry_id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < entry_id.length; index += 1) {
    hash ^= entry_id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** 混合术语 seed 与 item 索引，避免连续条目总是选中列表头部或尾部。 */
function score_context_sample(seed: number, item_index: number): number {
  let score = Math.imul(seed ^ item_index, 0x45d9f3b) >>> 0;
  score = Math.imul(score ^ (score >>> 16), 0x45d9f3b) >>> 0;
  return (score ^ (score >>> 16)) >>> 0;
}

/** 命中区间之外仍有 Unicode 字母或数字时，该 item 才能作为有效语境。 */
function has_literal_context(
  text_group: ItemTextGroup,
  ranges_by_part: Map<number, TextRange[]>,
): boolean {
  return text_group.some((part, part_index) => {
    const ranges = ranges_by_part.get(part_index);
    if (ranges === undefined) return LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text);
    const merged: TextRange[] = [];
    for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
      const previous = merged.at(-1);
      if (previous === undefined || range.start > previous.end) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
    }
    let cursor = 0;
    for (const range of merged) {
      if (LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text.slice(cursor, range.start))) return true;
      cursor = range.end;
    }
    return LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text.slice(cursor));
  });
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
