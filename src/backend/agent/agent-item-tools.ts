import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { ITEM_STATUSES, Item, type ItemStatus } from "../../domain/item";
import { read_json_integer, type JsonRecord } from "../../domain/json";
import { read_optional_item_name_text } from "../../shared/item-name";
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
  create_text_keywords_matcher,
  type TextKeywordsMatcher,
} from "../../shared/text/text-pattern";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProofreadingService } from "../proofreading/proofreading-service";
import type { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import { AgentToolError, agent_tool_result } from "./agent-tool";

// 工具结果保持小页；筛选值与写入批次共享模型单次调用上限。
const DEFAULT_QUERY_LIMIT = 20;
const MAX_QUERY_LIMIT = 100;
const MAX_TOOL_ITEMS = 500;
const ITEM_WRITE_FIELDS = ["dst", "name_dst", "status"] as const;

/** Agent 发起的 item 提交使用独立 source，确保项目事件保留真实来源。 */
export const AGENT_PROOFREADING_UPDATE_SOURCE = "agent_proofreading_update_items";

const ITEM_STATUS_PARAMETERS = Type.Union(
  ITEM_STATUSES.map((status) => Type.Literal(status)),
  {
    description:
      "条目状态：NONE=等待翻译，PROCESSED=翻译成功，ERROR=翻译失败，EXCLUDED=已排除，RULE_SKIPPED=规则跳过，LANGUAGE_SKIPPED=非目标语言，DUPLICATED=重复条目。",
  },
);
const WARNING_TYPE_PARAMETERS = Type.Union(
  PROOFREADING_WARNING_CODES.map((warning) => Type.Literal(warning)),
  {
    description:
      "警告类型：KANA=假名残留，HANGEUL=谚文残留，TEXT_PRESERVE=文本保护失效，SIMILARITY=相似度过高，GLOSSARY=术语未落实，RETRY_THRESHOLD=重试次数达到阈值。",
  },
);
const ITEM_STATUS_FILTER_PARAMETERS = Type.Optional(
  Type.Array(ITEM_STATUS_PARAMETERS, {
    maxItems: MAX_TOOL_ITEMS,
    description: "要限制的状态；省略或空数组表示不限，非空值去重后精确匹配。",
  }),
);
const FILE_PATH_FILTER_PARAMETERS = Type.Optional(
  Type.Array(Type.String({ minLength: 1 }), {
    maxItems: MAX_TOOL_ITEMS,
    description:
      "要限制的文件路径；路径必须来自用户或此前工具结果。省略或空数组表示不限，非空值去重后精确匹配。",
  }),
);
const QUERY_CURSOR_PARAMETERS = Type.Optional(
  Type.String({
    pattern: "^\\d+$",
    maxLength: 16,
    description:
      '结果流的分页游标；省略或 "0" 表示首屏，继续同一查询时原样传入上次结果返回的 cursor。',
  }),
);
const QUERY_LIMIT_PARAMETERS = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: MAX_QUERY_LIMIT,
    description: `单页最大条目数；省略表示 ${DEFAULT_QUERY_LIMIT.toString()}。`,
  }),
);

