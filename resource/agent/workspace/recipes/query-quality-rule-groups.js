const QUALITY_RULE_KINDS = Object.freeze(["glossary", "text_preserve"]); // 与 workspace contract 的质量规则种类一致
const MAX_GROUP_ENTRIES = 16; // 统一限制强组拆分和弱组聚合后的模型审查规模
const MIN_SHARED_ROOT_GRAPHEMES = 2; // 单字符重合噪声过大，不形成弱关系
const MIN_SHARED_ROOT_COVERAGE = 0.5; // 公共片段至少覆盖词形一半，避免普通短片段主导分组
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" }); // 不拆开组合字符或 emoji

/**
 * 按需为现有规则或调用方提供的候选生成结构审查组。
 * 关系只负责共同审查，不证明语义相同、规则必要或可以合并。
 */
async function runRecipe(workspace, args) {
  const kind = readKind(args.kind);
  const entries = await readEntries(workspace, args.entries, kind);
  const targetEntryIds = readTargetEntryIds(args.target_entry_ids, entries);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? workspace.contract.limits.recipe_page_default;
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset 必须是非负整数");
  if (!Number.isInteger(limit) || limit < 1 || limit > workspace.contract.limits.recipe_page_max) {
    throw new Error(`limit 必须是 1..${workspace.contract.limits.recipe_page_max} 的整数`);
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
}

/** 读取现有规则或候选投影，并收口两种来源共享的最小字段校验。 */
async function readEntries(workspace, suppliedEntries, kind) {
  const values = [];
  if (suppliedEntries !== undefined) {
    if (!Array.isArray(suppliedEntries)) throw new Error("entries 必须是数组");
    values.push(...suppliedEntries);
  } else {
    const dataset = workspace.contract.datasets[kind];
    if (dataset === undefined) throw new Error(`未知 quality kind: ${kind}`);
    for await (const entry of workspace.iterateJsonl(dataset.path)) values.push(entry);
  }

  const entryIds = new Set();
  return values.map((value, index) => {
    const record = readRecord(value, `entries[${index.toString()}]`);
    const entryId = readNonEmptyString(
      record.entry_id ?? record.id,
      `entries[${index.toString()}].entry_id`,
    );
    if (entryIds.has(entryId)) throw new Error(`entry_id 重复: ${entryId}`);
    entryIds.add(entryId);
    const src = readNonEmptyString(record.src, `entries[${index.toString()}].src`);
    let caseSensitive = false;
    if (kind === "glossary") {
      if (typeof record.case_sensitive !== "boolean") {
        throw new Error(`entries[${index.toString()}].case_sensitive 必须是 boolean`);
      }
      caseSensitive = record.case_sensitive;
    }
    return { entry_id: entryId, src, case_sensitive: caseSensitive };
  });
}

/** 目标按输入条目顺序稳定排列；缺失 ID 留到结果中报告。 */
function readTargetEntryIds(value, entries) {
  if (value === undefined) return null;
  if (
    !Array.isArray(value) ||
    new Set(value).size !== value.length ||
    value.some((entryId) => typeof entryId !== "string" || entryId.trim() === "")
  ) {
    throw new Error("target_entry_ids 必须是无重复非空字符串数组");
  }
  const inputOrder = new Map(entries.map((entry, index) => [entry.entry_id, index]));
  return [...value].toSorted((left, right) => {
    const leftIndex = inputOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = inputOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || compareText(left, right);
  });
}

/** 从强 component、非传递弱锚点和分组结果构造完整结构分析。 */
function analyzeRelations(entries, kind) {
  const strong = analyzeStrongRelations(entries, kind);
  const components = buildComponents(entries, strong.parents);
  const componentIndexByEntryIndex = new Map();
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
  const groupByEntryIndex = new Map();
  groups.forEach((group) => {
    for (const entryIndex of group.entry_indexes) groupByEntryIndex.set(entryIndex, group);
  });
  const internalRelationsByGroupId = new Map(groups.map((group) => [group.group_id, []]));
  const crossGroupRelations = [];

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
    const relation = {
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
function analyzeStrongRelations(entries, kind) {
  const unionFind = createUnionFind(entries.length);
  const candidates =
    kind === "glossary" ? findLiteralRelations(entries) : findRegexRelations(entries);
  const edges = [];
  for (const relation of candidates) {
    if (unionFind.union(relation.entry_indexes[0], relation.entry_indexes[1])) {
      edges.push(relation);
    }
  }
  return { parents: unionFind.parents, edges };
}

/** 通过规范化字面索引发现 glossary 的等价与真实包含关系。 */
function findLiteralRelations(entries) {
  const sensitiveByText = new Map();
  const insensitiveByText = new Map();
  entries.forEach((entry, index) => {
    const target = entry.case_sensitive ? sensitiveByText : insensitiveByText;
    const text = normalizeLiteral(entry.src, entry.case_sensitive);
    const indexes = target.get(text) ?? [];
    indexes.push(index);
    target.set(text, indexes);
  });

  const relationsByPair = new Map();
  entries.forEach((parent, parentIndex) => {
    for (const [caseSensitive, candidatesByText] of [
      [true, sensitiveByText],
      [false, insensitiveByText],
    ]) {
      const graphemes = segmentGraphemes(normalizeLiteral(parent.src, caseSensitive));
      for (let start = 0; start < graphemes.length; start += 1) {
        let text = "";
        for (let end = start; end < graphemes.length; end += 1) {
          text += graphemes[end];
          const childIndexes = candidatesByText.get(text) ?? [];
          for (const childIndex of childIndexes) {
            if (childIndex === parentIndex) continue;
            const partial = start > 0 || end + 1 < graphemes.length;
            const relation = partial
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
function findRegexRelations(entries) {
  const indexesBySignature = new Map();
  entries.forEach((entry, index) => {
    const signature = JSON.stringify([entry.src, entry.case_sensitive]);
    const indexes = indexesBySignature.get(signature) ?? [];
    indexes.push(index);
    indexesBySignature.set(signature, indexes);
  });
  return [...indexesBySignature.values()].flatMap((indexes) => {
    const first = indexes[0];
    return indexes.slice(1).map((index) => ({
      reason: "equivalent",
      entry_indexes: [first, index],
    }));
  });
}

/** 把 union-find 根投影为遵循原输入顺序的强连通 component。 */
function buildComponents(entries, parents) {
  const find = createFind(parents);
  const byRoot = new Map();
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
function buildWeakAnchors(entries, components, componentIndexByEntryIndex) {
  const rootIndex = new Map();
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

  const bestByComponents = new Map();
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
function buildGroups(entries, components, strongEdges, weakAnchors) {
  const assignedComponents = new Set();
  const groups = [];
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
function splitLargeComponent(component, strongEdges, entryCount) {
  const componentEntrySet = new Set(component.entry_indexes);
  const adjacency = Array.from({ length: entryCount }, () => []);
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
  const groups = [];
  while (remaining.size > 0) {
    const anchor = [...remaining].toSorted((left, right) => {
      const leftDegree = adjacency[left].filter((neighbor) => remaining.has(neighbor.index)).length;
      const rightDegree = adjacency[right].filter((neighbor) =>
        remaining.has(neighbor.index),
      ).length;
      return rightDegree - leftDegree || left - right;
    })[0];
    const queue = [anchor];
    const queued = new Set(queue);
    const group = [];
    while (queue.length > 0 && group.length < MAX_GROUP_ENTRIES) {
      const current = queue.shift();
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
  relation,
  entryIndexes,
  groupByEntryIndex,
  internalRelationsByGroupId,
  crossGroupRelations,
) {
  const groupIds = [
    ...new Set(entryIndexes.map((entryIndex) => groupByEntryIndex.get(entryIndex)?.group_id)),
  ]
    .filter((groupId) => groupId !== undefined)
    .toSorted(compareText);
  if (groupIds.length === 1) {
    internalRelationsByGroupId.get(groupIds[0]).push(relation);
    return;
  }
  if (groupIds.length > 1) crossGroupRelations.push({ ...relation, group_ids: groupIds });
}

/** 把内部索引边转换成 recipe 的稳定业务 ID 结果。 */
function relationFromStrongEdge(edge, entries) {
  return {
    reason: edge.reason,
    entry_ids: edge.entry_indexes.map((entryIndex) => entries[entryIndex].entry_id),
  };
}

/** 多条发现路径可能产生同一关系，按稳定序列化键去重且保留首次顺序。 */
function dedupeRelations(relations) {
  const byKey = new Map();
  for (const relation of relations) {
    const key = JSON.stringify(relation);
    if (!byKey.has(key)) byKey.set(key, relation);
  }
  return [...byKey.values()];
}

/** 建立按规模合并的 union-find，返回的 parents 供 component 投影复用。 */
function createUnionFind(size) {
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
function createFind(parents) {
  return (start) => {
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
function compareStrongRelations(left, right) {
  const leftMin = Math.min(...left.entry_indexes);
  const rightMin = Math.min(...right.entry_indexes);
  return (
    relationRank(left.reason) - relationRank(right.reason) ||
    leftMin - rightMin ||
    Math.max(...left.entry_indexes) - Math.max(...right.entry_indexes)
  );
}

/** 同一 component 集合只保留最长、覆盖最高且最早出现的弱锚点。 */
function compareSameComponentAnchors(left, right) {
  return (
    right.root_length - left.root_length ||
    right.min_coverage - left.min_coverage ||
    left.first_entry_index - right.first_entry_index ||
    compareText(left.root, right.root)
  );
}

/** 弱组优先采用更具体、覆盖更高且连接更多 component 的锚点。 */
function compareWeakAnchors(left, right) {
  return (
    right.root_length - left.root_length ||
    right.min_coverage - left.min_coverage ||
    right.component_indexes.length - left.component_indexes.length ||
    left.first_entry_index - right.first_entry_index ||
    compareText(left.root, right.root)
  );
}

/** 等价边优先于包含边，弱关系只在排序兜底中位于末尾。 */
function relationRank(reason) {
  return reason === "equivalent" ? 0 : reason === "contains" ? 1 : 2;
}

/** 统一 NFKC 和大小写折叠，并补齐 JS 小写在 ß 与希腊尾形上的差异。 */
function normalizeLiteral(text, caseSensitive) {
  const normalized = text.normalize("NFKC");
  return caseSensitive
    ? normalized
    : normalized.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLowerCase().replaceAll("ς", "σ");
}

/** 将字符串分成用户可见字符，所有长度和片段计算共用此入口。 */
function segmentGraphemes(text) {
  return [...GRAPHEME_SEGMENTER.segment(text)].map((segment) => segment.segment);
}

/** 无向条目对使用小索引在前的稳定键。 */
function pairKey(left, right) {
  return left < right
    ? `${left.toString()}:${right.toString()}`
    : `${right.toString()}:${left.toString()}`;
}

/** 以输入稳定顺序生成便于跨分页引用的定宽 ID。 */
function stableId(prefix, index) {
  return `${prefix}-${(index + 1).toString().padStart(4, "0")}`;
}

/** 避免 locale 环境影响 recipe 的稳定顺序。 */
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 将外部 kind 收窄到 contract 支持的质量规则种类。 */
function readKind(value) {
  if (!QUALITY_RULE_KINDS.includes(value)) {
    throw new Error("kind 必须是 glossary 或 text_preserve");
  }
  return value;
}

/** 统一拒绝 null、数组和非对象输入。 */
function readRecord(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} 必须是 object`);
  }
  return value;
}

/** 统一校验 recipe 身份和源码字段，但保留原始字符串内容。 */
function readNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value;
}

// runner 在同一函数体末尾追加真实调用；这里让独立资源的静态检查看到消费者。
void runRecipe;
