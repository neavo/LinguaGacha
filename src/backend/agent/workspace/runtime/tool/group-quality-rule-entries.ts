import { Type, type Static } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../../../../domain/json";
import { define_agent_workspace_data_tool, type AgentWorkspaceDataToolContext } from "./data-tool";

const pagination = {
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
};

const relation_schema = Type.Union([
  Type.Object(
    {
      reason: Type.Union([Type.Literal("equivalent"), Type.Literal("contains")]),
      entry_ids: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      reason: Type.Literal("shared_root"),
      root: Type.String(),
      entry_ids: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

const cross_group_relation_schema = Type.Union([
  Type.Object(
    {
      reason: Type.Union([Type.Literal("equivalent"), Type.Literal("contains")]),
      entry_ids: Type.Array(Type.String()),
      group_ids: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      reason: Type.Literal("shared_root"),
      root: Type.String(),
      entry_ids: Type.Array(Type.String()),
      group_ids: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

const parameters = Type.Object(
  {
    kind: Type.Union([Type.Literal("glossary"), Type.Literal("text_preserve")]),
    entries: Type.Optional(
      Type.Array(
        Type.Object(
          {
            entry_id: Type.Optional(Type.String()),
            id: Type.Optional(Type.String()),
            src: Type.String(),
            case_sensitive: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: true },
        ),
      ),
    ),
    target_entry_ids: Type.Optional(Type.Array(Type.String())),
    ...pagination,
  },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    total_entry_count: Type.Integer({ minimum: 0 }),
    total_target_entry_count: Type.Integer({ minimum: 0 }),
    total_component_count: Type.Integer({ minimum: 0 }),
    total_group_count: Type.Integer({ minimum: 0 }),
    groups: Type.Array(
      Type.Object(
        {
          group_id: Type.String(),
          component_ids: Type.Array(Type.String()),
          entry_ids: Type.Array(Type.String()),
          target_entry_ids: Type.Array(Type.String()),
          relations: Type.Array(relation_schema),
        },
        { additionalProperties: false },
      ),
    ),
    cross_group_relations: Type.Array(cross_group_relation_schema),
    missing_target_entry_ids: Type.Array(Type.String()),
    next_offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

type GroupableQualityKind = "glossary" | "text_preserve";
type RuleEntry = { entry_id: string; src: string; case_sensitive: boolean };
type StrongReason = "equivalent" | "contains";
type StrongRelation = { reason: StrongReason; entry_indexes: [number, number] };
type Component = { entry_indexes: number[] };
type WeakAnchor = {
  root: string;
  root_length: number;
  component_indexes: number[];
  representative_entry_indexes: number[];
  min_coverage: number;
  first_entry_index: number;
};
type ProvisionalGroup = { component_indexes: number[]; entry_indexes: number[] };
type IdentifiedGroup = ProvisionalGroup & { group_id: string };
type PublicRelation = Static<typeof relation_schema>;
type CrossGroupRelation = Static<typeof cross_group_relation_schema>;
type PublicGroup = Static<(typeof result)["properties"]["groups"]>[number];

const MAX_GROUP_ENTRIES = 16; // 统一限制强组拆分和弱组聚合后的模型审查规模
const MIN_SHARED_ROOT_GRAPHEMES = 2; // 单字符重合噪声过大，不形成弱关系
const MIN_SHARED_ROOT_COVERAGE = 0.5; // 公共片段至少覆盖词形一半，避免普通短片段主导分组
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" }); // 不拆开组合字符或 emoji

/**
 * 按需为现有规则或调用方提供的候选生成结构审查组。
 * 关系只负责共同审查，不证明语义相同、规则必要或可以合并。
 */
export const groupQualityRuleEntries = define_agent_workspace_data_tool({
  useWhen: "为 glossary 或 text_preserve 对象生成规范结构审查组",
  description: "为 glossary 或 text_preserve 对象生成规范结构审查组，不替代语义判断。",
  parameters,
  result,
  async execute(context, args) {
    const kind = args.kind;
    const entries = await readEntries(context, args.entries, kind);
    const targetEntryIds = readTargetEntryIds(args.target_entry_ids, entries);
    const offset = args.offset ?? 0;
    const limit = args.limit ?? context.contract.limits.query_page_default;
    if (limit > context.contract.limits.query_page_max) {
      throw new Error(
        `limit must be an integer from 1 to ${context.contract.limits.query_page_max.toString()}`,
      );
    }

    const analysis = analyzeRelations(entries, kind);
    const entryIdSet = new Set(entries.map((entry) => entry.entry_id));
    const requestedTargetIds = targetEntryIds ?? entries.map((entry) => entry.entry_id);
    const missingTargetEntryIds = requestedTargetIds.filter((entryId) => !entryIdSet.has(entryId));
    const existingTargetIds = requestedTargetIds.filter((entryId) => entryIdSet.has(entryId));
    const targetEntryIdSet = new Set(existingTargetIds);
    const groups = analysis.groups
      .map((group) => ({
        ...group,
        target_entry_ids: group.entry_ids.filter((entryId) => targetEntryIdSet.has(entryId)),
      }))
      .filter((group) => group.target_entry_ids.length > 0);
    const pageGroups = groups.slice(offset, offset + limit);
    const pageGroupIdSet = new Set(pageGroups.map((group) => group.group_id));
    const nextOffset = offset + pageGroups.length;

    return {
      total_entry_count: entries.length,
      total_target_entry_count: existingTargetIds.length,
      total_component_count: analysis.component_count,
      total_group_count: groups.length,
      groups: pageGroups,
      cross_group_relations: analysis.cross_group_relations.filter((relation) =>
        relation.group_ids.some((groupId) => pageGroupIdSet.has(groupId)),
      ),
      missing_target_entry_ids: missingTargetEntryIds,
      ...(nextOffset < groups.length ? { next_offset: nextOffset } : {}),
    };
  },
});

/** 读取现有规则或候选投影，并收口两种来源共享的最小字段校验。 */
async function readEntries(
  context: AgentWorkspaceDataToolContext,
  suppliedEntries: unknown,
  kind: GroupableQualityKind,
): Promise<RuleEntry[]> {
  const values: unknown[] = [];
  if (suppliedEntries !== undefined) {
    if (!Array.isArray(suppliedEntries)) throw new Error("entries must be an array");
    values.push(...suppliedEntries);
  } else {
    for await (const entry of context.data.quality(kind)) values.push(entry);
  }

  const entryIds = new Set<string>();
  return values.map((value, index) => {
    const record = readRecord(value, `entries[${index.toString()}]`);
    const entryId = readNonEmptyString(
      record.entry_id ?? record.id,
      `entries[${index.toString()}].entry_id`,
    );
    if (entryIds.has(entryId)) throw new Error(`Duplicate entry_id: ${entryId}`);
    entryIds.add(entryId);
    const src = readNonEmptyString(record.src, `entries[${index.toString()}].src`);
    let caseSensitive = false;
    if (kind === "glossary") {
      if (typeof record.case_sensitive !== "boolean") {
        throw new Error(`entries[${index.toString()}].case_sensitive must be a boolean`);
      }
      caseSensitive = record.case_sensitive;
    }
    return { entry_id: entryId, src, case_sensitive: caseSensitive };
  });
}

/** 目标按输入条目顺序稳定排列；缺失 ID 留到结果中报告。 */
function readTargetEntryIds(value: unknown, entries: RuleEntry[]): string[] | null {
  if (value === undefined) return null;
  const target_entry_ids = value as string[];
  if (
    new Set(target_entry_ids).size !== target_entry_ids.length ||
    target_entry_ids.some((entryId) => entryId.trim() === "")
  ) {
    throw new Error("target_entry_ids must be an array of unique non-empty strings");
  }
  const inputOrder = new Map(entries.map((entry, index) => [entry.entry_id, index]));
  return [...target_entry_ids].toSorted((left, right) => {
    const leftIndex = inputOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = inputOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || compareText(left, right);
  });
}

/** 从强 component、非传递弱锚点和分组结果构造完整结构分析。 */
function analyzeRelations(
  entries: RuleEntry[],
  kind: GroupableQualityKind,
): {
  component_count: number;
  groups: PublicGroup[];
  cross_group_relations: CrossGroupRelation[];
} {
  const strong = analyzeStrongRelations(entries, kind);
  const components = buildComponents(entries, strong.parents);
  const componentIndexByEntryIndex = new Map<number, number>();
  components.forEach((component, componentIndex) => {
    for (const entryIndex of component.entry_indexes) {
      componentIndexByEntryIndex.set(entryIndex, componentIndex);
    }
  });
  const weakAnchors =
    kind === "glossary" ? buildWeakAnchors(entries, components, componentIndexByEntryIndex) : [];
  const provisionalGroups = buildGroups(entries, components, strong.edges, weakAnchors);
  const groups = provisionalGroups
    .toSorted((left, right) => left.entry_indexes[0] - right.entry_indexes[0])
    .map((group, index) => ({
      ...group,
      group_id: stableId("group", index),
    }));
  const groupByEntryIndex = new Map<number, IdentifiedGroup>();
  groups.forEach((group) => {
    for (const entryIndex of group.entry_indexes) groupByEntryIndex.set(entryIndex, group);
  });
  const internalRelationsByGroupId = new Map<string, PublicRelation[]>(
    groups.map((group) => [group.group_id, []]),
  );
  const crossGroupRelations: CrossGroupRelation[] = [];

  for (const edge of strong.edges) {
    distributeRelation(
      relationFromStrongEdge(edge, entries),
      edge.entry_indexes,
      groupByEntryIndex,
      internalRelationsByGroupId,
      crossGroupRelations,
    );
  }
  for (const anchor of weakAnchors) {
    const relation: PublicRelation = {
      reason: "shared_root",
      root: anchor.root,
      entry_ids: anchor.representative_entry_indexes.map(
        (entryIndex) => entries[entryIndex].entry_id,
      ),
    };
    distributeRelation(
      relation,
      anchor.representative_entry_indexes,
      groupByEntryIndex,
      internalRelationsByGroupId,
      crossGroupRelations,
    );
  }

  return {
    component_count: components.length,
    groups: groups.map((group) => ({
      group_id: group.group_id,
      component_ids: group.component_indexes.map((componentIndex) =>
        stableId("component", componentIndex),
      ),
      entry_ids: group.entry_indexes.map((entryIndex) => entries[entryIndex].entry_id),
      target_entry_ids: [],
      relations: dedupeRelations(internalRelationsByGroupId.get(group.group_id) ?? []),
    })),
    cross_group_relations: dedupeRelations(crossGroupRelations),
  };
}

/** 强关系只保留连接 component 所需的稳定边，避免等价簇输出二次方关系。 */
function analyzeStrongRelations(
  entries: RuleEntry[],
  kind: GroupableQualityKind,
): { parents: number[]; edges: StrongRelation[] } {
  const unionFind = createUnionFind(entries.length);
  const candidates =
    kind === "glossary" ? findLiteralRelations(entries) : findRegexRelations(entries);
  const edges: StrongRelation[] = [];
  for (const relation of candidates) {
    if (unionFind.union(relation.entry_indexes[0], relation.entry_indexes[1])) {
      edges.push(relation);
    }
  }
  return { parents: unionFind.parents, edges };
}

/** 通过规范化字面索引发现 glossary 的等价与真实包含关系。 */
function findLiteralRelations(entries: RuleEntry[]): StrongRelation[] {
  const sensitiveByText = new Map<string, number[]>();
  const insensitiveByText = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const target = entry.case_sensitive ? sensitiveByText : insensitiveByText;
    const text = normalizeLiteral(entry.src, entry.case_sensitive);
    const indexes = target.get(text) ?? [];
    indexes.push(index);
    target.set(text, indexes);
  });

  const relationsByPair = new Map<string, StrongRelation>();
  entries.forEach((parent, parentIndex) => {
    const buckets: Array<readonly [boolean, Map<string, number[]>]> = [
      [true, sensitiveByText],
      [false, insensitiveByText],
    ];
    for (const [caseSensitive, candidatesByText] of buckets) {
      const graphemes = segmentGraphemes(normalizeLiteral(parent.src, caseSensitive));
      for (let start = 0; start < graphemes.length; start += 1) {
        let text = "";
        for (let end = start; end < graphemes.length; end += 1) {
          text += graphemes[end];
          const childIndexes = candidatesByText.get(text) ?? [];
          for (const childIndex of childIndexes) {
            if (childIndex === parentIndex) continue;
            const partial = start > 0 || end + 1 < graphemes.length;
            const relation: StrongRelation = partial
              ? {
                  reason: "contains",
                  entry_indexes: [parentIndex, childIndex],
                }
              : {
                  reason: "equivalent",
                  entry_indexes: [
                    Math.min(parentIndex, childIndex),
                    Math.max(parentIndex, childIndex),
                  ],
                };
            const key = pairKey(parentIndex, childIndex);
            const previous = relationsByPair.get(key);
            if (
              previous === undefined ||
              (previous.reason === "contains" && relation.reason === "equivalent")
            ) {
              relationsByPair.set(key, relation);
            }
          }
        }
      }
    }
  });
  return [...relationsByPair.values()].toSorted(compareStrongRelations);
}

/** 正则源码不做包含推断；text_preserve 只有完全相同才构成强关系。 */
function findRegexRelations(entries: RuleEntry[]): StrongRelation[] {
  const indexesBySignature = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const signature = JSON.stringify([entry.src, entry.case_sensitive]);
    const indexes = indexesBySignature.get(signature) ?? [];
    indexes.push(index);
    indexesBySignature.set(signature, indexes);
  });
  return [...indexesBySignature.values()].flatMap((indexes) => {
    const first = indexes[0];
    return indexes.slice(1).map<StrongRelation>((index) => ({
      reason: "equivalent",
      entry_indexes: [first ?? index, index],
    }));
  });
}

/** 把 union-find 根投影为遵循原输入顺序的强连通 component。 */
function buildComponents(entries: RuleEntry[], parents: number[]): Component[] {
  const find = createFind(parents);
  const byRoot = new Map<number, number[]>();
  entries.forEach((_entry, entryIndex) => {
    const root = find(entryIndex);
    const indexes = byRoot.get(root) ?? [];
    indexes.push(entryIndex);
    byRoot.set(root, indexes);
  });
  return [...byRoot.values()]
    .map((entryIndexes) => ({
      entry_indexes: entryIndexes.toSorted((left, right) => left - right),
    }))
    .toSorted((left, right) => left.entry_indexes[0] - right.entry_indexes[0]);
}

/** 为尚可共同审查的小 component 选择最具体的受限公共词根锚点。 */
function buildWeakAnchors(
  entries: RuleEntry[],
  components: Component[],
  componentIndexByEntryIndex: Map<number, number>,
): WeakAnchor[] {
  const rootIndex = new Map<
    string,
    {
      root_length: number;
      occurrences: Map<number, { coverage: number; entry_index: number }>;
    }
  >();
  entries.forEach((entry, entryIndex) => {
    const componentIndex = componentIndexByEntryIndex.get(entryIndex);
    if (
      componentIndex === undefined ||
      components[componentIndex].entry_indexes.length > MAX_GROUP_ENTRIES
    ) {
      return;
    }
    const graphemes = segmentGraphemes(normalizeLiteral(entry.src, false));
    if (graphemes.length < MIN_SHARED_ROOT_GRAPHEMES) return;
    const roots = new Set();
    for (let start = 0; start <= graphemes.length - MIN_SHARED_ROOT_GRAPHEMES; start += 1) {
      let root = "";
      for (let end = start; end < graphemes.length; end += 1) {
        root += graphemes[end];
        const rootLength = end - start + 1;
        const coverage = rootLength / graphemes.length;
        if (
          rootLength < MIN_SHARED_ROOT_GRAPHEMES ||
          coverage < MIN_SHARED_ROOT_COVERAGE ||
          roots.has(root)
        ) {
          continue;
        }
        roots.add(root);
        const indexed = rootIndex.get(root) ?? {
          root_length: rootLength,
          occurrences: new Map(),
        };
        const previous = indexed.occurrences.get(componentIndex);
        if (
          previous === undefined ||
          coverage > previous.coverage ||
          (coverage === previous.coverage && entryIndex < previous.entry_index)
        ) {
          indexed.occurrences.set(componentIndex, { coverage, entry_index: entryIndex });
        }
        rootIndex.set(root, indexed);
      }
    }
  });

  const bestByComponents = new Map<string, WeakAnchor>();
  for (const [root, indexed] of rootIndex) {
    const occurrences = [...indexed.occurrences.entries()].toSorted(
      ([left], [right]) => left - right,
    );
    if (occurrences.length < 2) continue;
    const componentIndexes = occurrences.map(([componentIndex]) => componentIndex);
    const totalEntries = componentIndexes.reduce(
      (total, componentIndex) => total + components[componentIndex].entry_indexes.length,
      0,
    );
    if (totalEntries > MAX_GROUP_ENTRIES) continue;
    const values = occurrences.map(([, occurrence]) => occurrence);
    const anchor = {
      root,
      root_length: indexed.root_length,
      component_indexes: componentIndexes,
      representative_entry_indexes: values.map((occurrence) => occurrence.entry_index),
      min_coverage: Math.min(...values.map((occurrence) => occurrence.coverage)),
      first_entry_index: Math.min(...values.map((occurrence) => occurrence.entry_index)),
    };
    const key = componentIndexes.join(",");
    const previous = bestByComponents.get(key);
    if (previous === undefined || compareSameComponentAnchors(anchor, previous) < 0) {
      bestByComponents.set(key, anchor);
    }
  }
  return [...bestByComponents.values()].toSorted(compareWeakAnchors);
}

/** 弱锚点按优先级贪心组成互斥组，剩余 component 独立保留或拆分。 */
function buildGroups(
  entries: RuleEntry[],
  components: Component[],
  strongEdges: StrongRelation[],
  weakAnchors: WeakAnchor[],
): ProvisionalGroup[] {
  const assignedComponents = new Set<number>();
  const groups: ProvisionalGroup[] = [];
  for (const anchor of weakAnchors) {
    const available = anchor.component_indexes.filter(
      (componentIndex) => !assignedComponents.has(componentIndex),
    );
    if (available.length < 2) continue;
    const entryIndexes = available
      .flatMap((componentIndex) => components[componentIndex].entry_indexes)
      .toSorted((left, right) => left - right);
    if (entryIndexes.length > MAX_GROUP_ENTRIES) continue;
    available.forEach((componentIndex) => assignedComponents.add(componentIndex));
    groups.push({ component_indexes: available, entry_indexes: entryIndexes });
  }

  components.forEach((component, componentIndex) => {
    if (assignedComponents.has(componentIndex)) return;
    if (component.entry_indexes.length <= MAX_GROUP_ENTRIES) {
      groups.push({ component_indexes: [componentIndex], entry_indexes: component.entry_indexes });
      return;
    }
    for (const entryIndexes of splitLargeComponent(component, strongEdges, entries.length)) {
      groups.push({ component_indexes: [componentIndex], entry_indexes: entryIndexes });
    }
  });
  return groups;
}

/** 从高连接锚点按强边广度切分超大 component，同时保持每组上限。 */
function splitLargeComponent(
  component: Component,
  strongEdges: StrongRelation[],
  entryCount: number,
): number[][] {
  const componentEntrySet = new Set(component.entry_indexes);
  const adjacency: Array<Array<{ index: number; reason: StrongReason }>> = Array.from(
    { length: entryCount },
    () => [],
  );
  for (const edge of strongEdges) {
    const [left, right] = edge.entry_indexes;
    if (!componentEntrySet.has(left) || !componentEntrySet.has(right)) continue;
    adjacency[left].push({ index: right, reason: edge.reason });
    adjacency[right].push({ index: left, reason: edge.reason });
  }
  for (const neighbors of adjacency) {
    neighbors.sort(
      (left, right) =>
        relationRank(left.reason) - relationRank(right.reason) || left.index - right.index,
    );
  }

  const remaining = new Set(component.entry_indexes);
  const groups: number[][] = [];
  while (remaining.size > 0) {
    const anchor = [...remaining].toSorted((left, right) => {
      const leftDegree = adjacency[left].filter((neighbor) => remaining.has(neighbor.index)).length;
      const rightDegree = adjacency[right].filter((neighbor) =>
        remaining.has(neighbor.index),
      ).length;
      return rightDegree - leftDegree || left - right;
    })[0];
    if (anchor === undefined) break;
    const queue: number[] = [anchor];
    const queued = new Set(queue);
    const group: number[] = [];
    while (queue.length > 0 && group.length < MAX_GROUP_ENTRIES) {
      const current = queue.shift();
      if (current === undefined) break;
      if (!remaining.has(current)) continue;
      remaining.delete(current);
      group.push(current);
      for (const neighbor of adjacency[current]) {
        if (remaining.has(neighbor.index) && !queued.has(neighbor.index)) {
          queue.push(neighbor.index);
          queued.add(neighbor.index);
        }
      }
    }
    groups.push(group.toSorted((left, right) => left - right));
  }
  return groups;
}

/** 关系成员落在一组时内嵌，跨组时回传直接关联供后续核验。 */
function distributeRelation(
  relation: PublicRelation,
  entryIndexes: number[],
  groupByEntryIndex: Map<number, IdentifiedGroup>,
  internalRelationsByGroupId: Map<string, PublicRelation[]>,
  crossGroupRelations: CrossGroupRelation[],
): void {
  const groupIds = [
    ...new Set(entryIndexes.map((entryIndex) => groupByEntryIndex.get(entryIndex)?.group_id)),
  ]
    .filter((groupId) => groupId !== undefined)
    .toSorted(compareText);
  if (groupIds.length === 1) {
    const group_id = groupIds[0];
    if (group_id !== undefined) internalRelationsByGroupId.get(group_id)?.push(relation);
    return;
  }
  if (groupIds.length > 1) crossGroupRelations.push({ ...relation, group_ids: groupIds });
}

/** 把内部索引边转换成数据工具的稳定业务 ID 结果。 */
function relationFromStrongEdge(edge: StrongRelation, entries: RuleEntry[]): PublicRelation {
  return {
    reason: edge.reason,
    entry_ids: edge.entry_indexes.map((entryIndex) => entries[entryIndex]?.entry_id ?? ""),
  };
}

/** 多条发现路径可能产生同一关系，按稳定序列化键去重且保留首次顺序。 */
function dedupeRelations<Relation extends PublicRelation | CrossGroupRelation>(
  relations: Relation[],
): Relation[] {
  const byKey = new Map<string, Relation>();
  for (const relation of relations) {
    const key = JSON.stringify(relation);
    if (!byKey.has(key)) byKey.set(key, relation);
  }
  return [...byKey.values()];
}

/** 建立按规模合并的 union-find，返回的 parents 供 component 投影复用。 */
function createUnionFind(size: number): {
  parents: number[];
  union: (left: number, right: number) => boolean;
} {
  const parents = Array.from({ length: size }, (_value, index) => index);
  const sizes = Array.from({ length: size }, () => 1);
  const find = createFind(parents);
  return {
    parents,
    union(left, right) {
      let leftRoot = find(left);
      let rightRoot = find(right);
      if (leftRoot === rightRoot) return false;
      if (sizes[leftRoot] < sizes[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
      parents[rightRoot] = leftRoot;
      sizes[leftRoot] += sizes[rightRoot];
      return true;
    },
  };
}

/** 创建带路径压缩的根查找函数，避免大关系链反复遍历。 */
function createFind(parents: number[]): (start: number) => number {
  return (start: number) => {
    let index = start;
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
}

/** 强边先按关系强度、再按最早输入位置稳定排序。 */
function compareStrongRelations(left: StrongRelation, right: StrongRelation): number {
  const leftMin = Math.min(...left.entry_indexes);
  const rightMin = Math.min(...right.entry_indexes);
  return (
    relationRank(left.reason) - relationRank(right.reason) ||
    leftMin - rightMin ||
    Math.max(...left.entry_indexes) - Math.max(...right.entry_indexes)
  );
}

/** 同一 component 集合只保留最长、覆盖最高且最早出现的弱锚点。 */
function compareSameComponentAnchors(left: WeakAnchor, right: WeakAnchor): number {
  return (
    right.root_length - left.root_length ||
    right.min_coverage - left.min_coverage ||
    left.first_entry_index - right.first_entry_index ||
    compareText(left.root, right.root)
  );
}

/** 弱组优先采用更具体、覆盖更高且连接更多 component 的锚点。 */
function compareWeakAnchors(left: WeakAnchor, right: WeakAnchor): number {
  return (
    right.root_length - left.root_length ||
    right.min_coverage - left.min_coverage ||
    right.component_indexes.length - left.component_indexes.length ||
    left.first_entry_index - right.first_entry_index ||
    compareText(left.root, right.root)
  );
}

/** 等价边优先于包含边，弱关系只在排序兜底中位于末尾。 */
function relationRank(reason: StrongReason | "shared_root"): number {
  return reason === "equivalent" ? 0 : reason === "contains" ? 1 : 2;
}

/** 统一 NFKC 和大小写折叠，并补齐 JS 小写在 ß 与希腊尾形上的差异。 */
function normalizeLiteral(text: string, caseSensitive: boolean): string {
  const normalized = text.normalize("NFKC");
  return caseSensitive
    ? normalized
    : normalized.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLowerCase().replaceAll("ς", "σ");
}

/** 将字符串分成用户可见字符，所有长度和片段计算共用此入口。 */
function segmentGraphemes(text: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(text)].map((segment) => segment.segment);
}

/** 无向条目对使用小索引在前的稳定键。 */
function pairKey(left: number, right: number): string {
  return left < right
    ? `${left.toString()}:${right.toString()}`
    : `${right.toString()}:${left.toString()}`;
}

/** 以输入稳定顺序生成便于跨分页引用的定宽 ID。 */
function stableId(prefix: string, index: number): string {
  return `${prefix}-${(index + 1).toString().padStart(4, "0")}`;
}

/** 避免 locale 环境影响数据工具的稳定顺序。 */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 统一拒绝 null、数组和非对象输入。 */
function readRecord(value: unknown, name: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as JsonRecord;
}

/** 统一校验数据工具输入的身份和源码字段，但保留原始字符串内容。 */
function readNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}
