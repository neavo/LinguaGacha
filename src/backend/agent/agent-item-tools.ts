import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { ITEM_STATUSES, Item, type ItemStatus } from "../../domain/item";
import { is_json_record, read_json_integer, type JsonRecord } from "../../domain/json";
import {
  read_item_source_text_parts,
  read_item_translation_text_parts,
} from "../../shared/item-text";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  type ProofreadingManualStatusCode,
} from "../../shared/proofreading/proofreading-types";
import {
  create_text_keyword_matcher,
  type TextKeywordMatcher,
} from "../../shared/text/text-pattern";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProofreadingService } from "../proofreading/proofreading-service";

// 工具结果保持小页；筛选值与写入批次共享模型单次调用上限。
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 100;
const MAX_TOOL_ITEMS = 500;

/** Agent 发起的 item 提交使用独立 source，确保项目事件保留真实来源。 */
export const AGENT_PROOFREADING_UPDATE_SOURCE = "agent_proofreading_update_items";

const ITEM_STATUS_PARAMETERS = Type.Union(ITEM_STATUSES.map((status) => Type.Literal(status)));
const MANUAL_STATUS_PARAMETERS = Type.Union([
  Type.Literal(PROOFREADING_MANUAL_STATUS_CODES[0]),
  Type.Literal(PROOFREADING_MANUAL_STATUS_CODES[1]),
  Type.Literal(PROOFREADING_MANUAL_STATUS_CODES[2]),
]);

