// 参数校验与 recipe 执行同处一份源码，避免宿主再维护平行输入协议。
const input = args;
if (typeof input !== "object" || input === null || Array.isArray(input)) {
  throw new TypeError("inspect-quality 参数必须是对象");
}
for (const key of Object.keys(input)) {
  if (!["kind", "keywords", "include_examples", "offset", "limit"].includes(key)) {
    throw new TypeError(`inspect-quality 未知参数：${key}`);
  }
}
if (typeof input.kind !== "string") throw new TypeError("kind 非法");
const keywords = input.keywords ?? [];
if (
  !Array.isArray(keywords) ||
  !keywords.every((value) => typeof value === "string" && value.trim() !== "")
) {
  throw new TypeError("keywords 非法");
}
const normalizedKeywords = [
  ...new Set(keywords.map((value) => value.trim().normalize("NFKC").toLowerCase())),
];
const includeExamples = input.include_examples ?? false;
if (typeof includeExamples !== "boolean") throw new TypeError("include_examples 非法");
const offset = input.offset ?? 0;
const limit = input.limit ?? 20;
if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset 非法");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit 非法");

const contract = await workspace.readJson("contract.json");
const dataset = contract.datasets[`quality.${input.kind}`];
const analysisDataset = contract.datasets[`quality_analysis.${input.kind}`];
if (dataset === undefined || analysisDataset === undefined) throw new TypeError("kind 非法");
// 规则正文决定目标范围，后端分析只提供命中、例句与既有结构关系。
const allEntries = [];
for await (const entry of workspace.readJsonl(dataset.path)) allEntries.push(entry);
const analysis = await workspace.readJson(analysisDataset.path);
const directIds = allEntries
  .filter((entry) => {
    if (normalizedKeywords.length === 0) return true;
    const source = entry.src.normalize("NFKC").toLowerCase();
    return normalizedKeywords.some((keyword) => source.includes(keyword));
  })
  .map((entry) => entry.id);
const targetIds = directIds.slice(offset, offset + limit);
const targetSet = new Set(targetIds);
// 当前页命中的目标展开完整结构组，但 target_ids 仍是唯一处置范围。
const groups = analysis.relations.groups.filter((group) => group.some((id) => targetSet.has(id)));
const includedIds = new Set([...targetIds, ...groups.flat()]);
const entries = allEntries
  .filter((entry) => includedIds.has(entry.id))
  .map((entry) => ({
    ...entry,
    hits: analysis.hits_by_id[entry.id] ?? 0,
    ...(includeExamples ? { examples: analysis.examples_by_id[entry.id] ?? [] } : {}),
  }));
const nextOffset = offset + targetIds.length;
// total 只计算直接命中目标，不把组内证据重复计入范围。
return {
  total_entry_count: directIds.length,
  target_ids: targetIds,
  entries,
  groups,
  ...(nextOffset < directIds.length ? { next_offset: nextOffset } : {}),
};
