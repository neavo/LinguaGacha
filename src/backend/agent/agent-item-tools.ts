import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { Item } from "../../domain/item";
import { read_json_integer, type JsonRecord } from "../../domain/json";
import {
  read_item_source_text_parts,
  read_item_translation_text_parts,
} from "../../shared/item-text";
import {
  collect_quality_literal_match_indexes,
  count_quality_literal_matches,
} from "../../shared/quality/quality-statistics";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProofreadingService } from "../proofreading/proofreading-service";

// 查询和批量更新共享有限载荷，避免单次模型工具调用占满上下文或事件循环。
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;
const MAX_QUERY_IDS = 500;
const MAX_QUERY_PATTERNS = 100;

/** Agent 发起的译文提交使用独立 source，AgentService 据此区分自身与外部写入。 */
export const AGENT_PROOFREADING_UPDATE_SOURCE = "agent_proofreading_update_items";

/** 正文 query 以判别 mode 固定三种互斥输入形状；根节点显式 object 兼容模型工具协议。 */
const QUERY_PROJECT_ITEMS_PARAMETERS = Type.Union(
  [
    Type.Object(
      {
        mode: Type.Literal("page"),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_LIMIT })),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        mode: Type.Literal("ids"),
        item_ids: Type.Array(Type.Integer({ minimum: 1 }), {
          minItems: 1,
          maxItems: MAX_QUERY_IDS,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        mode: Type.Literal("search"),
        patterns: Type.Array(Type.String(), {
          minItems: 1,
          maxItems: MAX_QUERY_PATTERNS,
        }),
        scope: Type.Optional(
          Type.Union([Type.Literal("src"), Type.Literal("dst"), Type.Literal("all")]),
        ),
        case_sensitive: Type.Optional(Type.Boolean()),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QUERY_LIMIT })),
      },
      { additionalProperties: false },
    ),
  ],
  { type: "object" },
);

/** 译文工具只接受窄字段变更与双 section 乐观锁。 */
const UPDATE_PROJECT_TRANSLATIONS_PARAMETERS = Type.Object(
  {
    changes: Type.Array(
      Type.Object(
        {
          item_id: Type.Integer({ minimum: 1 }),
          dst: Type.Optional(Type.String()),
          name_dst: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: MAX_QUERY_IDS },
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
};

type AgentItemCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems" | "readItem">;
};

type AgentItemCommands = Pick<ProofreadingService, "update_items_from_agent">;

type AgentItemDependencies = {
  cache: AgentItemCache;
  proofreading: AgentItemCommands;
};

type ProjectItemQuery =
  | { mode: "page"; cursor?: string; limit?: number }
  | { mode: "ids"; item_ids: number[] }
  | {
      mode: "search";
      patterns: string[];
      scope?: "src" | "dst" | "all";
      case_sensitive?: boolean;
      cursor?: string;
      limit?: number;
    };

/** 构造统一正文 query 与窄译文 update 工具。 */
export function create_agent_item_tools(dependencies: AgentItemDependencies): ToolDefinition[] {
  return [
    defineTool({
      name: "query_project_items",
      label: "查询正文",
      description: "按分页、item_ids 或 src/dst/all 字面量搜索查询当前工程正文与译文。",
      parameters: QUERY_PROJECT_ITEMS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return tool_result(query_agent_project_items(dependencies.cache, params));
      },
    }),
    defineTool({
      name: "update_project_translations",
      label: "更新译文",
      description: "按 items/proofreading revision 原子更新当前工程多个 item 的 dst/name_dst。",
      executionMode: "sequential",
      parameters: UPDATE_PROJECT_TRANSLATIONS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        assert_translation_changes(params.changes);
        await dependencies.proofreading.update_items_from_agent(
          params,
          AGENT_PROOFREADING_UPDATE_SOURCE,
        );
        return tool_result(
          query_agent_project_items(dependencies.cache, {
            mode: "ids",
            item_ids: params.changes.map((change) => change.item_id),
          }),
        );
      },
    }),
  ];
}

/** 从当前工程缓存执行稳定、有限的正文查询。 */
export function query_agent_project_items(
  cache: AgentItemCache,
  request: ProjectItemQuery,
): JsonRecord {
  const snapshot = cache.snapshot();
  const common = {
    projectPath: snapshot.projectPath,
    sectionRevisions: snapshot.sectionRevisions,
  };
  if (request.mode === "ids") {
    if (
      request.item_ids.length === 0 ||
      request.item_ids.length > MAX_QUERY_IDS ||
      new Set(request.item_ids).size !== request.item_ids.length ||
      request.item_ids.some((item_id) => !Number.isInteger(item_id) || item_id <= 0)
    ) {
      throw new Error("item_ids 必须是 1 到 500 个唯一正整数");
    }
    const by_id = new Map(
      request.item_ids.flatMap((item_id) => {
        const item = cache.items.readItem(item_id);
        return item === null ? [] : [[item_id, project_agent_item(item)] as const];
      }),
    );
    return {
      ...common,
      items: request.item_ids.flatMap((item_id) => {
        const item = by_id.get(item_id);
        return item === undefined ? [] : [item];
      }),
      missing_item_ids: request.item_ids.filter((item_id) => !by_id.has(item_id)),
      cursor: null,
      complete: true,
    };
  }
  const items = cache.items
    .readItems()
    .map(project_agent_item)
    .filter((item) => item.item_id > 0);
  if (request.mode === "page") {
    const offset = parse_cursor(request.cursor);
    const limit = normalize_limit(request.limit);
    const page = items.slice(offset, offset + limit);
    const next_offset = offset + page.length;
    return {
      ...common,
      items: page,
      cursor: next_offset < items.length ? next_offset.toString() : null,
      complete: next_offset >= items.length,
    };
  }
  return {
    ...common,
    ...search_agent_project_items(items, request),
  };
}

