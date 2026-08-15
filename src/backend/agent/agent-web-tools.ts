import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

import { decode_text_content } from "../../shared/utils/text-tool";
import { AgentToolError } from "./agent-tool";
import type { AgentWebFetchPort, AgentWebFetchResponse } from "./agent-web-fetch";

// 模型侧正文预算与唯一截断标记共同定义稳定输出契约。
const WEB_FETCH_MAX_MARKDOWN_CHARS = 100_000;
const WEB_SEARCH_MAX_TEXT_CHARS = 50_000;
const TRUNCATION_NOTICE = "[内容因长度限制已截断]";

const WEB_SEARCH_PARAMETERS = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description: "用自然语言描述希望找到的理想网页，而非只填写关键词。",
    }),
    num_results: Type.Optional(
      Type.Number({
        description: "返回结果数量，省略时由 Exa 默认返回 10 条。",
      }),
    ),
  },
  { additionalProperties: false },
);

// 工具输入只保留业务参数；协议、地址与资源策略由下载端口统一判定。
const WEB_FETCH_PARAMETERS = Type.Object(
  {
    url: Type.String({
      minLength: 1,
      description: "要读取的公开 HTTP 或 HTTPS URL。",
    }),
  },
  { additionalProperties: false },
);

export type AgentWebFetchDetails = {
  requested_url: string; // 模型请求 URL
  url: string; // 最终重定向 URL
  title: string | null; // 仅 HTML 正文提取可能产生
  content_type: string | null; // 缺失表示服务端未声明；非空值已去除参数并归一大小写
  truncated: boolean; // Markdown 是否被模型侧字符上限截断
};

/** Agent 工具层使用的固定搜索端口，不向会话层泄漏 MCP 类型。 */
export type AgentWebSearchPort = (
  query: string,
  num_results: number | undefined,
  signal: AbortSignal,
) => Promise<string>;

/** GUI Agent 成组获得的完整只读 Web 能力。 */
export type AgentWebPort = Readonly<{
  search: AgentWebSearchPort;
  read: AgentWebFetchPort;
}>;

type ParsedContentType = {
  mime: string;
  charset?: string;
};

/** 注册完整只读 Web 能力；搜索发现候选，抓取负责本地安全下载与正文归一化。 */
export function create_agent_web_tools(web: AgentWebPort): ToolDefinition[] {
  return [
    defineTool({
      name: "web_search",
      label: "搜索网页",
      description: "搜索公开互联网并返回带 URL 的结果摘要；需要完整正文时再调用 web_fetch。",
      executionMode: "sequential",
      parameters: WEB_SEARCH_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const text = await web.search(
          params.query,
          params.num_results,
          signal ?? new AbortController().signal,
        );
        const truncated = text.length > WEB_SEARCH_MAX_TEXT_CHARS;
        return {
          content: [
            {
              type: "text" as const,
              text: truncated
                ? `${truncate_text(text, WEB_SEARCH_MAX_TEXT_CHARS)}\n\n${TRUNCATION_NOTICE}`
                : text,
            },
          ],
          details: { truncated },
        };
      },
    }),
    defineTool({
      name: "web_fetch",
      label: "抓取网页",
      description: "读取公开 HTTP(S) 文本资源并返回 Markdown。",
      executionMode: "sequential",
      parameters: WEB_FETCH_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const response = await web.read(params.url, signal ?? new AbortController().signal);
        return await project_web_fetch_result(params.url, response);
      },
    }),
  ];
}

/** 将下载响应投影为模型正文和不复制正文的 details。 */
async function project_web_fetch_result(requested_url: string, response: AgentWebFetchResponse) {
  const content_type = parse_content_type(response.contentType);
  const decoded = await decode_text_content(
    response.body,
    content_type.charset === undefined ? undefined : { declaredEncoding: content_type.charset },
  );
  const normalized = await normalize_web_content(decoded, content_type.mime, response.url);
  const truncated = normalized.markdown.length > WEB_FETCH_MAX_MARKDOWN_CHARS;
  const markdown = truncated
    ? `${truncate_text(normalized.markdown, WEB_FETCH_MAX_MARKDOWN_CHARS)}\n\n${TRUNCATION_NOTICE}`
    : normalized.markdown;
  const details: AgentWebFetchDetails = {
    requested_url,
    url: response.url,
    title: normalized.title,
    content_type: content_type.mime === "" ? null : content_type.mime,
    truncated,
  };
  const title_line = details.title === null ? "" : `标题：${details.title}\n`;
  const content_type_line =
    details.content_type === null ? "" : `Content-Type：${details.content_type}\n`;
  return {
    content: [
      {
        type: "text" as const,
        text: `来源 URL：${details.url}\n` + title_line + content_type_line + `\n${markdown}`,
      },
    ],
    details,
  };
}

/** 只提取影响本地解码和格式分派的 MIME 与 charset。 */
function parse_content_type(value: string): ParsedContentType {
  const [raw_mime = "", ...parameters] = value.split(";");
  const mime = raw_mime.trim().toLowerCase();
  let charset: string | undefined;
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))\s*$/iu.exec(parameter);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value !== undefined && value.trim() !== "") {
      charset = value.trim();
      break;
    }
  }
  return { mime, ...(charset === undefined ? {} : { charset }) };
}

/** 按 MIME 选择正文提取或代码围栏，不猜测二进制内容。 */
async function normalize_web_content(
  decoded: string,
  mime: string,
  final_url: string,
): Promise<{ markdown: string; title: string | null }> {
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    const { document } = parseHTML(decoded);
    const result = await Defuddle(document as unknown as Document, final_url, {
      markdown: true,
      useAsync: false,
    });
    const markdown = normalize_text(result.content);
    if (markdown === "") {
      throw new AgentToolError({ code: "web_fetch.empty_content", content_type: mime });
    }
    const title = result.title.trim();
    return { markdown, title: title === "" ? null : title };
  }

  const text = normalize_text(decoded);
  if (text === "") {
    throw new AgentToolError({ code: "web_fetch.empty_content", content_type: mime });
  }
  if (mime === "application/json" || /^application\/.+\+json$/u.test(mime)) {
    let formatted = text;
    try {
      formatted = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // 服务端错误声明或返回近似 JSON 时保留原文，格式问题不应让只读抓取失败。
    }
    return { markdown: `\`\`\`json\n${formatted}\n\`\`\``, title: null };
  }
  if (mime === "application/xml" || mime === "text/xml" || /^application\/.+\+xml$/u.test(mime)) {
    return { markdown: `\`\`\`xml\n${text}\n\`\`\``, title: null };
  }
  if (
    mime === "" ||
    mime === "text/markdown" ||
    mime === "text/x-markdown" ||
    mime.startsWith("text/")
  ) {
    return { markdown: text, title: null };
  }
  throw new AgentToolError({ code: "web_fetch.unsupported_content_type", content_type: mime });
}

/** 统一网络文本换行并移除响应外围空白。 */
function normalize_text(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

/** 按调用方模型字符上限截断，并避免切开 UTF-16 代理项。 */
function truncate_text(value: string, max_chars: number): string {
  let end = max_chars;
  if (value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end -= 1;
  return value.slice(0, end);
}
