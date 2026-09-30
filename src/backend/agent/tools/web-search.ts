import { define_agent_tool } from "../tool-definition";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const WEB_SEARCH_MAX_TEXT_CHARS = 50_000; // 避免供应商正文无界占用模型上下文
const TRUNCATION_NOTICE = "[内容因长度限制已截断]"; // 截断后保留模型可见的不完整性事实

/** details 与内部诊断共用的稳定供应商身份。 */
export type AgentWebSearchProvider = "exa" | "tavily" | "firecrawl" | "anysearch" | "keenable";

/** 搜索端口提供模型正文和来源标识。 */
export type AgentWebSearchResult = Readonly<{
  provider: AgentWebSearchProvider;
  text: string;
}>;

/** 工具层通过搜索端口获取正文和来源。 */
export type AgentWebSearchPort = (
  query: string,
  signal: AbortSignal,
) => Promise<AgentWebSearchResult>;

/** 搜索提供候选 URL。工作区脚本负责读取和处理网页。 */
export function create_agent_web_search_tool(search: AgentWebSearchPort): ToolDefinition {
  return define_agent_tool({
    name: "web_search",
    description: "搜索互联网。",
    executionMode: "sequential",
    parameters: Type.Object(
      {
        query: Type.String({
          minLength: 1,
          description: "用自然语言描述搜索目标。",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (_tool_call_id, params, signal) => {
      signal?.throwIfAborted();
      const result = await search(params.query, signal ?? new AbortController().signal);
      const truncated = result.text.length > WEB_SEARCH_MAX_TEXT_CHARS;
      return {
        content: [
          {
            type: "text" as const,
            text: truncated
              ? `${truncate_text(result.text, WEB_SEARCH_MAX_TEXT_CHARS)}\n\n${TRUNCATION_NOTICE}`
              : result.text,
          },
        ],
        details: { provider: result.provider, truncated },
      };
    },
  });
}

/** 按调用方模型字符上限截断，并避免切开 UTF-16 代理项。 */
function truncate_text(value: string, max_chars: number): string {
  let end = max_chars;
  if (value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end -= 1;
  return value.slice(0, end);
}
