// 关系组按加载快照查询；参数只在会造成静默误判或无界输出时就地拒绝。
async function runRecipe(workspace, args) {
  const keywords = args.keywords ?? [];
  if (keywords.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error("keywords 不能包含空白值");
  }
  const normalizedKeywords = [
    ...new Set(keywords.map((value) => value.trim().normalize("NFKC").toLowerCase())),
  ];
  const includeExamples = args.include_examples ?? false;
  const offset = args.offset ?? 0;
  const contract = workspace.contract;
  const limit = args.limit ?? contract.limits.recipe_page_default;
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset 必须是非负整数");
  if (!Number.isInteger(limit) || limit < 1 || limit > contract.limits.recipe_page_max) {
    throw new Error(`limit 必须是 1..${contract.limits.recipe_page_max} 的整数`);
  }
  const dataset = contract.datasets[args.kind];
  const evidenceDataset = contract.datasets[`${args.kind}_evidence`];
  if (dataset === undefined || evidenceDataset === undefined) {
    throw new Error(`未知 quality kind: ${String(args.kind)}`);
  }

  const entries = [];
  const entryById = new Map();
  for await (const entry of workspace.iterateJsonl(dataset.path)) {
    entries.push(entry);
    entryById.set(entry.id, entry);
  }
  const evidence = await workspace.readJson(evidenceDataset.path);
  // targetIds 是完整关键词命中范围；分页单位仍是不可拆分的关系组。
  const targetIds = entries
    .filter((entry) => {
      if (normalizedKeywords.length === 0) return true;
      const source = entry.src.normalize("NFKC").toLowerCase();
      return normalizedKeywords.some((keyword) => source.includes(keyword));
    })
    .map((entry) => entry.id);
  const targetIdSet = new Set(targetIds);

  const groups = evidence.groups
    .filter((members) => members.some((id) => targetIdSet.has(id)))
    .map((members) => ({
      targetIds: members.filter((id) => targetIdSet.has(id)),
      evidenceIds: members.filter((id) => !targetIdSet.has(id)),
    }));

  const pageGroups = groups.slice(offset, offset + limit);
  // 目标与范围外证据共用同一具名对象投影。
  const toEntry = (id) => {
    const entry = entryById.get(id);
    const entryEvidence = evidence.by_id[id];
    return {
      ...entry,
      hits: entryEvidence.hits,
      ...(includeExamples ? { examples: entryEvidence.examples } : {}),
    };
  };
  const nextOffset = offset + pageGroups.length;

  return {
    total_target_rule_count: targetIds.length,
    total_group_count: groups.length,
    groups: pageGroups.map((group) => ({
      targets: group.targetIds.map(toEntry),
      evidence: group.evidenceIds.map(toEntry),
    })),
    ...(nextOffset < groups.length ? { next_offset: nextOffset } : {}),
  };
}

// runner 在同一函数体末尾追加真实调用；这里让独立资源的静态检查看到消费者。
void runRecipe;