// 两个只读工具共用同一搜索协议，避免字段默认值和校验语义分叉。
const ITEM_SEARCH_PARAMETERS = Type.Object(
  {
    keywords: Type.Array(Type.String({ pattern: "\\S" }), {
      maxItems: MAX_TOOL_ITEMS,
      description:
        "普通文本搜索词；省略整个 search 或传空数组表示不搜索。非空值按 NFKC 与大小写不敏感语义去重后做 OR 包含匹配。",
    }),
    scope: Type.Optional(
      Type.Union([Type.Literal("src"), Type.Literal("dst"), Type.Literal("all")], {
        description: "搜索原文、译文或两者；省略表示 all。",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "字面量文本搜索；省略或 keywords 为空表示不搜索。非空关键词经 NFKC 归一后忽略大小写，按 OR 做包含匹配；正则和通配符没有特殊含义。",
  },
);

/** item query 组合筛选与多关键字搜索，只返回当前 item 的实际命中关键字。 */
const QUERY_ITEMS_PARAMETERS = Type.Object(
  {
    filters: Type.Optional(
      Type.Object(
        {
          item_ids: Type.Optional(
            Type.Array(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), {
              maxItems: MAX_TOOL_ITEMS,
              description:
                "要限制的条目 ID；ID 必须来自用户或此前工具结果。省略或空数组表示不限，非空值去重后按首次出现顺序精确读取。",
            }),
          ),
          statuses: ITEM_STATUS_FILTER_PARAMETERS,
          file_paths: FILE_PATH_FILTER_PARAMETERS,
        },
        {
          additionalProperties: false,
          description:
            "结构化筛选；省略、空对象或所有子数组为空都表示不限制。多个非空子字段按 AND 组合。",
        },
      ),
    ),
    search: Type.Optional(ITEM_SEARCH_PARAMETERS),
    cursor: QUERY_CURSOR_PARAMETERS,
    limit: QUERY_LIMIT_PARAMETERS,
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
              maxItems: MAX_TOOL_ITEMS,
              description: "要限制的真实警告类型；省略或空数组表示全部类型，非空值去重后精确匹配。",
            }),
          ),
          statuses: ITEM_STATUS_FILTER_PARAMETERS,
          file_paths: FILE_PATH_FILTER_PARAMETERS,
        },
        {
          additionalProperties: false,
          description:
            "结构化筛选；省略、空对象或所有子数组为空都表示不限制。多个非空子字段按 AND 组合。",
        },
      ),
    ),
    search: Type.Optional(ITEM_SEARCH_PARAMETERS),
    cursor: QUERY_CURSOR_PARAMETERS,
    limit: QUERY_LIMIT_PARAMETERS,
  },
  { additionalProperties: false },
);

/** 每条 write 只表达一个明确字段和值，避免用可选标量字段承载无操作语义。 */
const UPDATE_ITEMS_PARAMETERS = Type.Object(
  {
    write: Type.Array(
      Type.Object(
        {
          item_id: Type.Integer({
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            description: "当前快照中已有的 item ID。",
          }),
          field: Type.Union(
            ITEM_WRITE_FIELDS.map((field) => Type.Literal(field)),
            { description: "本条操作要写入的唯一字段。" },
          ),
          value: Type.String({
            description:
              "字段的新值；dst/name_dst 允许空字符串表示清空，status 只接受 NONE、PROCESSED 或 EXCLUDED。",
          }),
        },
        {
          additionalProperties: false,
          description: "单个 item 字段写入；item_id、field 和 value 均为必填。",
        },
      ),
      {
        minItems: 1,
        maxItems: MAX_TOOL_ITEMS,
        description: "要原子提交的单字段写入，至少一项；同一 item 的同一字段不可重复。",
      },
    ),
    expected_revisions: Type.Object(
      {
        items: Type.Integer({ minimum: 0 }),
        proofreading: Type.Integer({ minimum: 0 }),
      },
      {
        additionalProperties: false,
        description:
          "query_items 或 query_warning_items 返回的完整 revisions；任一版本过期时整批拒绝。",
      },
    ),
  },
  { additionalProperties: false },
);

type AgentProjectItem = JsonRecord & {
  item_id: number;
  src: string;
  dst: string;
  name_src?: string;
  name_dst?: string;
  file_path: string;
  row_number: number;
  status: ItemStatus;
  retry_count: number;
};

type AgentItemWriteField = (typeof ITEM_WRITE_FIELDS)[number];

type AgentItemWrite = {
  item_id: number;
  field: AgentItemWriteField;
  value: string;
};

type AgentItemUpdate = {
  item_id: number;
  dst?: string;
  name_dst?: string;
  status?: ProofreadingManualStatusCode;
};

type SearchScope = "src" | "dst" | "all";

