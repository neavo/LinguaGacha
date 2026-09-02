import type { FetchFunction } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebSearchService } from "./agent-web-search";
import type { AgentWebSearchProvider } from "./tools/web";

const TEST_CLIENT_VERSION = "1.2.3";

describe("Agent Web 多源搜索服务", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("映射五家无凭据 MCP 参数，并把成功来源晋升为首选", async () => {
    const network = create_mcp_network({
      exa: [{ status: 429 }, { text: "Exa 结果" }],
      tavily: [{ text: "Tavily 结果" }, { status: 429 }],
      firecrawl: [{ text: "Firecrawl 结果" }, { status: 429 }],
      anysearch: [{ text: "AnySearch 结果" }, { status: 429 }],
      keenable: [{ text: "Keenable 结果" }, { status: 429 }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    const signal = new AbortController().signal;

    await expect(service.search("第一次查询", signal)).resolves.toEqual({
      provider: "tavily",
      text: "Tavily 结果",
    });
    await expect(service.search("第二次查询", signal)).resolves.toEqual({
      provider: "firecrawl",
      text: "Firecrawl 结果",
    });
    await expect(service.search("第三次查询", signal)).resolves.toEqual({
      provider: "anysearch",
      text: "AnySearch 结果",
    });
    await expect(service.search("第四次查询", signal)).resolves.toEqual({
      provider: "keenable",
      text: "Keenable 结果",
    });
    await expect(service.search("第五次查询", signal)).resolves.toEqual({
      provider: "exa",
      text: "Exa 结果",
    });
    await service.dispose();

    expect(network.tool_calls).toEqual([
      {
        provider: "exa",
        name: "web_search_exa",
        arguments: { query: "第一次查询", numResults: expect.any(Number) },
      },
      {
        provider: "tavily",
        name: "tavily_search",
        arguments: { query: "第一次查询", max_results: expect.any(Number) },
      },
      {
        provider: "tavily",
        name: "tavily_search",
        arguments: { query: "第二次查询", max_results: expect.any(Number) },
      },
      {
        provider: "firecrawl",
        name: "firecrawl_search",
        arguments: {
          query: "第二次查询",
          limit: expect.any(Number),
          sources: [{ type: "web" }],
        },
      },
      {
        provider: "firecrawl",
        name: "firecrawl_search",
        arguments: {
          query: "第三次查询",
          limit: expect.any(Number),
          sources: [{ type: "web" }],
        },
      },
      {
        provider: "anysearch",
        name: "search",
        arguments: { query: "第三次查询", max_results: expect.any(Number) },
      },
      {
        provider: "anysearch",
        name: "search",
        arguments: { query: "第四次查询", max_results: expect.any(Number) },
      },
      {
        provider: "keenable",
        name: "search_web_pages",
        arguments: { query: "第四次查询" },
      },
      {
        provider: "keenable",
        name: "search_web_pages",
        arguments: { query: "第五次查询" },
      },
      {
        provider: "exa",
        name: "web_search_exa",
        arguments: { query: "第五次查询", numResults: expect.any(Number) },
      },
    ]);
    for (const provider of [
      "exa",
      "tavily",
      "firecrawl",
      "anysearch",
      "keenable",
    ] satisfies AgentWebSearchProvider[]) {
      expect(
        network.methods.filter(
          (request) => request.provider === provider && request.method === "initialize",
        ),
      ).toHaveLength(1);
      for (const headers of network.headers[provider]) {
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("x-api-key")).toBe(false);
        expect(headers.get("x-tavily-access-mode")).toBe(provider === "tavily" ? "keyless" : null);
      }
    }
  });

  it("会话失效时重建当前供应商连接并只重试一次", async () => {
    const network = create_mcp_network({
      exa: [{ status: 404 }, { text: "重连结果" }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);

    await expect(service.search("重连查询", new AbortController().signal)).resolves.toEqual({
      provider: "exa",
      text: "重连结果",
    });
    await service.dispose();

    expect(
      network.methods.filter(
        (request) => request.provider === "exa" && request.method === "initialize",
      ),
    ).toHaveLength(2);
    expect(network.tool_calls.filter((request) => request.provider === "exa")).toHaveLength(2);
  });

  it("Tavily 以成功正文返回额度错误时继续尝试下一来源", async () => {
    const network = create_mcp_network({
      exa: [{ status: 429 }],
      tavily: [
        {
          text: JSON.stringify({
            code: "monthly_cap_reached_bonus_eligible",
          }),
        },
      ],
      firecrawl: [{ text: "Firecrawl 结果" }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);

    await expect(service.search("额度回退", new AbortController().signal)).resolves.toEqual({
      provider: "firecrawl",
      text: "Firecrawl 结果",
    });
    expect(network.tool_calls.map((request) => request.provider)).toEqual([
      "exa",
      "tavily",
      "firecrawl",
    ]);
    await service.dispose();
  });

  it.each([
    ["全部限流", { status: 429 }, "web_search.rate_limited"],
    ["全部工具失败", { tool_error: true }, "web_search.upstream_failed"],
    ["全部返回空文本", { text: "  " }, "web_search.empty_result"],
  ] satisfies Array<[string, ProviderReply, string]>)(
    "%s时保留明确稳定错误",
    async (_scenario, reply, code) => {
      create_mcp_network({
        exa: [reply],
        tavily: [reply],
        firecrawl: [reply],
        anysearch: [reply],
        keenable: [reply],
      });
      const service = new WebSearchService(TEST_CLIENT_VERSION);

      await expect(service.search("失败查询", new AbortController().signal)).rejects.toMatchObject({
        details: { code },
      });
      await service.dispose();
    },
  );

  it("来源失败原因不一致时统一映射为不可用", async () => {
    create_mcp_network({
      exa: [{ tool_error: true }],
      tavily: [{ text: " " }],
      firecrawl: [{ status: 500 }],
      anysearch: [{ status: 500 }],
      keenable: [{ status: 500 }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);

    await expect(service.search("混合失败", new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_search.unavailable" },
    });
    await service.dispose();
  });

  it("全部来源单次预算都超时时返回整次搜索超时", async () => {
    const timeout = new AbortController();
    timeout.abort(new DOMException("超时", "TimeoutError"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    create_mcp_network();
    const service = new WebSearchService(TEST_CLIENT_VERSION);

    await expect(service.search("超时查询", new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_search.timeout" },
    });
    await service.dispose();
  });

  it("调用前已取消时不触达任何供应商", async () => {
    const network = create_mcp_network();
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    const controller = new AbortController();
    controller.abort(new Error("提前取消"));

    await expect(service.search("不会搜索", controller.signal)).rejects.toThrow("提前取消");
    expect(network.fetch).not.toHaveBeenCalled();
    await service.dispose();
  });
});

type ProviderReply = Readonly<{
  status?: number;
  tool_error?: boolean;
  text?: string;
}>;

type McpNetworkOptions = Partial<
  Readonly<Record<AgentWebSearchProvider, readonly ProviderReply[]>>
>;

type McpRequest = Readonly<{
  provider: AgentWebSearchProvider;
  method: string;
}>;

type McpToolCall = Readonly<{
  provider: AgentWebSearchProvider;
  name: string;
  arguments: Record<string, unknown>;
}>;

/** 用真实 MCP SDK 驱动多源最小假服务，只替换不可重复的远端 HTTP 边界。 */
function create_mcp_network(options: McpNetworkOptions = {}) {
  const methods: McpRequest[] = [];
  const tool_calls: McpToolCall[] = [];
  const headers: Record<AgentWebSearchProvider, Headers[]> = {
    exa: [],
    tavily: [],
    firecrawl: [],
    anysearch: [],
    keenable: [],
  };
  const replies: Record<AgentWebSearchProvider, ProviderReply[]> = {
    exa: [...(options.exa ?? [])],
    tavily: [...(options.tavily ?? [])],
    firecrawl: [...(options.firecrawl ?? [])],
    anysearch: [...(options.anysearch ?? [])],
    keenable: [...(options.keenable ?? [])],
  };
  const fetch = vi.fn<FetchFunction>(async (input, init) => {
    const provider = read_provider(input);
    headers[provider].push(new Headers(init?.headers));
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body)) as {
      id?: string | number;
      method: string;
      params?: { name: string; arguments: Record<string, unknown> };
    };
    methods.push({ provider, method: message.method });
    if (message.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (message.method === "initialize") {
      return sse_response(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: `${provider}-search-server`, version: "test" },
          },
        },
        { "mcp-session-id": `${provider}-test-session` },
      );
    }
    if (message.method === "tools/call") {
      if (message.params === undefined) throw new Error("tools/call 缺少参数");
      tool_calls.push({ provider, ...message.params });
      const reply = replies[provider].shift() ?? {};
      if (reply.status !== undefined) return new Response(null, { status: reply.status });
      return sse_response({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: reply.text ?? `${provider} 搜索结果`,
            },
          ],
          ...(reply.tool_error === true ? { isError: true } : {}),
        },
      });
    }
    throw new Error(`未处理的 MCP 方法：${message.method}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, headers, methods, tool_calls };
}

/** 从固定托管地址恢复供应商身份，测试不依赖请求顺序猜来源。 */
function read_provider(input: Parameters<FetchFunction>[0]): AgentWebSearchProvider {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "mcp.exa.ai") return "exa";
  if (url.hostname === "mcp.tavily.com") return "tavily";
  if (url.hostname === "mcp.firecrawl.dev") return "firecrawl";
  if (url.hostname === "api.anysearch.com") return "anysearch";
  if (url.hostname === "api.keenable.ai") return "keenable";
  throw new Error(`未知搜索供应商：${url.hostname}`);
}

/** 生成 Streamable HTTP 返回的单条 SSE JSON-RPC 响应。 */
function sse_response(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}
