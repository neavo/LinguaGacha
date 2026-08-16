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
  // entry_id 来自持久化事实，null prototype 避免合法 ID 与对象原型成员冲突。
  const parents_by_entry_id = Object.create(null) as Record<string, string[]>;

  for (const parent of literals) {
    const partial_child_ids = new Set<string>();
    matcher.scan(parent.src, (child_id, range) => {
      if (child_id !== parent.entry_id && (range.start > 0 || range.end < parent.src.length)) {
        partial_child_ids.add(child_id);
      }
    });
    for (const child_id of partial_child_ids) {
      const parent_sources = parents_by_entry_id[child_id] ?? [];
      if (!parent_sources.includes(parent.src)) parent_sources.push(parent.src);
      parents_by_entry_id[child_id] = parent_sources;
    }
  }

  return parents_by_entry_id;
}