type AgentItemSearch = {
  keywords: string[];
  scope?: SearchScope;
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
      description:
        "分页读取当前工程条目及 items/proofreading revisions。可按已知 ID、状态、文件路径和文本组合查询；文本搜索对所选原文/译文字段做 NFKC 归一、大小写不敏感的字面量包含匹配，多个关键词按 OR 组合。filters 省略、空对象或空数组都不限制对应维度，search 省略或 keywords 为空表示不搜索。结果含 total_item_count、窄投影 items，未读完时含 cursor；继续同一查询时原样传回 cursor。只读且不修改工程。",
      parameters: QUERY_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return agent_tool_result(query_agent_items(dependencies.cache, params));
      },
    }),
    defineTool({
      name: "query_warning_items",
      label: "查询警告条目",
      description:
        "分页读取当前校对结果中带真实 warning 的条目、评估证据及 items/proofreading revisions。可按警告类型、状态、文件路径和文本组合查询；文本搜索对所选原文/译文字段做 NFKC 归一、大小写不敏感的字面量包含匹配，多个关键词按 OR 组合。filters 省略、空对象或空数组都不限制对应维度，search 省略或 keywords 为空表示不搜索。结果未读完时含 cursor；继续同一查询时原样传回，工程事实变化后从首屏重查。只读且不修改工程。",
      parameters: QUERY_WARNING_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const matcher = create_query_matcher(params.search);
        const warning_types = normalize_agent_query_set(params.filters?.warning_types);
        const statuses = normalize_agent_query_set(params.filters?.statuses);
        const file_paths = normalize_agent_query_set(params.filters?.file_paths);
        const offset = parse_cursor(params.cursor);
        const result = await dependencies.proofreading.query.query_warnings({
          warning_types: [...(warning_types ?? PROOFREADING_WARNING_CODES)],
          ...(statuses === undefined ? {} : { statuses: [...statuses] }),
          ...(file_paths === undefined ? {} : { file_paths: [...file_paths] }),
          keywords: [...(matcher?.keywords ?? [])],
          scope: params.search?.scope ?? "all",
          offset,
          limit: params.limit ?? DEFAULT_QUERY_LIMIT,
        });
        signal?.throwIfAborted();
        const items = result.data.items.map(project_warning_item);
        const next_offset = offset + items.length;
        return agent_tool_result({
          revisions: project_item_revisions(result.sectionRevisions),
          total_item_count: result.data.total_item_count,
          items,
          ...(next_offset < result.data.total_item_count ? { cursor: next_offset.toString() } : {}),
        });
      },
    }),
    defineTool({
      name: "update_items",
      label: "更新条目",
      description:
        "基于 query_items 或 query_warning_items 的快照原子更新条目。write 至少一项，每项用 item_id、field、value 只写一个 dst、name_dst 或人工 status；expected_revisions 必须原样携带查询所得的 items/proofreading 版本，任一过期则整批拒绝。返回 applied/unchanged、最新 revisions，以及实际更新时的 item ID。",
      executionMode: "sequential",
      parameters: UPDATE_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const changes = read_item_writes(params.write);
        const current_revisions = dependencies.cache.snapshot().sectionRevisions;
        const write_result = await dependencies.proofreading.commands.update_items_from_agent(
          {
            changes,
            expected_section_revisions: params.expected_revisions,
          },
          AGENT_PROOFREADING_UPDATE_SOURCE,
        );
        const change = write_result.changes.at(-1);
        if (change === undefined) {
          return agent_tool_result({
            status: "unchanged",
            revisions: project_item_revisions(current_revisions),
          });
        }
        const updated = change.items?.changedIds ?? [];
        if (updated.length === 0) {
          throw new AgentToolError({ code: "item.write_not_confirmed", action: "query_items" });
        }
        return agent_tool_result({
          status: "applied",
          revisions: project_item_revisions(change.sectionRevisions),
          updated,
        });
      },
    }),
  ];
}

/** Agent item 工具只公开参与乐观锁的双 revision，不回传其它 section 或项目身份。 */
function project_item_revisions(revisions: {
  items?: unknown;
  proofreading?: unknown;
}): JsonRecord {
  return {
    items: read_json_integer(revisions["items"], 0),
    proofreading: read_json_integer(revisions["proofreading"], 0),
  };
}

/** 从当前 cache 快照执行稳定、有限且无全量命中物化的 item 查询。 */
export function query_agent_items(cache: AgentItemCache, request: AgentItemQuery): JsonRecord {
  const item_ids = normalize_agent_query_set(request.filters?.item_ids);
  let candidates: JsonRecord[];
  if (item_ids === undefined) {
    candidates = cache.items.readItems();
  } else {
    candidates = [];
    for (const item_id of item_ids) {
      const item = cache.items.readItem(item_id);
      if (item !== null) candidates.push(item);
    }
  }
  // readItems/readItem 会先恢复可恢复缓存，revision 必须在其后捕获。
  const snapshot = cache.snapshot();

  const statuses = normalize_agent_query_set(request.filters?.statuses);
  const file_paths = normalize_agent_query_set(request.filters?.file_paths);
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
    const matched_keywords =
      matcher === undefined ? undefined : match_item_search(item, matcher, scope);
    if (matched_keywords !== undefined && matched_keywords.length === 0) continue;
    if (total_item_count >= offset && items.length < limit) {
      items.push(matched_keywords === undefined ? item : { ...item, matched_keywords });
    }
    total_item_count += 1;
  }
  const next_offset = offset + items.length;
  return {
    revisions: project_item_revisions(snapshot.sectionRevisions),
    total_item_count,
    items,
    ...(next_offset < total_item_count ? { cursor: next_offset.toString() } : {}),
  };
}