/** item query 组合筛选与单一文本搜索，不返回命中明细或派生审校事实。 */
const QUERY_ITEMS_PARAMETERS = Type.Object(
  {
    filters: Type.Optional(
      Type.Object(
        {
          item_ids: Type.Optional(
            Type.Array(Type.Integer({ minimum: 1 }), {
              minItems: 1,
              maxItems: MAX_TOOL_ITEMS,
              uniqueItems: true,
            }),
          ),
          statuses: Type.Optional(
            Type.Array(ITEM_STATUS_PARAMETERS, {
              minItems: 1,
              maxItems: ITEM_STATUSES.length,
              uniqueItems: true,
            }),
          ),
          file_paths: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              maxItems: MAX_TOOL_ITEMS,
              uniqueItems: true,
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    search: Type.Optional(
      Type.Object(
        {
          keyword: Type.String(),
          scope: Type.Optional(
            Type.Union([Type.Literal("src"), Type.Literal("dst"), Type.Literal("all")]),
          ),
          is_regex: Type.Optional(Type.Boolean()),
          case_sensitive: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_LIMIT })),
  },
  { additionalProperties: false },
);

/** GUI 与 Agent 共享的 item 字段 patch；显式人工状态最后覆盖自动状态。 */
const UPDATE_ITEMS_PARAMETERS = Type.Object(
  {
    changes: Type.Array(
      Type.Object(
        {
          item_id: Type.Integer({ minimum: 1 }),
          dst: Type.Optional(Type.String()),
          name_dst: Type.Optional(Type.String()),
          status: Type.Optional(MANUAL_STATUS_PARAMETERS),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: MAX_TOOL_ITEMS },
    ),
    expected_section_revisions: Type.Object(
      {
        items: Type.Integer({ minimum: 0 }),
        proofreading: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

type AgentProjectItem = JsonRecord & {
  item_id: number;
  src: string;
  dst: string;
  file_path: string;
  row_number: number;
  status: ItemStatus;
  retry_count: number;
};

type SearchScope = "src" | "dst" | "all";

export type AgentItemQuery = {
  filters?: {
    item_ids?: number[];
    statuses?: ItemStatus[];
    file_paths?: string[];
  };
  search?: {
    keyword: string;
    scope?: SearchScope;
    is_regex?: boolean;
    case_sensitive?: boolean;
  };
  cursor?: string;
  limit?: number;
};

type AgentItemCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems" | "readItem">;
};

type AgentItemDependencies = {
  cache: AgentItemCache;
  proofreading: Pick<ProofreadingService, "update_items_from_agent">;
};

/** 构造职责单一的 item query/update 工具。 */
export function create_agent_item_tools(dependencies: AgentItemDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: "query_items",
      label: "查询条目",
      description: "按 ID、状态、文件与文本条件查询当前工程 item 列表。",
      parameters: QUERY_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return tool_result(query_agent_items(dependencies.cache, params));
      },
    }),
    defineTool({
      name: "update_items",
      label: "更新条目",
      description: "按 items/proofreading revision 原子更新多个 item 的译文、译名和人工状态。",
      executionMode: "sequential",
      parameters: UPDATE_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        assert_item_changes(params.changes);
        await dependencies.proofreading.update_items_from_agent(
          params,
          AGENT_PROOFREADING_UPDATE_SOURCE,
        );
        const queried = query_agent_items(dependencies.cache, {
          filters: { item_ids: params.changes.map((change) => change.item_id) },
        });
        return tool_result({
          accepted: true,
          projectPath: queried["projectPath"],
          sectionRevisions: queried["sectionRevisions"],
          items: queried["items"],
        });
      },
    }),
  ];
}

/** 从当前 cache 快照执行稳定、有限且无全量命中物化的 item 查询。 */
export function query_agent_items(cache: AgentItemCache, request: AgentItemQuery): JsonRecord {
  assert_item_query(request);
  const item_ids = request.filters?.item_ids;
  let candidates: JsonRecord[];
  const missing_item_ids: number[] = [];
  if (item_ids === undefined) {
    candidates = cache.items.readItems();
  } else {
    candidates = [];
    for (const item_id of item_ids) {
      const item = cache.items.readItem(item_id);
      if (item === null) missing_item_ids.push(item_id);
      else candidates.push(item);
    }
  }
  // readItems/readItem 会先恢复可恢复缓存，revision 必须在其后捕获。
  const snapshot = cache.snapshot();

  const statuses =
    request.filters?.statuses === undefined ? undefined : new Set(request.filters.statuses);
  const file_paths =
    request.filters?.file_paths === undefined ? undefined : new Set(request.filters.file_paths);
  const matcher = create_query_matcher(request.search);
  const scope = request.search?.scope ?? "all";
  const offset = parse_cursor(request.cursor);
  const limit = request.limit ?? DEFAULT_QUERY_LIMIT;
  const items: AgentProjectItem[] = [];
  let total_item_count = 0;
  for (const raw_item of candidates) {
    const item = project_agent_item(raw_item);
    if (item.item_id <= 0) continue;
    if (statuses !== undefined && !statuses.has(item.status)) continue;
    if (file_paths !== undefined && !file_paths.has(item.file_path)) continue;
    if (matcher !== undefined && !matches_item_search(item, matcher, scope)) continue;
    if (total_item_count >= offset && items.length < limit) items.push(item);
    total_item_count += 1;
  }
  const next_offset = offset + items.length;
  const complete = next_offset >= total_item_count;
  return {
    projectPath: snapshot.projectPath,
    sectionRevisions: snapshot.sectionRevisions,
    total_item_count,
    items,
    missing_item_ids,
    cursor: complete ? null : next_offset.toString(),
    complete,
  };
}

/** 数据库兼容字段只在工具边界归一一次，模型仅看到稳定窄投影。 */
function project_agent_item(item: JsonRecord): AgentProjectItem {
  return {
    item_id: read_json_integer(item["item_id"] ?? item["id"], 0),
    src: String(item["src"] ?? ""),
    dst: String(item["dst"] ?? ""),
    name_src: Item.normalize_name_field(item["name_src"]),
    name_dst: Item.normalize_name_field(item["name_dst"]),
    tag: String(item["tag"] ?? ""),
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
    file_type: Item.normalize_file_type(item["file_type"]),
    file_path: String(item["file_path"] ?? ""),
    text_type: Item.normalize_text_type(item["text_type"]),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
}

/** 收窄文本搜索配置，并把无效正则转换为工具错误。 */
function create_query_matcher(search: AgentItemQuery["search"]): TextKeywordMatcher | undefined {
  if (search === undefined) return undefined;
  const matcher = create_text_keyword_matcher({
    keyword: search.keyword,
    is_regex: search.is_regex === true,
    case_sensitive: search.case_sensitive === true,
  });
  if (matcher.invalid_regex_message !== null) throw new Error(matcher.invalid_regex_message);
  return matcher;
}

/** scope 同时覆盖正文与对应姓名字段，字段拆分口径复用 shared reader。 */
function matches_item_search(
  item: AgentProjectItem,
  matcher: TextKeywordMatcher,
  scope: SearchScope,
): boolean {
  return [
    ...(scope === "src" || scope === "all" ? read_item_source_text_parts(item) : []),
    ...(scope === "dst" || scope === "all" ? read_item_translation_text_parts(item) : []),
  ].some((part) => matcher.matches(part.text));
}

/** 直接函数调用与公开 schema 使用同一校验语义。 */
function assert_item_query(request: AgentItemQuery): void {
  if (!is_json_record(request)) throw new Error("query_items 请求必须是 object");
  assert_known_keys(request, ["filters", "search", "cursor", "limit"]);
  const filters = request.filters;
  if (filters !== undefined) {
    if (!is_json_record(filters)) throw new Error("filters 必须是 object");
    assert_known_keys(filters, ["item_ids", "statuses", "file_paths"]);
    assert_unique_array(
      filters.item_ids,
      "item_ids",
      MAX_TOOL_ITEMS,
      (value) => Number.isSafeInteger(value) && Number(value) > 0,
    );
    assert_unique_array(filters.statuses, "statuses", ITEM_STATUSES.length, (value) =>
      ITEM_STATUSES.includes(value as ItemStatus),
    );
    assert_unique_array(
      filters.file_paths,
      "file_paths",
      MAX_TOOL_ITEMS,
      (value) => typeof value === "string" && value !== "",
    );
  }
  const search = request.search;
  if (search !== undefined) {
    if (!is_json_record(search)) throw new Error("search 必须是 object");
    assert_known_keys(search, ["keyword", "scope", "is_regex", "case_sensitive"]);
    if (typeof search.keyword !== "string" || search.keyword.trim() === "") {
      throw new Error("search.keyword 去空白后不能为空");
    }
    if (search.scope !== undefined && !["src", "dst", "all"].includes(search.scope)) {
      throw new Error("search.scope 无效");
    }
    if (search.is_regex !== undefined && typeof search.is_regex !== "boolean") {
      throw new Error("search.is_regex 必须是 boolean");
    }
    if (search.case_sensitive !== undefined && typeof search.case_sensitive !== "boolean") {
      throw new Error("search.case_sensitive 必须是 boolean");
    }
  }
  parse_cursor(request.cursor);
  if (
    request.limit !== undefined &&
    (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_QUERY_LIMIT)
  ) {
    throw new Error("limit 必须是 1 到 100 的整数");
  }
}

function assert_unique_array(
  value: unknown,
  field: string,
  maximum: number,
  predicate: (item: unknown) => boolean,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximum ||
    new Set(value).size !== value.length ||
    !value.every(predicate)
  ) {
    throw new Error(`${field} 必须是 1 到 ${maximum.toString()} 个唯一合法值`);
  }
}

function assert_known_keys(value: JsonRecord, keys: string[]): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new Error(`未知字段：${unknown}`);
}

/** TypeBox 无法表达跨数组 item_id 唯一和至少一个变更字段，这里补齐关联校验。 */
function assert_item_changes(
  changes: Array<{
    item_id: number;
    dst?: string;
    name_dst?: string;
    status?: ProofreadingManualStatusCode;
  }>,
): void {
  if (changes.length === 0 || changes.length > MAX_TOOL_ITEMS) {
    throw new Error(`changes 必须包含 1 到 ${MAX_TOOL_ITEMS.toString()} 项`);
  }
  const item_ids = new Set<number>();
  for (const change of changes) {
    if (
      !Number.isSafeInteger(change.item_id) ||
      change.item_id <= 0 ||
      item_ids.has(change.item_id)
    ) {
      throw new Error(`item_id 必须是唯一正整数：${change.item_id.toString()}`);
    }
    if (change.dst === undefined && change.name_dst === undefined && change.status === undefined) {
      throw new Error(`item 变更缺少 dst/name_dst/status：${change.item_id.toString()}`);
    }
    item_ids.add(change.item_id);
  }
}

/** 游标是过滤后结果流的非负十进制偏移。 */
function parse_cursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/u.test(cursor)) throw new Error("cursor 无效");
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) throw new Error("cursor 无效");
  return parsed;
}

/** 工具正文和 details 共用同一严格 JSON 事实。 */
function tool_result(details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  };
}
