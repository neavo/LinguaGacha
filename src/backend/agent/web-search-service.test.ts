import { Client, SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebSearchService } from "./web-search-service";
import type { AgentWebSearchProvider } from "./model-tools/web-search";

const TEST_CLIENT_VERSION = "1.2.3";

describe("Agent Web 多源搜索服务", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("映射五家无凭据 MCP 参数，并把成功来源晋升为首选", async () => {
    // 工具名、参数键与 Header 是远端契约；结果条数只验证类型。
    const expected_tools: Record<
      AgentWebSearchProvider,
      { name: string; arguments: Record<string, unknown> }
    > = {
      exa: { name: "web_search_exa", arguments: { numResults: expect.any(Number) } },
      tavily: { name: "tavily_search", arguments: { max_results: expect.any(Number) } },
      firecrawl: {
        name: "firecrawl_search",
        arguments: { limit: expect.any(Number), sources: [{ type: "web" }] },
      },
      anysearch: { name: "search", arguments: { max_results: expect.any(Number) } },
      keenable: { name: "search_web_pages", arguments: {} },
    };
    const network = create_mcp_network({
      exa: [{ status: 429 }, {}],
      tavily: [{}, { status: 429 }],
      firecrawl: [{}, { status: 429 }],
      anysearch: [{}, { status: 429 }],
      keenable: [{}, { status: 429 }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    const signal = new AbortController().signal;
    try {
      for (const [failed, succeeded] of [
        ["exa", "tavily"],
        ["tavily", "firecrawl"],
        ["firecrawl", "anysearch"],
        ["anysearch", "keenable"],
        ["keenable", "exa"],
      ] as const) {
        const query = `寻找 ${succeeded} 结果`;
        const previous_calls = network.tool_calls.length;
        await expect(service.search(query, signal)).resolves.toEqual({
          provider: succeeded,
          text: `${succeeded} 搜索结果`,
        });
        expect(network.tool_calls.slice(previous_calls)).toEqual(
          [failed, succeeded].map((provider) => ({
            provider,
            name: expected_tools[provider].name,
            arguments: { query, ...expected_tools[provider].arguments },
          })),
        );
      }
      for (const provider of Object.keys(expected_tools) as AgentWebSearchProvider[]) {
        expect(
          network.methods.filter(
            (request) => request.provider === provider && request.method === "initialize",
          ),
        ).toHaveLength(1);
        for (const headers of network.headers.get(provider)!) {
          expect(headers.has("authorization")).toBe(false);
          expect(headers.has("x-api-key")).toBe(false);
          expect(headers.get("x-tavily-access-mode")).toBe(
            provider === "tavily" ? "keyless" : null,
          );
        }
      }
    } finally {
      await service.dispose();
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

  it("重建后仍失效就切换来源，下次回访重新建立会话", async () => {
    const network = create_mcp_network({
      exa: [{ status: 404 }, { status: 404 }, { text: "恢复结果" }],
      tavily: [{ text: "临时结果" }, { status: 429 }],
      firecrawl: [{ status: 429 }],
      anysearch: [{ status: 429 }],
      keenable: [{ status: 429 }],
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    const signal = new AbortController().signal;
    try {
      await expect(service.search("首次查询", signal)).resolves.toEqual({
        provider: "tavily",
        text: "临时结果",
      });
      await expect(service.search("再次查询", signal)).resolves.toEqual({
        provider: "exa",
        text: "恢复结果",
      });
      expect(
        network.methods.filter(
          (request) => request.provider === "exa" && request.method === "initialize",
        ),
      ).toHaveLength(3);
      expect(network.tool_calls.filter((request) => request.provider === "exa")).toHaveLength(3);
    } finally {
      await service.dispose();
    }
  });

  it.each(["初始化", "无会话调用"])("%s返回 404 时直接切换来源", async (stage) => {
    const network = create_mcp_network({ exa: [{ status: 404 }] }, (request) => {
      if (request.provider !== "exa" || request.method !== "initialize") return;
      return stage === "初始化"
        ? new Response(null, { status: 404 })
        : initialize_response(request.provider, request.id, false);
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    try {
      await expect(service.search("地址失效", new AbortController().signal)).resolves.toEqual({
        provider: "tavily",
        text: "tavily 搜索结果",
      });
      expect(
        network.methods.filter(
          (request) => request.provider === "exa" && request.method === "initialize",
        ),
      ).toHaveLength(1);
    } finally {
      await service.dispose();
    }
  });

  it.each(["initialize", "tools/call"])("%s进行中取消会中断 HTTP 并结束搜索", async (method) => {
    let notify_started: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      notify_started = resolve;
    });
    let http_cancelled = false;
    const network = create_mcp_network({}, (request, signal) => {
      if (request.provider !== "exa" || request.method !== method) return;
      return new Promise<Response>((_resolve, reject) => {
        signal?.throwIfAborted();
        signal?.addEventListener(
          "abort",
          () => {
            http_cancelled = true;
            reject(signal.reason);
          },
          { once: true },
        );
        notify_started();
      });
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    const caller = new AbortController();
    try {
      const reason = new Error("用户停止搜索");
      const result = expect(service.search("等待响应", caller.signal)).rejects.toBe(reason);
      await started;
      caller.abort(reason);
      await result;
      expect(http_cancelled).toBe(true);
      expect(network.methods.every((request) => request.provider === "exa")).toBe(true);
    } finally {
      caller.abort();
      await service.dispose();
    }
  });

  it("首次连接与会话重建共用预算，预算耗尽后切换来源", async () => {
    const timeout = new AbortController();
    const create_timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeout.signal);
    let exa_connections = 0;
    const network = create_mcp_network({ exa: [{ status: 404 }] }, (request) => {
      if (request.provider === "exa" && request.method === "initialize") {
        exa_connections += 1;
        if (exa_connections === 2) timeout.abort(new DOMException("预算耗尽", "TimeoutError"));
      }
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    try {
      await expect(service.search("限时查询", new AbortController().signal)).resolves.toEqual({
        provider: "tavily",
        text: "tavily 搜索结果",
      });
      expect(exa_connections).toBe(2);
      expect(network.tool_calls.map((request) => request.provider)).toEqual(["exa", "tavily"]);
      expect(create_timeout).toHaveBeenCalledTimes(2);
    } finally {
      await service.dispose();
    }
  });

  it("连接失败会释放客户端，关闭服务后拒绝新搜索", async () => {
    const close = vi.spyOn(Client.prototype, "close");
    const network = create_mcp_network({}, (request) => {
      if (request.provider === "exa" && request.method === "initialize") {
        return new Response(null, { status: 500 });
      }
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    try {
      await service.search("首次查询", new AbortController().signal);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await service.dispose();
    }
    expect(close).toHaveBeenCalledTimes(2);
    const requests = network.fetch.mock.calls.length;
    await expect(service.search("关闭后查询", new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_search.unavailable" },
    });
    expect(network.fetch).toHaveBeenCalledTimes(requests);
  });

  it("单个连接释放失败时仍关闭其余连接并汇总错误", async () => {
    create_mcp_network({ exa: [{ status: 429 }] });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    await service.search("建立两个会话", new AbortController().signal);
    const original_close = Client.prototype.close;
    const failure = new Error("连接清理失败");
    const close = vi
      .spyOn(Client.prototype, "close")
      .mockImplementationOnce(async function (this: Client) {
        await original_close.call(this);
        throw failure;
      });
    await expect(service.dispose()).rejects.toMatchObject({
      errors: [expect.objectContaining({ errors: [failure] })],
    });
    expect(close).toHaveBeenCalledTimes(2);
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

  it("SDK 请求超时保留超时分类", async () => {
    create_mcp_network({}, () => {
      throw new SdkError(SdkErrorCode.RequestTimeout, "Request timed out");
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    try {
      await expect(service.search("SDK 超时", new AbortController().signal)).rejects.toMatchObject({
        details: { code: "web_search.timeout" },
      });
    } finally {
      await service.dispose();
    }
  });

  it("合并文本块并忽略空白和非文本结果", async () => {
    create_mcp_network({}, (request) => {
      if (request.method !== "tools/call") return;
      return sse_response({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            { type: "text", text: " 第一条结果 " },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            { type: "text", text: "\n " },
            { type: "text", text: "第二条结果\n" },
          ],
        },
      });
    });
    const service = new WebSearchService(TEST_CLIENT_VERSION);
    try {
      await expect(service.search("混合结果", new AbortController().signal)).resolves.toEqual({
        provider: "exa",
        text: "第一条结果\n\n第二条结果",
      });
    } finally {
      await service.dispose();
    }
  });

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
function create_mcp_network(
  options: McpNetworkOptions = {},
  respond?: (
    request: McpRequest & { id?: string | number },
    signal: AbortSignal | null | undefined,
  ) => Response | void | Promise<Response>,
) {
  const methods: McpRequest[] = [];
  const tool_calls: McpToolCall[] = [];
  const headers = new Map<AgentWebSearchProvider, Headers[]>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const provider = read_provider(input);
    const provider_headers = headers.get(provider) ?? [];
    provider_headers.push(new Headers(init?.headers));
    headers.set(provider, provider_headers);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const message = JSON.parse(String(init?.body)) as {
      id?: string | number;
      method: string;
      params?: { name: string; arguments: Record<string, unknown> };
    };
    methods.push({ provider, method: message.method });
    const response = await respond?.({ provider, ...message }, init?.signal);
    if (response !== undefined) return response;
    if (
      message.method === "notifications/initialized" ||
      message.method === "notifications/cancelled"
    ) {
      return new Response(null, { status: 202 });
    }
    if (message.method === "initialize") {
      return initialize_response(provider, message.id);
    }
    if (message.method === "tools/call") {
      if (message.params === undefined) throw new Error("tools/call 缺少参数");
      tool_calls.push({ provider, ...message.params });
      // 从调用记录消费预设响应，保持输入夹具只读。
      const reply_index = tool_calls.filter((request) => request.provider === provider).length - 1;
      const reply = options[provider]?.[reply_index] ?? {};
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
function read_provider(input: Parameters<typeof globalThis.fetch>[0]): AgentWebSearchProvider {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "mcp.exa.ai") return "exa";
  if (url.hostname === "mcp.tavily.com") return "tavily";
  if (url.hostname === "mcp.firecrawl.dev") return "firecrawl";
  if (url.hostname === "api.anysearch.com") return "anysearch";
  if (url.hostname === "api.keenable.ai") return "keenable";
  throw new Error(`未知搜索供应商：${url.hostname}`);
}

/** 有会话与无会话端点共享握手内容，只通过响应头表达会话事实。 */
function initialize_response(
  provider: AgentWebSearchProvider,
  id: string | number | undefined,
  session = true,
): Response {
  return sse_response(
    {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: `${provider}-search-server`, version: "test" },
      },
    },
    session ? { "mcp-session-id": `${provider}-test-session` } : {},
  );
}

/** 生成 Streamable HTTP 返回的单条 SSE JSON-RPC 响应。 */
function sse_response(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}
