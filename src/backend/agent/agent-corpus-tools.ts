import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import { read_json_integer, type JsonRecord } from "../../domain/json";
import { read_item_source_text_parts } from "../../shared/item-text";
import {
  collect_quality_literal_match_indexes,
  count_quality_literal_matches,
} from "../../shared/quality/quality-statistics";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";

const DEFAULT_SEARCH_LIMIT = 100;
const MAX_SEARCH_LIMIT = 500;

const SEARCH_CORPUS_PARAMETERS = Type.Object(
  {
    patterns: Type.Array(Type.String(), { minItems: 1 }),
    case_sensitive: Type.Optional(Type.Boolean()),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SEARCH_LIMIT })),
  },
  { additionalProperties: false },
);

type CorpusContext = JsonRecord & {
  item_id: number;
  file_path: string;
  row_number: number;
  field: string;
  src: string;
};

type AgentCorpusCache = {
  readonly items: Pick<CacheReadPort["items"], "readItems">;
};

/**
 * 构造只读正文搜索工具，语料始终从当前工程缓存读取。
 */
export function create_agent_corpus_tools(cache: AgentCorpusCache): AgentTool[] {
  return [
    {
      name: "search_corpus",
      label: "正文搜索",
      description: "批量精确搜索当前工程全部原文语境；按 cursor 分页直到 complete=true。",
      parameters: SEARCH_CORPUS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return tool_result(
          search_agent_corpus(
            cache.items.readItems(),
            params as Parameters<typeof search_agent_corpus>[1],
          ),
        );
      },
    },
  ];
}

/**
 * 复用语料拼装口径：item → 参与匹配的原文文本片段集合（src + name_src）。
 * glossary 的 exact_occurrences 统计与 corpus 的语境搜索共享同一拆分，避免口径漂移。
 */
export function collect_agent_corpus_match_texts(items: JsonRecord[]): string[] {
  return items.flatMap((item) =>
    read_item_source_text_parts(item)
      .filter((part) => part.text !== "")
      .map((part) => part.text),
  );
}

/**
 * 对批量字面量搜索结果做稳定分页，并同时返回出现次数、语境数和 item 数。
 */
export function search_agent_corpus(
  items: JsonRecord[],
  request: {
    patterns: string[];
    case_sensitive?: boolean;
    cursor?: string;
    limit?: number;
  },
): JsonRecord {
  const patterns = Array.from(
    new Set(request.patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern !== "")),
  );
  if (patterns.length === 0) throw new Error("patterns 至少需要一个非空字面量");

  const offset = parse_cursor(request.cursor);
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, request.limit ?? DEFAULT_SEARCH_LIMIT));
  // ponytail: 每页重扫全量语料；真实分页成本不可接受时再引入会话级搜索索引。
  const contexts = items.flatMap((item) => build_corpus_contexts(item));
  const match_texts = contexts.map((context) => context.match_text);
  const case_sensitive = request.case_sensitive === true;
  const matches_by_context = collect_quality_literal_match_indexes({
    patterns,
    texts: match_texts,
    case_sensitive,
  });
  const counts_by_context = count_quality_literal_matches({
    patterns,
    texts: match_texts,
    case_sensitive,
  });
  const matches = contexts.flatMap((context, context_index) =>
    (matches_by_context[context_index] ?? []).map((pattern_index) => ({
      pattern_index,
      context: context.public_context,
    })),
  );
  const page_matches = matches.slice(offset, offset + limit);
  const next_offset = offset + page_matches.length;
  const results = patterns.map((pattern, pattern_index) => {
    const all_pattern_matches = matches.filter((match) => match.pattern_index === pattern_index);
    return {
      pattern,
      total_matches: counts_by_context.reduce(
        (sum, counts) => sum + (counts[pattern_index] ?? 0),
        0,
      ),
      matched_context_count: all_pattern_matches.length,
      matched_item_count: new Set(all_pattern_matches.map((match) => match.context.item_id)).size,
      contexts: page_matches
        .filter((match) => match.pattern_index === pattern_index)
        .map((match) => match.context),
    };
  });

  return {
    results,
    cursor: next_offset < matches.length ? next_offset.toString() : null,
    complete: next_offset >= matches.length,
  };
}

/**
 * 将一个 item 展开为可匹配文本与最小公开定位信息，空文本和无效 item_id 不进入结果。
 */
function build_corpus_contexts(item: JsonRecord): Array<{
  match_text: string;
  public_context: CorpusContext;
}> {
  const item_id = read_json_integer(item["item_id"] ?? item["id"], 0);
  const source = String(item["src"] ?? "");
  return read_item_source_text_parts(item).flatMap((part) =>
    part.text === "" || item_id <= 0
      ? []
      : [
          {
            match_text: part.text,
            public_context: {
              item_id,
              file_path: String(item["file_path"] ?? ""),
              row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
              field: part.field,
              src: source,
            },
          },
        ],
  );
}

/** 将不透明游标收窄为本次稳定结果集的非负偏移。 */
function parse_cursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("cursor 无效");
  return parsed;
}

function tool_result(details: JsonRecord) {
  return Promise.resolve({
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  });
}
