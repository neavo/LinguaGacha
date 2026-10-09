import { compile_literal_patterns } from "../text/literal-matcher";

export type QualityRuleSubsetCandidate = {
  entry_id: string; // 结果与规则条目的稳定关联键
  src: string; // 规则匹配文本
  pattern_kind: "literal" | "regex"; // 正则源码不参与字面包含关系
  case_sensitive: boolean; // 复用规则实际的大小写策略
};

/** 返回每个字面规则被哪些更长原文真实包含；完全等价不算父项。 */
export function find_quality_rule_subset_parents(
  candidates: QualityRuleSubsetCandidate[],
): Record<string, string[]> {
  const literals = candidates.filter((candidate) => candidate.pattern_kind === "literal");
  const matcher = compile_literal_patterns(
    literals.map((candidate) => ({
      key: candidate.entry_id,
      text: candidate.src,
      case_sensitive: candidate.case_sensitive,
    })),
  );
  // `entry_id` 来自持久化事实，`Map` 与无原型返回值避免原型成员冲突。
  const parents_by_entry_id = new Map<string, Set<string>>();

  for (const parent of literals) {
    matcher.scan(parent.src, (child_id, range) => {
      if (child_id !== parent.entry_id && (range.start > 0 || range.end < parent.src.length)) {
        const parent_sources = parents_by_entry_id.get(child_id) ?? new Set<string>();
        parent_sources.add(parent.src); // 同一父项重复命中、多个父项同文时都只保留首次结果。
        parents_by_entry_id.set(child_id, parent_sources);
      }
    });
  }

  const result = Object.create(null) as Record<string, string[]>;
  for (const [id, sources] of parents_by_entry_id) result[id] = [...sources];
  return result;
}
