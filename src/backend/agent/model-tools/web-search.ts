import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

const WEB_SEARCH_MAX_TEXT_CHARS = 50_000; // 避免供应商正文无界占用模型上下文
const TRUNCATION_NOTICE = "[内容因长度限制已截断]"; // 截断后保留模型可见的不完整性事实

const WEB_SEARCH_PARAMETERS = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description: "用自然语言描述希望找到的理想网页，而非只填写关键词。",
    }),
  },
  { additionalProperties: false },
);

/** details 与内部诊断共用的稳定供应商身份。 */
export type AgentWebSearchProvider = "exa" | "tavily" | "firecrawl" | "anysearch" | "keenable";

/** 搜索端口返回模型正文及其实际来源，不泄漏 MCP 响应对象。 */
export type AgentWebSearchResult = Readonly<{
  provider: AgentWebSearchProvider;
  text: string;
}>;

/** Agent 工具层使用的固定搜索端口，不向会话层泄漏 MCP 类型。 */
export type AgentWebSearchPort = (
  query: string,
  signal: AbortSignal,
) => Promise<AgentWebSearchResult>;

/** 搜索只负责发现候选 URL；网页读取与处理由 Workspace Deno 脚本完成。 */
export function create_agent_web_search_tool(search: AgentWebSearchPort): ToolDefinition {
  return defineTool({
    name: "web_search",
    label: "搜索网页",
    description: "搜索公开互联网并返回带 URL 的结果摘要；网页读取和处理使用 workspace_script。",
    executionMode: "sequential",
    parameters: WEB_SEARCH_PARAMETERS,
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
