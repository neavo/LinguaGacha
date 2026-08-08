import { compile_literal_patterns, normalize_literal_text } from "../text/literal-matcher";

/** 潜在词根按用户可见字符切分，避免拆开代理对或组合字符。 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const MIN_LATENT_ROOT_GRAPHEMES = 2; // 单字相似不足以形成共同审校关系
const MIN_LATENT_ROOT_COVERAGE = 0.5; // 词根至少覆盖每个候选的一半
const MAX_LATENT_GROUP_ENTRIES = 12; // 限制弱关系组规模，强包含组不受此限制

export type QualityRuleRelationCandidate = {
  entry_id: string; // 关系结果与规则条目的稳定关联键
  src: string; // 规则匹配文本
  pattern_kind: "literal" | "regex"; // 正则只参与确定性重复分组
  case_sensitive: boolean; // 强包含关系复用规则真实的大小写策略
};

export type QualityRuleRelations = {
  subset_parents_by_entry_id: Record<string, string[]>; // 子条目 ID 到真实包含父文本
  groups: string[][]; // 按输入顺序排列、互斥且包含单例的共同审校组
};

type StrongGroup = {
  entry_indexes: number[]; // 同一强连通分量内的原始候选位置
};

type StrongRelations = {
  subset_parents_by_entry_id: Record<string, string[]>; // 只记录真实部分包含关系
  groups: StrongGroup[]; // 强关系形成的互斥连通分量
};

type RootOccurrence = {
  coverage: number; // 该词根在强组内候选中的最大覆盖率
  first_entry_index: number; // 强组内最早候选位置，用于稳定排序
};

type RootIndexEntry = {
  root_length: number; // 以 grapheme 计的词根长度
  occurrences: Map<number, RootOccurrence>; // strong group index 到覆盖证据
};

type LatentAnchor = {
  root: string; // 能直接覆盖全部待合并强组的单一连续词根
  root_length: number; // 优先选择更长、更具体的词根
  strong_group_indexes: number[]; // 由该词根直接覆盖的强组
  min_coverage: number; // 所有强组中的最低覆盖率
  first_entry_index: number; // 用于确定性打破同分关系
};

/**
 * 先以真实字面量包含关系建立不可拆分的强组，再用单一公共连续词根合并有限弱组。
 * 弱组只用于共同审校，不表示语义等价。
 */
