// 参数形状和值域由 workspace_recipe 工具 Schema 校验；recipe 只保留组查询语义。
async function runRecipe(workspace, args) {
  const keywords = args.keywords ?? [];
  const normalizedKeywords = [
    ...new Set(keywords.map((value) => value.trim().normalize("NFKC").toLowerCase())),
  ];
  const includeExamples = args.include_examples ?? false;
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  const contract = workspace.contract;
  const dataset = contract.datasets[args.kind];
  const evidenceDataset = contract.datasets[`${args.kind}_evidence`];
  // 目标与范围外证据共用一张字段表，避免在每行重复键名。
  const entryFields = [
    ...Object.keys(dataset.fields),
    "hits",
    ...(includeExamples ? ["examples"] : []),
  ];

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
  // 行值严格按 entryFields 投影，targets 与 evidence 可以由同一字段表解码。
  const toEntryRow = (id) => {
    const entry = entryById.get(id);
    const entryEvidence = evidence.by_id[id];
    return entryFields.map((field) => {
      if (field === "hits") return entryEvidence.hits;
      if (field === "examples") return entryEvidence.examples;
      return entry[field];
    });
  };
  const nextOffset = offset + pageGroups.length;

  return {
    total_target_rule_count: targetIds.length,
    total_group_count: groups.length,
    entry_fields: entryFields,
    groups: pageGroups.map((group) => ({
      targets: group.targetIds.map(toEntryRow),
      evidence: group.evidenceIds.map(toEntryRow),
    })),
    ...(nextOffset < groups.length ? { next_offset: nextOffset } : {}),
  };
}

// runner 在同一函数体末尾追加真实调用；这里让独立资源的静态检查看到消费者。
void runRecipe;
