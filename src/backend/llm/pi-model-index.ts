import type { Api, Model as PiModel } from "@earendil-works/pi-ai";

/** 目录只提供能力事实，请求身份和价格由各自消费方决定。 */
export type PiCatalogModel = Readonly<
  Pick<
    PiModel<Api>,
    | "id"
    | "baseUrl"
    | "provider"
    | "api"
    | "reasoning"
    | "contextWindow"
    | "maxTokens"
    | "thinkingLevelMap"
    | "compat"
  > & { name?: string; input?: readonly ("text" | "image")[] }
>;

/** 枚举和匹配共用同一份目录，分组保留同名模型的供应商差异。 */
export type PiModelIndex = Readonly<{
  models: readonly PiCatalogModel[];
  match_models(configured_id: string): readonly PiCatalogModel[];
}>;

/** 发布目录时保留全部供应商记录，容量聚合与协议模板选择共用同一组命中项。 */
export function create_pi_model_index(models: readonly PiCatalogModel[]): PiModelIndex {
  const by_id = new Map<string, PiCatalogModel[]>();
  for (const model of models) {
    const id = model.id.toLowerCase();
    const matches = by_id.get(id);
    if (matches === undefined) by_id.set(id, [model]);
    else matches.push(model);
  }
  return {
    models,
    match_models: (configured_id) => match_model_id(configured_id, by_id) ?? [],
  };
}

/** 精确项优先，别名必须命中有分隔边界的最长且唯一模型 ID。索引键已转为小写。 */
export function match_model_id<T>(
  configured_id: string,
  by_id: ReadonlyMap<string, T>,
): T | undefined {
  const normalized_id = configured_id.trim().toLowerCase();
  const exact = by_id.get(normalized_id);
  if (exact !== undefined) return exact;

  let longest_length = 0;
  let matched_id: string | undefined;
  for (const id of by_id.keys()) {
    if (id.length < longest_length || !contains_model_id(normalized_id, id)) continue;
    matched_id = id.length === longest_length ? undefined : id; // 同长度冲突可由后续更长的命中消解
    longest_length = id.length;
  }
  return matched_id === undefined ? undefined : by_id.get(matched_id);
}

const MODEL_ID_WORD_CHARACTER = /[a-z0-9]/u;

/** 字母数字属于模型名，其他字符构成名称匹配边界。 */
function contains_model_id(configured_id: string, id: string): boolean {
  let offset = configured_id.indexOf(id);
  while (offset >= 0) {
    const before = configured_id[offset - 1] ?? "";
    const after = configured_id[offset + id.length] ?? "";
    if (!MODEL_ID_WORD_CHARACTER.test(before) && !MODEL_ID_WORD_CHARACTER.test(after)) return true;
    offset = configured_id.indexOf(id, offset + 1);
  }
  return false;
}
