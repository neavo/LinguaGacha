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
  PROOFREADING_WARNING_CODES,
  type ProofreadingManualStatusCode,
  type ProofreadingClientItem,
  type ProofreadingWarningCode,
} from "../../shared/proofreading/proofreading-types";
import {
  create_text_keyword_matcher,
  type TextKeywordMatcher,
} from "../../shared/text/text-pattern";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProofreadingService } from "../proofreading/proofreading-service";
import type { ProofreadingQueryService } from "../proofreading/proofreading-query-service";

// 工具结果保持小页；筛选值与写入批次共享模型单次调用上限。
const DEFAULT_QUERY_LIMIT = 20;
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
const WARNING_TYPE_PARAMETERS = Type.Union(
  PROOFREADING_WARNING_CODES.map((warning) => Type.Literal(warning)),
);

// 两个只读工具共用同一搜索协议，避免字段默认值和校验语义分叉。
const ITEM_SEARCH_PARAMETERS = Type.Object(
  {
    keyword: Type.String(),
    scope: Type.Optional(
      Type.Union([Type.Literal("src"), Type.Literal("dst"), Type.Literal("all")]),
    ),
    is_regex: Type.Optional(Type.Boolean()),
    case_sensitive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

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
    search: Type.Optional(ITEM_SEARCH_PARAMETERS),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_LIMIT })),
  },
  { additionalProperties: false },
);

/** warning query 只接受真实警告词表，不把 GUI 的“无警告”虚拟筛选值暴露给 Agent。 */
const QUERY_WARNING_ITEMS_PARAMETERS = Type.Object(
  {
    filters: Type.Optional(
      Type.Object(
        {
          warning_types: Type.Optional(
            Type.Array(WARNING_TYPE_PARAMETERS, {
              minItems: 1,
              maxItems: PROOFREADING_WARNING_CODES.length,
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
    search: Type.Optional(ITEM_SEARCH_PARAMETERS),
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

type AgentItemSearch = {
  keyword: string;
  scope?: SearchScope;
  is_regex?: boolean;
  case_sensitive?: boolean;
};

export type AgentItemQuery = {
  filters?: {
    item_ids?: number[];
    statuses?: ItemStatus[];
    file_paths?: string[];
  };
  search?: AgentItemSearch;
  cursor?: string;
  limit?: number;
};

/** Agent warning 查询意图；派生条目与 revision 由后端校对运行态返回。 */
export type AgentWarningItemQuery = {
  filters?: {
    warning_types?: ProofreadingWarningCode[];
    statuses?: ItemStatus[];
    file_paths?: string[];
  };
  search?: AgentItemSearch;
  cursor?: string;
  limit?: number;
};

type AgentItemCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems" | "readItem">;
};

/** Agent 只依赖校对域的 warning 读口和条目写口。 */
export type AgentProofreading = {
  query: Pick<ProofreadingQueryService, "query_warnings">;
  commands: Pick<ProofreadingService, "update_items_from_agent">;
};

type AgentItemDependencies = {
  cache: AgentItemCache;
  proofreading: AgentProofreading;
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
      name: "query_warning_items",
      label: "查询警告条目",
      description:
        "查询当前工程校对评估产生的真实 warning 条目；省略 warning_types 表示任意警告，工程事实变化后应从首屏重新查询。",
      parameters: QUERY_WARNING_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        assert_warning_item_query(params);
        const offset = parse_cursor(params.cursor);
        const result = await dependencies.proofreading.query.query_warnings({
          warning_types: params.filters?.warning_types ?? [...PROOFREADING_WARNING_CODES],
          ...(params.filters?.statuses === undefined ? {} : { statuses: params.filters.statuses }),
          ...(params.filters?.file_paths === undefined
            ? {}
            : { file_paths: params.filters.file_paths }),
          keyword: params.search?.keyword ?? "",
          scope: params.search?.scope ?? "all",
          is_regex: params.search?.is_regex ?? false,
          case_sensitive: params.search?.case_sensitive ?? false,
          offset,
          limit: params.limit ?? DEFAULT_QUERY_LIMIT,
        });
        signal?.throwIfAborted();
        if (result.data.invalid_regex_message !== null) {
          throw new Error(result.data.invalid_regex_message);
        }
        const items = result.data.items.map(project_warning_item);
        const next_offset = offset + items.length;
        const complete = next_offset >= result.data.total_item_count;
        return tool_result({
          sectionRevisions: result.sectionRevisions,
          total_item_count: result.data.total_item_count,
          items,
          cursor: complete ? null : next_offset.toString(),
          complete,
        });
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
        await dependencies.proofreading.commands.update_items_from_agent(
          params,
          AGENT_PROOFREADING_UPDATE_SOURCE,
        );
        const queried = query_agent_items(dependencies.cache, {
          filters: { item_ids: params.changes.map((change) => change.item_id) },
        });
        return tool_result({
          accepted: true,
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

/** warning 工具只返回后续修复必需的条目事实与评估证据。 */
function project_warning_item(item: ProofreadingClientItem): JsonRecord {
  return {
    item_id: item.item_id,
    file_path: item.file_path,
    row_number: item.row_number,
    src: item.src,
    dst: item.dst,
    name_src: Item.normalize_name_field(item.name_src),
    name_dst: Item.normalize_name_field(item.name_dst),
    status: item.status,
    retry_count: item.retry_count,
    warnings: [...item.warnings],
    warning_fragments_by_code: {
      ...(item.warning_fragments_by_code.KANA === undefined
        ? {}
        : { KANA: [...item.warning_fragments_by_code.KANA] }),
      ...(item.warning_fragments_by_code.HANGEUL === undefined
        ? {}
        : { HANGEUL: [...item.warning_fragments_by_code.HANGEUL] }),
      ...(item.warning_fragments_by_code.TEXT_PRESERVE === undefined
        ? {}
        : { TEXT_PRESERVE: [...item.warning_fragments_by_code.TEXT_PRESERVE] }),
    },
    glossary_applications: item.glossary_applications.map((application) => ({
      ...application,
      fields: application.fields.map((field) => ({ ...field })),
    })),
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
  assert_item_search(request.search);
  assert_query_pagination(request);
}

/** warning 查询额外收窄真实 warning 词表，其余边界与 item 查询一致。 */
function assert_warning_item_query(request: AgentWarningItemQuery): void {
  if (!is_json_record(request)) throw new Error("query_warning_items 请求必须是 object");
  assert_known_keys(request, ["filters", "search", "cursor", "limit"]);
  const filters = request.filters;
  if (filters !== undefined) {
    if (!is_json_record(filters)) throw new Error("filters 必须是 object");
    assert_known_keys(filters, ["warning_types", "statuses", "file_paths"]);
    assert_unique_array(
      filters.warning_types,
      "warning_types",
      PROOFREADING_WARNING_CODES.length,
      (value) => PROOFREADING_WARNING_CODES.includes(value as ProofreadingWarningCode),
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
  assert_item_search(request.search);
  assert_query_pagination(request);
}

function assert_item_search(search: AgentItemSearch | undefined): void {
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
}

function assert_query_pagination(request: { cursor?: string; limit?: number }): void {
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