/** 对批量字面量搜索结果做全局稳定分页，并保留各 pattern 的汇总。 */
function search_agent_project_items(
  items: AgentProjectItem[],
  request: Extract<ProjectItemQuery, { mode: "search" }>,
): JsonRecord {
  const patterns = Array.from(
    new Set(request.patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern !== "")),
  );
  if (patterns.length === 0 || patterns.length > MAX_QUERY_PATTERNS) {
    throw new Error("patterns 必须是 1 到 100 个非空字面量");
  }
  const offset = parse_cursor(request.cursor);
  const limit = normalize_limit(request.limit);
  const scope = request.scope ?? "src";
  const contexts = items.flatMap((item) => build_item_contexts(item, scope));
  const texts = contexts.map((context) => context.match_text);
  const case_sensitive = request.case_sensitive === true;
  const matches_by_context = collect_quality_literal_match_indexes({
    patterns,
    texts,
    case_sensitive,
  });
  const counts_by_context = count_quality_literal_matches({ patterns, texts, case_sensitive });
  const matches = contexts.flatMap((context, context_index) =>
    (matches_by_context[context_index] ?? []).map((pattern_index) => ({
      pattern_index,
      context: context.public_context,
    })),
  );
  const page_matches = matches.slice(offset, offset + limit);
  const next_offset = offset + page_matches.length;
  return {
    results: patterns.map((pattern, pattern_index) => {
      const pattern_matches = matches.filter((match) => match.pattern_index === pattern_index);
      return {
        pattern,
        total_matches: counts_by_context.reduce(
          (sum, counts) => sum + (counts[pattern_index] ?? 0),
          0,
        ),
        matched_context_count: pattern_matches.length,
        matched_item_count: new Set(pattern_matches.map((match) => match.context.item_id)).size,
        contexts: page_matches
          .filter((match) => match.pattern_index === pattern_index)
          .map((match) => match.context),
      };
    }),
    cursor: next_offset < matches.length ? next_offset.toString() : null,
    complete: next_offset >= matches.length,
  };
}

/** 按查询 scope 展开可匹配字段，并让返回上下文携带明确字段名。 */
function build_item_contexts(
  item: AgentProjectItem,
  scope: "src" | "dst" | "all",
): Array<{ match_text: string; public_context: JsonRecord }> {
  const parts = [
    ...(scope === "src" || scope === "all" ? read_item_source_text_parts(item) : []),
    ...(scope === "dst" || scope === "all" ? read_item_translation_text_parts(item) : []),
  ];
  return parts.flatMap((part) =>
    part.text === ""
      ? []
      : [
          {
            match_text: part.text,
            public_context: { ...item, field: part.field },
          },
        ],
  );
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
  };
}

/** TypeBox 无法表达跨数组 item_id 唯一和至少一个变更字段，这里补齐关联校验。 */
function assert_translation_changes(
  changes: Array<{ item_id: number; dst?: string; name_dst?: string }>,
): void {
  if (changes.length === 0 || changes.length > MAX_QUERY_IDS) {
    throw new Error("changes 必须包含 1 到 500 项");
  }
  const item_ids = new Set<number>();
  for (const change of changes) {
    if (!Number.isInteger(change.item_id) || change.item_id <= 0 || item_ids.has(change.item_id)) {
      throw new Error(`item_id 必须是唯一正整数：${change.item_id.toString()}`);
    }
    if (change.dst === undefined && change.name_dst === undefined) {
      throw new Error(`译文变更缺少 dst/name_dst：${change.item_id.toString()}`);
    }
    item_ids.add(change.item_id);
  }
}

/** 内部直接调用 query 时仍把分页大小限制在公开上限内。 */
function normalize_limit(limit: number | undefined): number {
  return Math.min(MAX_QUERY_LIMIT, Math.max(1, limit ?? DEFAULT_QUERY_LIMIT));
}

/** 游标是当前稳定结果集的非负十进制偏移。 */
function parse_cursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("cursor 无效");
  return parsed;
}

/** 工具正文和 details 共用同一严格 JSON 事实。 */
function tool_result(details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  };
}
