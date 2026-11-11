import { expect, it, vi } from "vitest";
import { create_search_port, execute_search_request } from "./request";
import type { JsonRecord } from "../../../domain/json";

/** 构造模型配置，凭据均为测试自有值。 */
function model(api_url: string, api_key = "fixture-key"): JsonRecord {
  return { api_url, api_key, api_format: "OpenAIResponses" };
}

it("官方凭据与主控无关，启动固定首个有效 Key 且只发送 Search 参数", async () => {
  const configured = model(
    "https://api.deepseek.com/v1/responses",
    "no_key_required\n first-key\nsecond-key",
  );
  const config = { models: [model("https://proxy.example/v1"), configured] };
  const search = create_search_port(config);
  configured["api_key"] = "updated-key";
  const fetcher = vi.fn().mockImplementation(async () => new Response('{"results":[]}'));
  vi.stubGlobal("fetch", fetcher);
  const response = await search({ query: "查询" }, new AbortController().signal);
  expect(response.provider).toBe("deepseek");
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.deepseek.com/v1/tools/search");
  expect(init.headers.Authorization).toBe("Bearer first-key");
  expect(JSON.parse(init.body)).toEqual({
    query: "查询",
    count: expect.any(Number),
    need_content: false,
  });
  expect(init.redirect).toBe("error");
  expect(JSON.stringify(response)).not.toContain("first-key");
  await create_search_port(config)({ query: "新查询" }, new AbortController().signal);
  expect(fetcher.mock.calls[1]![1].headers.Authorization).toBe("Bearer updated-key");
});

it.each([
  model("https://api.deepseek.com", "no_key_required"),
  model("https://api.deepseek.com", " "),
  model("https://api.deepseek.com.evil.example"),
  model("http://api.deepseek.com"),
  model("https://api.deepseek.com:444"),
  model("https://user@api.deepseek.com"),
  model("https://api.deepseek.com/?key=x"),
  { ...model("https://api.deepseek.com"), auth_type: "oauth" },
])("无官方凭据时默认 Exa，显式 DeepSeek 报错且不发请求：%j", async (record) => {
  const fetcher = vi.fn().mockResolvedValue(new Response("result"));
  vi.stubGlobal("fetch", fetcher);
  const search = create_search_port({ models: [record] });
  expect((await search({ query: "q" }, new AbortController().signal)).provider).toBe("exa");
  await expect(
    search({ query: "q", provider: "deepseek" }, new AbortController().signal),
  ).rejects.toThrow("official API Key");
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  [
    "exa",
    "https://mcp.exa.ai/mcp?tools=web_search_exa",
    "web_search_exa",
    { query: "q", numResults: expect.any(Number) },
  ],
  [
    "tavily",
    "https://mcp.tavily.com/mcp/",
    "tavily_search",
    { query: "q", max_results: expect.any(Number) },
  ],
  [
    "firecrawl",
    "https://mcp.firecrawl.dev/v2/mcp",
    "firecrawl_search",
    { query: "q", limit: expect.any(Number), sources: [{ type: "web" }] },
  ],
  [
    "anysearch",
    "https://api.anysearch.com/mcp",
    "search",
    { query: "q", max_results: expect.any(Number) },
  ],
  ["keenable", "https://api.keenable.ai/mcp", "search_web_pages", { query: "q" }],
] as const)("%s 发送一次原生协议请求并保留正文", async (provider, url, tool, args) => {
  const body =
    'event: message\ndata: {"result":{"isError":false,"content":[{"type":"text","text":"monthly limit reached"}]}}\n\n';
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await create_search_port({})({ provider, query: "q" }, new AbortController().signal),
  ).toEqual({ provider, status: 200, contentType: "text/event-stream", body });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe(url);
  const init = fetcher.mock.calls[0]![1];
  expect(JSON.parse(init.body)).toEqual({
    jsonrpc: "2.0",
    id: expect.any(Number),
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
  expect(init.headers.Authorization).toBeUndefined();
  if (provider === "tavily") expect(init.headers["X-Tavily-Access-Mode"]).toBe("keyless");
});

it("HTTP 错误保留响应且不自动换源，网络失败继续抛出", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("quota", { status: 429 }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  vi.stubGlobal("fetch", fetcher);
  const search = create_search_port({});
  expect(await search({ query: "q" }, new AbortController().signal)).toMatchObject({
    status: 429,
    body: "quota",
  });
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(search({ query: "q" }, new AbortController().signal)).rejects.toThrow(
    "network unavailable",
  );
});

it("跨进程拒绝坏参数，DeepSeek 按 Unicode 字符限制查询", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const search = create_search_port({ models: [model("https://api.deepseek.com/")] });
  const signal = new AbortController().signal;
  for (const input of [
    { query: " " },
    { query: "q", provider: "unknown" },
    { query: "q", url: "https://example.com" },
  ]) {
    await expect(
      execute_search_request({ kind: "search", ...input }, signal, search),
    ).rejects.toThrow("Invalid");
  }
  await expect(search({ query: "😀".repeat(129) }, signal)).rejects.toThrow("128");
  expect(fetcher).not.toHaveBeenCalled();
  await search({ query: "😀".repeat(128) }, signal);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("宿主停止会取消正在读取的响应正文", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => ({
      status: 200,
      headers: new Headers(),
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
          started();
        }),
    })),
  );
  const stopped = new Error("stopped");
  const pending = create_search_port({})({ query: "q" }, controller.signal);
  const assertion = expect(pending).rejects.toBe(stopped);
  await reading;
  controller.abort(stopped);
  await assertion;
});
