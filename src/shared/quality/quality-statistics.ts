import type { ItemTextGroup } from "../item-text";
import { compile_literal_patterns } from "../text/literal-matcher";
import { compile_text_pattern, matches_text_pattern } from "../text/text-pattern";

export type QualityStatisticsRuleInput = {
  entry_id: string; // worker 结果与规则条目的唯一关联键
  pattern: string; // 已通过真实编译校验的规则文本
  pattern_kind: "literal" | "regex"; // 决定共享 matcher 或独立正则路径
  case_sensitive: boolean; // 匹配大小写策略
};

export type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[]; // 主线程完成归一后交给 worker 的规则
  text_groups: ItemTextGroup[]; // 每个 item 的 src/name_src 或 dst/name_dst 字段组
};

export type QualityStatisticsTaskResult = {
  hits_by_entry_id: Record<string, number>; // 每条规则命中的不同 item 数
  example_item_indexes_by_entry_id: Record<string, number[]>; // 每条规则最多两个稳定候选 item 索引
};

type ExampleCandidate = {
  item_index: number; // 命中 item 在同一输入快照中的稳定位置
  score: number; // 越小越优先进入固定的两个候选槽位
};

/** 对调用方准备好的单一文本源计算 hits，并在同一遍扫描中保留有限 example 候选。 */
export function run_quality_statistics_task_sync(
  input: QualityStatisticsTaskInput,
): QualityStatisticsTaskResult {
  const hits_by_entry_id = Object.fromEntries(input.rules.map((rule) => [rule.entry_id, 0]));
  const candidates_by_entry_id = Object.fromEntries(
    input.rules.map((rule) => [rule.entry_id, [] as ExampleCandidate[]]),
  );
  const seed_by_entry_id = new Map(
    input.rules.map((rule) => [rule.entry_id, hash_example_key(rule.entry_id)] as const),
  );

  assign_literal_hits(
    input.rules,
    input.text_groups,
    hits_by_entry_id,
    candidates_by_entry_id,
    seed_by_entry_id,
  );
  assign_regex_hits(
    input.rules,
    input.text_groups,
    hits_by_entry_id,
    candidates_by_entry_id,
    seed_by_entry_id,
  );

  return {
    hits_by_entry_id,
    example_item_indexes_by_entry_id: Object.fromEntries(
      Object.entries(candidates_by_entry_id).map(([entry_id, candidates]) => [
        entry_id,
        candidates
          .toSorted((left, right) => left.item_index - right.item_index)
          .map((candidate) => candidate.item_index),
      ]),
    ),
  };
}

/** 字面量规则共用一次 matcher 扫描；同一 item 内多字段、多次命中只计一个 hit。 */
function assign_literal_hits(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  hits_by_entry_id: Record<string, number>,
  candidates_by_entry_id: Record<string, ExampleCandidate[]>,
  seed_by_entry_id: ReadonlyMap<string, number>,
): void {
  const literal_rules = rules.filter((rule) => rule.pattern_kind === "literal");
  const matcher = compile_literal_patterns(
    literal_rules.map((rule) => ({
      key: rule.entry_id,
      text: rule.pattern,
      case_sensitive: rule.case_sensitive,
    })),
  );
  for (const [item_index, text_group] of text_groups.entries()) {
    const matched_entry_ids = new Set<string>();
    for (const part of text_group) {
      matcher.scan(part.text, (entry_id) => matched_entry_ids.add(entry_id));
    }
    for (const entry_id of matched_entry_ids) {
      hits_by_entry_id[entry_id] = (hits_by_entry_id[entry_id] ?? 0) + 1;
      offer_example_candidate(
        candidates_by_entry_id[entry_id],
        seed_by_entry_id.get(entry_id) ?? 0,
        item_index,
      );
    }
  }
}

/** 正则规则保持生产执行器语义；命中后与字面量规则共用同一稳定 example 选择。 */
function assign_regex_hits(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  hits_by_entry_id: Record<string, number>,
  candidates_by_entry_id: Record<string, ExampleCandidate[]>,
  seed_by_entry_id: ReadonlyMap<string, number>,
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
      if (pattern === null) throw new TypeError("Quality statistics regex must not be empty.");
      return { rule, pattern };
    });
  for (const { rule, pattern } of compiled) {
    for (const [item_index, text_group] of text_groups.entries()) {
      if (!text_group.some((part) => matches_text_pattern(part.text, pattern))) continue;
      hits_by_entry_id[rule.entry_id] = (hits_by_entry_id[rule.entry_id] ?? 0) + 1;
      offer_example_candidate(
        candidates_by_entry_id[rule.entry_id],
        seed_by_entry_id.get(rule.entry_id) ?? 0,
        item_index,
      );
    }
  }
}

/** 固定二槽选择避免为每个命中分配、排序完整候选集合。 */
function offer_example_candidate(
  candidates: ExampleCandidate[] | undefined,
  seed: number,
  item_index: number,
): void {
  if (candidates === undefined) return;
  const score = score_example(seed, item_index);
  if (candidates.length < 2) {
    candidates.push({ item_index, score });
    return;
  }
  const worst_index = (candidates[0]?.score ?? 0) >= (candidates[1]?.score ?? 0) ? 0 : 1;
  const worst = candidates[worst_index];
  if (
    worst !== undefined &&
    (score < worst.score || (score === worst.score && item_index < worst.item_index))
  ) {
    candidates[worst_index] = { item_index, score };
  }
}

/** 把稳定规则身份折叠为抽样种子，避免所有规则总是选择同一批 item。 */
function hash_example_key(entry_id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < entry_id.length; index += 1) {
    hash ^= entry_id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** 混合规则种子与 item 位置；同一快照结果确定，又不偏向列表首尾。 */
function score_example(seed: number, item_index: number): number {
  let score = Math.imul(seed ^ item_index, 0x45d9f3b) >>> 0;
  score = Math.imul(score ^ (score >>> 16), 0x45d9f3b) >>> 0;
  return (score ^ (score >>> 16)) >>> 0;
}
