import { Check } from "typebox/value";
import { Model } from "../../../domain/model";
import type { JsonRecord } from "../../../domain/json";
import { resolve_model_base_url } from "../../../domain/model-endpoint";
import { collect_api_keys } from "../../llm/llm-request";
import { read_config_model_records } from "../../model/model-config-resolver";
import {
  WORKSPACE_SEARCH_REQUEST_SCHEMA,
  SEARCH_TIMEOUT_MS,
  type SearchPort,
  type SearchProvider,
  type SearchResponse,
} from "./schema";

const SEARCH_COUNT = 10;
const DEEPSEEK_ORIGIN = "https://api.deepseek.com";
const DEEPSEEK_QUERY_MAX_LENGTH = 128;
// 来源差异集中在请求定义中，原生响应由模型判断。
const MCP_SOURCES: Record<
  Exclude<SearchProvider, "deepseek">,
  {
    url: string;
    tool: string;
    arguments: (query: string) => JsonRecord;
    headers?: Record<string, string>;
  }
> = {
  exa: {
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    tool: "web_search_exa",
    arguments: (query) => ({ query, numResults: SEARCH_COUNT }),
  },
  tavily: {
    url: "https://mcp.tavily.com/mcp/",
    tool: "tavily_search",
    arguments: (query) => ({ query, max_results: SEARCH_COUNT }),
    headers: { "X-Tavily-Access-Mode": "keyless" },
  },
  firecrawl: {
    url: "https://mcp.firecrawl.dev/v2/mcp",
    tool: "firecrawl_search",
    arguments: (query) => ({ query, limit: SEARCH_COUNT, sources: [{ type: "web" }] }),
  },
  anysearch: {
    url: "https://api.anysearch.com/mcp",
    tool: "search",
    arguments: (query) => ({ query, max_results: SEARCH_COUNT }),
  },
  keenable: {
    url: "https://api.keenable.ai/mcp",
    tool: "search_web_pages",
    arguments: (query) => ({ query }),
  },
};

/** 只借用官方配置的凭据，模型名称、用途及聊天参数不影响搜索。 */
function read_deepseek_key(config: JsonRecord): string | undefined {
  for (const model of read_config_model_records(config)) {
    if (model["auth_type"] === "oauth") continue;
    const url = URL.parse(
      resolve_model_base_url(
        String(model["api_url"] ?? ""),
        Model.normalize_api_format(model["api_format"]),
      ),
    );
    if (
      !url ||
      url.origin !== DEEPSEEK_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/", "/v1"].includes(url.pathname)
    )
      continue;
    const key = collect_api_keys(String(model["api_key"] ?? "")).find(
      (value) => value !== "no_key_required",
    );
    if (key) return key;
  }
  return undefined;
}

/** 在脚本启动时固定凭据，闭包只留在宿主，不进入 IPC 与工作区文件。 */
export function create_search_port(config: JsonRecord): SearchPort {
  const key = read_deepseek_key(config);
  return async (input, signal) => {
    signal.throwIfAborted();
    const provider = input.provider ?? (key ? "deepseek" : "exa");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let url: string;
    let body: JsonRecord;
    if (provider === "deepseek") {
      if (!key) throw new Error("DeepSeek search requires a configured official API Key.");
      if ([...input.query].length > DEEPSEEK_QUERY_MAX_LENGTH)
        throw new Error(
          `DeepSeek search query must contain at most ${DEEPSEEK_QUERY_MAX_LENGTH} Unicode characters.`,
        );
      url = `${DEEPSEEK_ORIGIN}/v1/tools/search`;
      headers["Authorization"] = `Bearer ${key}`;
      body = { query: input.query, count: SEARCH_COUNT, need_content: false };
    } else {
      const source = MCP_SOURCES[provider];
      url = source.url;
      Object.assign(headers, { Accept: "application/json, text/event-stream" }, source.headers);
      body = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: source.tool, arguments: source.arguments(input.query) },
      };
    }
    // 时限同时覆盖响应头和正文；用户取消优先沿现有工作区生命周期传播。
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: requestSignal,
      redirect: "error",
    });
    return {
      provider,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  };
}

/** 宿主校验跨进程参数，再交给本次执行固定的搜索端口。 */
export async function execute_search_request(
  request: unknown,
  signal: AbortSignal,
  search: SearchPort | undefined,
): Promise<SearchResponse> {
  signal.throwIfAborted();
  if (!Check(WORKSPACE_SEARCH_REQUEST_SCHEMA, request))
    throw new Error("Invalid workspace search request.");
  if (!search) throw new Error("Workspace search unavailable.");
  return search(request, signal);
}
