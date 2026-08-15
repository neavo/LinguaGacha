import type { FetchFunction } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExaWebSearchClient } from "./agent-web-search";

const TEST_CLIENT_VERSION = "1.2.3";

describe("Exa Agent Web 搜索适配器", () => {
  afterEach(() => vi.restoreAllMocks());

  it("通过无凭证 MCP 会话搜索并复用连接", async () => {
    const server = create_mcp_server();
    const client = new ExaWebSearchClient(server.fetch, TEST_CLIENT_VERSION);

    await expect(
      client.search("当前 TypeScript 版本", 3, new AbortController().signal),
    ).resolves.toBe("Title: TypeScript\nURL: https://www.typescriptlang.org/");
    await expect(
      client.search("当前 TypeScript 版本", undefined, new AbortController().signal),
    ).resolves.toContain("https://www.typescriptlang.org/");
    await client.dispose();

    expect(server.methods.filter((method) => method === "initialize")).toHaveLength(1);
    expect(server.tool_calls).toEqual([
      {
        name: "web_search_exa",
        arguments: { query: "当前 TypeScript 版本", numResults: 3 },
      },
      {
        name: "web_search_exa",
        arguments: { query: "当前 TypeScript 版本" },
      },
    ]);
    for (const headers of server.headers) {
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("x-api-key")).toBe(false);
    }
  });

  it.each([
    [429, "web_search.rate_limited"],
    [500, "web_search.unavailable"],
  ])("把 HTTP %i 映射为稳定错误", async (status, code) => {
    const server = create_mcp_server({ tool_statuses: [status] });
    const client = new ExaWebSearchClient(server.fetch, TEST_CLIENT_VERSION);

    await expect(client.search("失败查询", 5, new AbortController().signal)).rejects.toMatchObject({
      details: { code },
    });
    await client.dispose();
  });

  it("把整次搜索超时映射为稳定错误", async () => {
    const timeout = new AbortController();
    timeout.abort(new DOMException("超时", "TimeoutError"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const server = create_mcp_server();
    const client = new ExaWebSearchClient(server.fetch, TEST_CLIENT_VERSION);

    await expect(client.search("超时查询", 5, new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_search.timeout" },
    });
    await client.dispose();
  });

  it("会话失效时重建连接并只重试一次", async () => {
    const server = create_mcp_server({ tool_statuses: [404] });
    const client = new ExaWebSearchClient(server.fetch, TEST_CLIENT_VERSION);

    await expect(client.search("重连查询", 2, new AbortController().signal)).resolves.toContain(
      "https://www.typescriptlang.org/",
    );
    await client.dispose();

    expect(server.methods.filter((method) => method === "initialize")).toHaveLength(2);
    expect(server.tool_calls).toEqual([
      { name: "web_search_exa", arguments: { query: "重连查询", numResults: 2 } },
    ]);
  });

  it.each([
    ["远端工具失败", { tool_error: true }, "web_search.upstream_failed"],
    ["空文本结果", { tool_text: "  " }, "web_search.empty_result"],
  ] satisfies Array<[string, McpServerOptions, string]>)(
    "拒绝%s",
    async (_scenario, options, code) => {
      const server = create_mcp_server(options);
      const client = new ExaWebSearchClient(server.fetch, TEST_CLIENT_VERSION);

      await expect(
        client.search("失败查询", 5, new AbortController().signal),
      ).rejects.toMatchObject({ details: { code } });
      await client.dispose();
    },
  );
});

type McpServerOptions = Readonly<{
  tool_statuses?: readonly number[];
  tool_error?: boolean;
  tool_text?: string;
}>;

/** 用真实 MCP SDK 驱动的最小假服务，只替换不可重复的外部 HTTP 边界。 */
function create_mcp_server(options: McpServerOptions = {}) {
  const methods: string[] = [];
  const tool_calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const headers: Headers[] = [];
  const tool_statuses = [...(options.tool_statuses ?? [])];
  const fetch = vi.fn<FetchFunction>(async (_input, init) => {
    headers.push(new Headers(init?.headers));
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as {
      id?: string | number;
      method: string;
      params?: { name: string; arguments: Record<string, unknown> };
    };
    methods.push(message.method);
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
            serverInfo: { name: "exa-search-server", version: "test" },
          },
        },
        { "mcp-session-id": "test-session" },
      );
    }
    if (message.method === "tools/call") {
      const tool_status = tool_statuses.shift();
      if (tool_status !== undefined) {
        return new Response(null, { status: tool_status });
      }
      if (message.params === undefined) throw new Error("tools/call 缺少参数");
      tool_calls.push(message.params);
      return sse_response({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: options.tool_text ?? "Title: TypeScript\nURL: https://www.typescriptlang.org/",
            },
          ],
          ...(options.tool_error === true ? { isError: true } : {}),
        },
      });
    }
    throw new Error(`未处理的 MCP 方法：${message.method}`);
  });
  return { fetch, headers, methods, tool_calls };
}

/** 生成 Streamable HTTP 返回的单条 SSE JSON-RPC 响应。 */
function sse_response(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}