export function analyze_quality_rule_relations(
  candidates: QualityRuleRelationCandidate[],
): QualityRuleRelations {
  const literal_candidates = candidates.filter((candidate) => candidate.pattern_kind === "literal");
  const strong_relations = analyze_strong_relations(literal_candidates);
  const literal_groups = merge_latent_groups(literal_candidates, strong_relations.groups);
  const regex_groups = group_regex_candidates(candidates);
  const input_index_by_entry_id = new Map(
    candidates.map((candidate, index) => [candidate.entry_id, index] as const),
  );
  return {
    subset_parents_by_entry_id: strong_relations.subset_parents_by_entry_id,
    groups: [...literal_groups, ...regex_groups].toSorted((left, right) => {
      const left_index = input_index_by_entry_id.get(left[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
      const right_index = input_index_by_entry_id.get(right[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
      return left_index - right_index;
    }),
  };
}

/** 正则语义不可由源码包含关系推导，只合并执行配置完全相同的规则。 */
function group_regex_candidates(candidates: QualityRuleRelationCandidate[]): string[][] {
  const groups_by_signature = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (candidate.pattern_kind !== "regex") continue;
    const signature = JSON.stringify([candidate.src, candidate.case_sensitive]);
    const group = groups_by_signature.get(signature) ?? [];
    group.push(candidate.entry_id);
    groups_by_signature.set(signature, group);
  }
  return [...groups_by_signature.values()];
}

/** 真实字面量包含或匹配等价关系使用并查集形成不可拆分的强组。 */
function analyze_strong_relations(candidates: QualityRuleRelationCandidate[]): StrongRelations {
  const matcher = compile_literal_patterns(
    candidates.map((candidate) => ({
      key: candidate.entry_id,
      text: candidate.src,
      case_sensitive: candidate.case_sensitive,
    })),
  );
  // entry_id 来自持久化事实，null prototype 避免合法 ID 与对象原型成员冲突。
  const subset_parents_by_entry_id = Object.create(null) as Record<string, string[]>;
  const index_by_entry_id = new Map(
    candidates.map((candidate, index) => [candidate.entry_id, index] as const),
  );
  const parents = candidates.map((_candidate, index) => index);
  const sizes = candidates.map(() => 1);
  /** 查找并压缩并查集路径。 */
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root] ?? root;
    while (parents[index] !== index) {
      const next = parents[index] ?? root;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  /** 按集合大小合并强关系，避免树退化。 */
  const union = (left: number, right: number): void => {
    let left_root = find(left);
    let right_root = find(right);
    if (left_root === right_root) return;
    if ((sizes[left_root] ?? 0) < (sizes[right_root] ?? 0)) {
      [left_root, right_root] = [right_root, left_root];
    }
    parents[right_root] = left_root;
    sizes[left_root] = (sizes[left_root] ?? 0) + (sizes[right_root] ?? 0);
  };

  for (const parent_candidate of candidates) {
    const parent_index = index_by_entry_id.get(parent_candidate.entry_id);
    if (parent_index === undefined) continue;
    const partial_by_child_id = new Map<string, boolean>();
    matcher.scan(parent_candidate.src, (child_id, range) => {
      if (child_id === parent_candidate.entry_id) return;
      partial_by_child_id.set(
        child_id,
        (partial_by_child_id.get(child_id) ?? false) ||
          range.start > 0 ||
          range.end < parent_candidate.src.length,
      );
    });
    for (const [child_id, is_partial] of partial_by_child_id) {
      const child_index = index_by_entry_id.get(child_id);
      if (child_index === undefined) continue;
      union(parent_index, child_index);
      if (!is_partial) continue;
      const parent_labels = subset_parents_by_entry_id[child_id] ?? [];
      if (!parent_labels.includes(parent_candidate.src)) parent_labels.push(parent_candidate.src);
      subset_parents_by_entry_id[child_id] = parent_labels;
    }
  }

  const strong_groups_by_root = new Map<number, StrongGroup>();
  candidates.forEach((_candidate, entry_index) => {
    const root = find(entry_index);
    const group = strong_groups_by_root.get(root) ?? { entry_indexes: [] };
    group.entry_indexes.push(entry_index);
    strong_groups_by_root.set(root, group);
  });
  return {
    subset_parents_by_entry_id,
    groups: [...strong_groups_by_root.values()],
  };
}

/**
 * 用倒排词根索引避免术语两两比较；同一弱组必须由一个可解释词根直接覆盖。
 * ponytail: 候选数量为 O(ΣL²)，适合短术语；只有基准证明不足时才换后缀索引。
 */
function merge_latent_groups(
  candidates: QualityRuleRelationCandidate[],
  strong_groups: StrongGroup[],
): string[][] {
  const strong_group_by_entry_index = new Map<number, number>();
  strong_groups.forEach((group, strong_group_index) => {
    for (const entry_index of group.entry_indexes) {
      strong_group_by_entry_index.set(entry_index, strong_group_index);
    }
  });
  const root_index = new Map<string, RootIndexEntry>();

  candidates.forEach((candidate, entry_index) => {
    const strong_group_index = strong_group_by_entry_index.get(entry_index);
    if (strong_group_index === undefined) return;
    const graphemes = segment_graphemes(normalize_literal_text(candidate.src, false));
    if (graphemes.length < MIN_LATENT_ROOT_GRAPHEMES) return;
    const roots = new Set<string>();
    for (let start = 0; start <= graphemes.length - MIN_LATENT_ROOT_GRAPHEMES; start += 1) {
      let root = "";
      for (let end = start; end < graphemes.length; end += 1) {
        root += graphemes[end] ?? "";
        const root_length = end - start + 1;
        if (root_length < MIN_LATENT_ROOT_GRAPHEMES || roots.has(root)) continue;
        roots.add(root);
        const indexed = root_index.get(root) ?? {
          root_length,
          occurrences: new Map<number, RootOccurrence>(),
        };
        const occurrences = indexed.occurrences;
        const previous = occurrences.get(strong_group_index);
        occurrences.set(strong_group_index, {
          coverage: Math.max(previous?.coverage ?? 0, root_length / graphemes.length),
          first_entry_index: Math.min(previous?.first_entry_index ?? entry_index, entry_index),
        });
        root_index.set(root, indexed);
      }
    }
  });

  const longest_anchor_by_groups = new Map<string, LatentAnchor>();
  for (const [root, indexed] of root_index) {
    const eligible_occurrences = [...indexed.occurrences.entries()].filter(
      ([, occurrence]) => occurrence.coverage >= MIN_LATENT_ROOT_COVERAGE,
    );
    if (eligible_occurrences.length < 2) continue;
    const strong_group_indexes = eligible_occurrences
      .map(([index]) => index)
      .toSorted((left, right) => left - right);
    const total_entries = strong_group_indexes.reduce(
      (total, index) => total + (strong_groups[index]?.entry_indexes.length ?? 0),
      0,
    );
    const values = eligible_occurrences.map(([, occurrence]) => occurrence);
    const min_coverage = Math.min(...values.map((occurrence) => occurrence.coverage));
    if (total_entries > MAX_LATENT_GROUP_ENTRIES) continue;
    const anchor: LatentAnchor = {
      root,
      root_length: indexed.root_length,
      strong_group_indexes,
      min_coverage,
      first_entry_index: Math.min(...values.map((occurrence) => occurrence.first_entry_index)),
    };
    const key = strong_group_indexes.join(",");
    const previous = longest_anchor_by_groups.get(key);
    if (previous === undefined || compare_same_group_anchors(anchor, previous) < 0) {
      longest_anchor_by_groups.set(key, anchor);
    }
  }

  const assigned = new Set<number>();
  const merged: Array<{ first_entry_index: number; entry_ids: string[] }> = [];
  const anchors = [...longest_anchor_by_groups.values()].toSorted(compare_latent_anchors);
  for (const anchor of anchors) {
    const available = anchor.strong_group_indexes.filter((index) => !assigned.has(index));
    if (available.length < 2) continue;
    const entry_indexes = available
      .flatMap((index) => strong_groups[index]?.entry_indexes ?? [])
      .toSorted((left, right) => left - right);
    if (entry_indexes.length > MAX_LATENT_GROUP_ENTRIES) continue;
    available.forEach((index) => assigned.add(index));
    merged.push({
      first_entry_index: entry_indexes[0] ?? Number.MAX_SAFE_INTEGER,
      entry_ids: entry_indexes.flatMap((index) => {
        const candidate = candidates[index];
        return candidate === undefined ? [] : [candidate.entry_id];
      }),
    });
  }
  strong_groups.forEach((group, index) => {
    if (assigned.has(index)) return;
    merged.push({
      first_entry_index: group.entry_indexes[0] ?? Number.MAX_SAFE_INTEGER,
      entry_ids: group.entry_indexes.flatMap((entry_index) => {
        const candidate = candidates[entry_index];
        return candidate === undefined ? [] : [candidate.entry_id];
      }),
    });
  });
  return merged
    .toSorted((left, right) => left.first_entry_index - right.first_entry_index)
    .map((group) => group.entry_ids);
}

/** 把规范化文本拆成用户可见字符，供连续词根枚举使用。 */
function segment_graphemes(text: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(text)].map((segment) => segment.segment);
}

/** 同一组集合只保留最长词根，再以输入顺序和文本稳定打破平局。 */
function compare_same_group_anchors(left: LatentAnchor, right: LatentAnchor): number {
  return (
    right.root_length - left.root_length ||
    left.first_entry_index - right.first_entry_index ||
    compare_text(left.root, right.root)
  );
}

/** 全局先分配更具体、更强且覆盖更多组的词根，阻止弱关系传递扩张。 */
function compare_latent_anchors(left: LatentAnchor, right: LatentAnchor): number {
  return (
    right.root_length - left.root_length ||
    right.min_coverage - left.min_coverage ||
    right.strong_group_indexes.length - left.strong_group_indexes.length ||
    left.first_entry_index - right.first_entry_index ||
    compare_text(left.root, right.root)
  );
}

/** 不依赖运行时 locale 的确定性文本顺序。 */
function compare_text(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
