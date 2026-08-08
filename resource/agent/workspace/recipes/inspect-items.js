// recipe 自己收窄不可信参数；contract 只提供当前工程的枚举与数据路径。
const input = args === undefined ? {} : args;
if (typeof input !== "object" || input === null || Array.isArray(input)) {
  throw new TypeError("inspect-items 参数必须是对象");
}
const knownTop = new Set(["filters", "search", "offset", "limit"]);
for (const key of Object.keys(input)) {
  if (!knownTop.has(key)) throw new TypeError(`inspect-items 未知参数：${key}`);
}
const filters = input.filters ?? {};
const search = input.search ?? {};
if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
  throw new TypeError("filters 必须是对象");
}
if (typeof search !== "object" || search === null || Array.isArray(search)) {
  throw new TypeError("search 必须是对象");
}
for (const key of Object.keys(filters)) {
  if (!["item_ids", "statuses", "file_paths", "warning_types"].includes(key)) {
    throw new TypeError(`inspect-items 未知过滤器：${key}`);
  }
}
for (const key of Object.keys(search)) {
  if (!["keywords", "scope"].includes(key))
    throw new TypeError(`inspect-items 未知搜索参数：${key}`);
}
const contract = await workspace.readJson("contract.json");
const allowedStatuses = new Set(contract.datasets.items.fields.status.values);
const allowedWarningTypes = new Set(contract.datasets.warnings.fields.warnings.values);
// 所有集合参数保持首次出现顺序并去重，空集合统一表示不限制该维度。
const readArray = (value, name, predicate) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(predicate)) throw new TypeError(`${name} 非法`);
  return [...new Set(value)];
};
const itemIds = new Set(
  readArray(filters.item_ids, "item_ids", (value) => Number.isSafeInteger(value) && value > 0),
);
const statuses = new Set(
  readArray(filters.statuses, "statuses", (value) => allowedStatuses.has(value)),
);
const filePaths = new Set(
  readArray(filters.file_paths, "file_paths", (value) => typeof value === "string"),
);
const warningTypes = new Set(
  readArray(filters.warning_types, "warning_types", (value) => allowedWarningTypes.has(value)),
);
const keywordByNormalized = new Map();
for (const raw of readArray(
  search.keywords,
  "keywords",
  (value) => typeof value === "string" && value.trim() !== "",
)) {
  const normalized = raw.trim().normalize("NFKC").toLowerCase();
  if (!keywordByNormalized.has(normalized))
    keywordByNormalized.set(normalized, { raw, normalized });
}
const keywords = [...keywordByNormalized.values()];
const scope = search.scope ?? "all";
if (!["src", "dst", "all"].includes(scope)) throw new TypeError("search.scope 非法");
const offset = input.offset ?? 0;
const limit = input.limit ?? 20;
if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset 非法");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("limit 非法");

const itemPath = contract.datasets.items.path;
const warningPath = contract.datasets.warnings.path;
// warning 以 item_id 联结，避免把同一 item 复制成多条候选。
const warningById = new Map();
for await (const warning of workspace.readJsonl(warningPath))
  warningById.set(warning.item_id, warning);
const matched = [];
for await (const item of workspace.readJsonl(itemPath)) {
  const warning = warningById.get(item.item_id);
  if (itemIds.size > 0 && !itemIds.has(item.item_id)) continue;
  if (statuses.size > 0 && !statuses.has(item.status)) continue;
  if (filePaths.size > 0 && !filePaths.has(item.file_path)) continue;
  if (warningTypes.size > 0 && !(warning?.warnings ?? []).some((code) => warningTypes.has(code)))
    continue;
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
  matched.push({
    ...item,
    ...(warningTypes.size === 0 ? {} : { warning_evidence: warning }),
    ...(matchedKeywords === undefined ? {} : { matched_keywords: matchedKeywords }),
  });
}
// total 始终描述完整匹配集合，items 只承载当前证据页。
const items = matched.slice(offset, offset + limit);
const nextOffset = offset + items.length;
return {
  total_item_count: matched.length,
  items,
  ...(nextOffset < matched.length ? { next_offset: nextOffset } : {}),
};
