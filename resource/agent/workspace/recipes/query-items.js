// 仅用于通用筛选，不代表产品正式字面匹配语义。
async function runRecipe(workspace, args) {
  const filters = args.filters ?? {};
  const search = args.search ?? {};
  const includeWarnings = args.include_warnings ?? false;
  const contract = workspace.contract;
  const offset = args.offset ?? 0;
  const limit = args.limit ?? contract.limits.recipe_page_default;
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset 必须是非负整数");
  if (!Number.isInteger(limit) || limit < 1 || limit > contract.limits.recipe_page_max) {
    throw new Error(`limit 必须是 1..${contract.limits.recipe_page_max} 的整数`);
  }

  const itemIds = new Set(filters.item_ids ?? []);
  const statuses = new Set(filters.statuses ?? []);
  const filePaths = new Set(filters.file_paths ?? []);
  const warningTypes = new Set(filters.warning_types ?? []);
  const keywordByNormalized = new Map();
  for (const raw of search.keywords ?? []) {
    if (typeof raw !== "string" || raw.trim() === "") throw new Error("keywords 不能包含空白值");
    const normalized = raw.trim().normalize("NFKC").toLowerCase();
    if (!keywordByNormalized.has(normalized)) {
      keywordByNormalized.set(normalized, { raw, normalized });
    }
  }
  const keywords = [...keywordByNormalized.values()];
  const scope = search.scope ?? "all";
  const warningById = new Map();
  if (warningTypes.size > 0 || includeWarnings) {
    for await (const warning of workspace.iterateJsonl(contract.datasets.warnings.path)) {
      warningById.set(warning.item_id, warning);
    }
  }

  let totalItemCount = 0;
  const items = [];
  // 始终扫描完整匹配集合计算 total，但只把当前页保留在内存中。
  for await (const item of workspace.iterateJsonl(contract.datasets.items.path)) {
    const warning = warningById.get(item.item_id);
    if (itemIds.size > 0 && !itemIds.has(item.item_id)) continue;
    if (statuses.size > 0 && !statuses.has(item.status)) continue;
    if (filePaths.size > 0 && !filePaths.has(item.file_path)) continue;
    if (
      warningTypes.size > 0 &&
      !(warning?.warnings ?? []).some((code) => warningTypes.has(code))
    ) {
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
        ...(includeWarnings ? { warning_evidence: warning ?? null } : {}),
        ...(keywords.length > 0 ? { matched_keywords: matchedKeywords } : {}),
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
}

// runner 在同一函数体末尾追加真实调用；这里让独立资源的静态检查看到消费者。
void runRecipe;
