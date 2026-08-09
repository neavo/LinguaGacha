// 参数形状和值域由 workspace_recipe 工具 Schema 校验；recipe 只保留查询语义。
const filters = args.filters ?? {};
const search = args.search ?? {};
const includeWarnings = args.include_warnings ?? false;
const offset = args.offset ?? 0;
const limit = args.limit ?? 20;
const contract = await workspace.readJson("contract.json");

const itemIds = new Set(filters.item_ids ?? []);
const statuses = new Set(filters.statuses ?? []);
const filePaths = new Set(filters.file_paths ?? []);
const warningTypes = new Set(filters.warning_types ?? []);
const keywordByNormalized = new Map();
for (const raw of search.keywords ?? []) {
  const normalized = raw.trim().normalize("NFKC").toLowerCase();
  if (!keywordByNormalized.has(normalized)) {
    keywordByNormalized.set(normalized, { raw, normalized });
  }
}
const keywords = [...keywordByNormalized.values()];
const scope = search.scope ?? "all";

const warningById = new Map();
if (warningTypes.size > 0 || includeWarnings) {
  for await (const warning of workspace.readJsonl(contract.datasets.warnings.path)) {
    warningById.set(warning.item_id, warning);
  }
}

let totalItemCount = 0;
const items = [];
// 始终扫描完整匹配集合计算 total，但只把当前页保留在内存中。
for await (const item of workspace.readJsonl(contract.datasets.items.path)) {
  const warning = warningById.get(item.item_id);
  if (itemIds.size > 0 && !itemIds.has(item.item_id)) continue;
  if (statuses.size > 0 && !statuses.has(item.status)) continue;
  if (filePaths.size > 0 && !filePaths.has(item.file_path)) continue;
  if (warningTypes.size > 0 && !(warning?.warnings ?? []).some((code) => warningTypes.has(code))) {
    continue;
  }

  let matchedKeywords;
  if (keywords.length > 0) {
    const source = `${item.src}\n${item.name_src}`.normalize("NFKC").toLowerCase();
    const target = `${item.dst}\n${item.name_dst}`.normalize("NFKC").toLowerCase();
    const haystack = scope === "src" ? source : scope === "dst" ? target : `${source}\n${target}`;
    matchedKeywords = keywords
      .filter((keyword) => haystack.includes(keyword.normalized))
      .map((keyword) => keyword.raw);
    if (matchedKeywords.length === 0) continue;
  }

  if (totalItemCount >= offset && items.length < limit) {
    items.push({
      ...item,
      ...(includeWarnings && warning !== undefined ? { warning_evidence: warning } : {}),
      ...(matchedKeywords === undefined ? {} : { matched_keywords: matchedKeywords }),
    });
  }
  totalItemCount += 1;
}

const nextOffset = offset + items.length;
return {
  total_item_count: totalItemCount,
  items,
  ...(nextOffset < totalItemCount ? { next_offset: nextOffset } : {}),
};
