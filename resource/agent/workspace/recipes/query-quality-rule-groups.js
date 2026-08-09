// 参数形状和值域由 workspace_recipe 工具 Schema 校验；recipe 只保留组查询语义。
const keywords = args.keywords ?? [];
const normalizedKeywords = [
  ...new Set(keywords.map((value) => value.trim().normalize("NFKC").toLowerCase())),
];
const includeExamples = args.include_examples ?? false;
const offset = args.offset ?? 0;
const limit = args.limit ?? 20;
const contract = await workspace.readJson("contract.json");
const dataset = contract.datasets[args.kind];
const evidenceDataset = contract.datasets[`${args.kind}_evidence`];

const entries = [];
for await (const entry of workspace.readJsonl(dataset.path)) entries.push(entry);
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
    target_ids: members.filter((id) => targetIdSet.has(id)),
    evidence_ids: members.filter((id) => !targetIdSet.has(id)),
  }));

const pageGroups = groups.slice(offset, offset + limit);
// 当前页同时返回范围内目标和仅供判断的范围外组证据。
const includedIds = new Set(
  pageGroups.flatMap((group) => [...group.target_ids, ...group.evidence_ids]),
);
const pageEntries = entries
  .filter((entry) => includedIds.has(entry.id))
  .map((entry) => {
    const entryEvidence = evidence.by_id[entry.id];
    return {
      ...entry,
      hits: entryEvidence.hits,
      ...(includeExamples ? { examples: entryEvidence.examples } : {}),
    };
  });
const nextOffset = offset + pageGroups.length;

return {
  total_target_rule_count: targetIds.length,
  total_group_count: groups.length,
  groups: pageGroups,
  entries: pageEntries,
  ...(nextOffset < groups.length ? { next_offset: nextOffset } : {}),
};
