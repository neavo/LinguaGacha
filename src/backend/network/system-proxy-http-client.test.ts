import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const direct_dispatchers: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const proxy_dispatchers: Array<{ uri: string; close: ReturnType<typeof vi.fn> }> = [];
  return {
    direct_dispatchers,
    proxy_dispatchers,
    fetch: vi.fn(),
  };
});

vi.mock("undici", () => {
  /** 仅补齐生产模块运行时导入形状。 */
  class Dispatcher {}
  /** 记录直连池实例和释放行为。 */
  class Agent {
    public readonly close = vi.fn(async () => undefined);

    /** 登记直连池，供测试观察释放。 */
    public constructor() {
      mocks.direct_dispatchers.push(this);
    }
  }
  /** HTTP 与 SOCKS 测试共用同一可观察代理池 fake。 */
  class ProxyAgent {
    public readonly uri: string;
    public readonly close = vi.fn(async () => undefined);

    /** 记录代理地址与对应连接池。 */
    public constructor(uri: string) {
      this.uri = uri;
      mocks.proxy_dispatchers.push(this);
    }
  }
  return {
    Agent,
    Dispatcher,
    ProxyAgent,
    Socks5ProxyAgent: ProxyAgent,
    fetch: mocks.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
  };
});

import { SystemProxyHttpClient, parse_system_proxy_route } from "./system-proxy-http-client";
import { with_http_response_info } from "./http-response-info";

beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue(new Response("ok"));
  mocks.direct_dispatchers.length = 0;
  mocks.proxy_dispatchers.length = 0;
});

describe("system proxy route", () => {
  it.each([
    ["DIRECT", { kind: "direct" }],
    ["PROXY 127.0.0.1:7890", { kind: "proxy", uri: "http://127.0.0.1:7890/" }],
    ["HTTPS proxy.example:443", { kind: "proxy", uri: "https://proxy.example/" }],
    ["SOCKS5 localhost:1080", { kind: "socks5", uri: "socks5://localhost:1080" }],
    ["SOCKS4 old:1080; DIRECT", { kind: "direct" }],
  ])("解析 %s", (rules, expected) => {
    expect(parse_system_proxy_route(rules)).toEqual(expected);
  });

  it("没有支持路由时拒绝静默直连", () => {
    expect(() => parse_system_proxy_route("SOCKS4 old:1080")).toThrow(
      "System proxy returned no supported route.",
    );
  });
});

describe("SystemProxyHttpClient", () => {
  it("共享 HTTP 入口把响应状态与重试时间交给调用上下文", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "90" } }),
    );
    const client = new SystemProxyHttpClient({ resolveProxy: vi.fn(async () => "DIRECT") });
    try {
      const result = await with_http_response_info(async () => {
        await client.fetch("https://api.example/v1/chat");
        return {};
      });
      expect(result).toMatchObject({
        http_status: 429,
        retry_after_ms: 90_000,
        http_received_at: expect.any(Number),
      });
    } finally {
      await client.dispose();
    }
  });
  it("安装唯一线程 transport 并在释放时恢复原 fetch", async () => {
    const original_fetch = globalThis.fetch;
    const client = new SystemProxyHttpClient({ resolveProxy: vi.fn(async () => "DIRECT") });

    client.install_as_global_fetch();
    try {
      expect(globalThis.fetch).toBe(client.fetch);
      expect(() => client.install_as_global_fetch()).toThrow();
    } finally {
      await client.dispose();
    }
    expect(globalThis.fetch).toBe(original_fetch);
  });

  it("每次请求按实际 URL 重新解析代理并禁止自动重定向", async () => {
    const resolve_proxy = vi
      .fn()
      .mockResolvedValueOnce("PROXY 127.0.0.1:7890")
      .mockResolvedValueOnce("PROXY 127.0.0.1:7891");
    const client = new SystemProxyHttpClient({ resolveProxy: resolve_proxy });

    await client.fetch("https://api.example/v1/models", { method: "GET" });
    await client.fetch("https://api.example/v1/chat", { method: "POST" });

    expect(resolve_proxy.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example/v1/models",
      "https://api.example/v1/chat",
    ]);
    expect(mocks.fetch.mock.calls.map(([, init]) => init)).toEqual([
      expect.objectContaining({ dispatcher: mocks.proxy_dispatchers[0], redirect: "error" }),
      expect.objectContaining({ dispatcher: mocks.proxy_dispatchers[1], redirect: "error" }),
    ]);
  });

  it("loopback 明确直连且不查询系统代理", async () => {
    const resolve_proxy = vi.fn(async () => "PROXY 127.0.0.1:7890");
    const client = new SystemProxyHttpClient({ resolveProxy: resolve_proxy });

    await client.fetch("http://127.0.0.1:8080/v1/chat");

    expect(resolve_proxy).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/chat",
      expect.objectContaining({ dispatcher: mocks.direct_dispatchers[0] }),
    );
  });

  it("代理解析失败不会发起直连请求", async () => {
    const failure = new Error("resolve failed");
    const client = new SystemProxyHttpClient({
      resolveProxy: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(client.fetch("https://api.example/v1")).rejects.toBe(failure);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("释放所有自有直连和代理连接池", async () => {
    const client = new SystemProxyHttpClient({
      resolveProxy: vi.fn(async (url) =>
        url.endsWith("/a") ? "PROXY 127.0.0.1:7890" : "SOCKS5 127.0.0.1:1080",
      ),
    });
    await client.fetch("https://api.example/a");
    await client.fetch("https://api.example/b");

    await client.dispose();

    expect(mocks.proxy_dispatchers.map(({ close }) => close.mock.calls.length)).toEqual([1, 1]);
    expect(mocks.direct_dispatchers[0]?.close).toHaveBeenCalledOnce();
    await expect(client.fetch("https://api.example/c")).rejects.toThrow("disposed");
  });
});

// 工作区的重定向与取消由原生 fetch / Request 语义决定，代理解析沿同一端口执行。
it("工作区保留 Request 与调用选项，并转发 Request 的取消信号", async () => {
  const resolve_proxy = vi.fn(async () => "DIRECT");
  const client = new SystemProxyHttpClient(
    { resolveProxy: resolve_proxy },
    { redirects: "request" },
  );
  const controller = new AbortController();
  const request = new Request("https://example.com/page", {
    signal: controller.signal,
    redirect: "manual",
  });
  await client.fetch(request);
  expect(resolve_proxy).toHaveBeenCalledWith(request.url, request.signal);
  expect(mocks.fetch).toHaveBeenCalledWith(
    request,
    expect.not.objectContaining({ redirect: expect.anything() }),
  );
  await client.fetch(request, { redirect: "follow" });
  expect(mocks.fetch).toHaveBeenLastCalledWith(
    request,
    expect.objectContaining({ redirect: "follow" }),
  );
  controller.abort(new Error("stop"));
  await expect(client.fetch(request)).rejects.toThrow("stop");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  await client.dispose();
});