/** 数据库兼容字段只在工具边界归一一次，模型仅看到稳定窄投影。 */
export function project_agent_item(item: JsonRecord): AgentProjectItem {
  const name_src = read_optional_item_name_text(item["name_src"]);
  const name_dst = read_optional_item_name_text(item["name_dst"]);
  return {
    item_id: read_json_integer(item["item_id"] ?? item["id"], 0),
    src: String(item["src"] ?? ""),
    dst: String(item["dst"] ?? ""),
    ...(name_src === null ? {} : { name_src }),
    ...(name_dst === null ? {} : { name_dst }),
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
    file_path: String(item["file_path"] ?? ""),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
}

/** warning 工具只返回后续修复必需的条目事实与评估证据。 */
export function project_warning_item(item: ProofreadingClientItem): JsonRecord {
  return {
    ...project_agent_item({ ...item }),
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

/** Agent 文本搜索固定使用大小写不敏感的字面量包含匹配。 */
function create_query_matcher(search: AgentItemQuery["search"]): TextKeywordsMatcher | undefined {
  if (search === undefined) return undefined;
  const matcher = create_text_keywords_matcher({ keywords: search.keywords, is_regex: false });
  return matcher.keywords.length === 0 ? undefined : matcher;
}

/** scope 同时覆盖正文与对应姓名字段，字段拆分口径复用 shared reader。 */
function match_item_search(
  item: AgentProjectItem,
  matcher: TextKeywordsMatcher,
  scope: SearchScope,
): string[] {
  const matched = new Set(
    [
      ...(scope === "src" || scope === "all" ? read_item_source_text_parts(item) : []),
      ...(scope === "dst" || scope === "all" ? read_item_translation_text_parts(item) : []),
    ].flatMap((part) => matcher.match(part.text)),
  );
  if (matched.size === 0) return [];
  return matcher.keywords.filter((keyword) => matched.has(keyword));
}

/** 只读查询的空集合等同省略，非空集合按首次出现顺序去重。 */
function normalize_agent_query_set<T>(values: readonly T[] | undefined): Set<T> | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return new Set(values);
}

/** 将模型的单字段命令聚合为现有领域字段更新，同一 item 可以写入多个不同字段。 */
function read_item_writes(writes: AgentItemWrite[]): AgentItemUpdate[] {
  const written_fields = new Map<string, string>();
  const updates = new Map<number, AgentItemUpdate>();
  for (const [write_index, write] of writes.entries()) {
    const path = `write[${write_index.toString()}]`;
    const identity = `${write.item_id.toString()}:${write.field}`;
    const first_path = written_fields.get(identity);
    if (first_path !== undefined) {
      throw new AgentToolError({
        code: "item.duplicate_write_target",
        item_id: write.item_id,
        field: write.field,
        paths: [first_path, `${path}.field`],
      });
    }
    if (
      write.field === "status" &&
      !(PROOFREADING_MANUAL_STATUS_CODES as readonly string[]).includes(write.value)
    ) {
      throw new AgentToolError({
        code: "item.invalid_write_value",
        field: "status",
        path: `${path}.value`,
      });
    }
    const update = updates.get(write.item_id) ?? { item_id: write.item_id };
    if (write.field === "status") update.status = write.value as ProofreadingManualStatusCode;
    else update[write.field] = write.value;
    updates.set(write.item_id, update);
    written_fields.set(identity, `${path}.field`);
  }
  return [...updates.values()];
}

/** 游标是过滤后结果流的非负十进制偏移。 */
function parse_cursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) {
    throw new AgentToolError({ code: "item.invalid_cursor", path: "cursor" });
  }
  return parsed;
}
