import dns from "node:dns";

import { Agent, ProxyAgent, Socks5ProxyAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agent_options: [] as unknown[],
  fetch: vi.fn<typeof import("undici").fetch>(),
}));

vi.mock("undici", async (import_original) => {
  const original = await import_original<typeof import("undici")>();
  return {
    ...original,
    // 保留真实 Agent 行为，仅记录构造参数以验证 socket lookup 边界。
    Agent: class Agent extends original.Agent {
      public constructor(options?: import("undici").Agent.Options) {
        super(options);
        mocks.agent_options.push(options);
      }
    },
    fetch: mocks.fetch,
  };
});

import { create_agent_web_fetch as create_agent_web_fetch_with_resolver } from "./agent-web-fetch";

function create_agent_web_fetch(
  resolve_proxy: (url: string, signal: AbortSignal) => Promise<string>,
) {
  return create_agent_web_fetch_with_resolver({
    resolveProxy: (url, signal) => resolve_proxy(url, signal ?? new AbortController().signal),
  });
}

describe("Agent web_fetch 下载边界", () => {
  beforeEach(() => {
    mocks.agent_options.length = 0;
    mocks.fetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("直连通过受控 Undici dispatcher 返回有限原始字节", async () => {
    const response = fake_response(200, "正文", { "content-type": "text/plain" });
    mocks.fetch.mockResolvedValue(response.value);
    const resolve_proxy = vi.fn(async (_url: string, _signal: AbortSignal) => "DIRECT");

    await expect(
      create_agent_web_fetch(resolve_proxy)(
        "https://example.com/article",
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      url: "https://example.com/article",
      contentType: "text/plain",
      body: new TextEncoder().encode("正文"),
    });

    expect(resolve_proxy).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.any(AbortSignal),
    );
    const [url, options] = mocks.fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe("https://example.com/article");
    expect(options).toMatchObject({
      dispatcher: expect.any(Agent),
      method: "GET",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ["PROXY 127.0.0.1:7890", ProxyAgent],
    ["SOCKS5 127.0.0.1:1080", Socks5ProxyAgent],
  ])("系统代理规则 %s 选择对应 dispatcher", async (rule, DispatcherType) => {
    mocks.fetch.mockResolvedValue(fake_response(200, "ok").value);
    const fetch = create_agent_web_fetch(async () => rule);

    await fetch("https://example.com", new AbortController().signal);

    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: expect.any(DispatcherType),
    });
  });

  it("相对重定向逐跳重新解析代理，最终 HTTP 状态进入稳定错误", async () => {
    const redirect = fake_response(302, "", { location: "/missing" });
    const missing = fake_response(404, "not found");
    mocks.fetch.mockResolvedValueOnce(redirect.value).mockResolvedValueOnce(missing.value);
    const resolve_proxy = vi.fn(async (_url: string, _signal: AbortSignal) => "DIRECT");

    await expect(
      create_agent_web_fetch(resolve_proxy)(
        "https://example.com/start",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      details: {
        code: "web_fetch.http_error",
        status: 404,
        url: "https://example.com/missing",
      },
    });
    expect(resolve_proxy.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/start",
      "https://example.com/missing",
    ]);
  });

  it("拒绝缺失 Location 的重定向", async () => {
    mocks.fetch.mockResolvedValue(fake_response(302, "").value);
    const fetch = create_agent_web_fetch(async () => "DIRECT");

    await expect(fetch("https://example.com", new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_fetch.invalid_redirect", status: 302 },
    });
  });

  it("拒绝超过上限的重定向", async () => {
    const fetch = create_agent_web_fetch(async () => "DIRECT");

    mocks.fetch.mockResolvedValue(fake_response(302, "", { location: "/again" }).value);
    await expect(fetch("https://example.com", new AbortController().signal)).rejects.toMatchObject({
      details: { code: "web_fetch.too_many_redirects" },
    });
  });

  it.each([
    ["file:///etc/passwd", "web_fetch.invalid_url"],
    ["data:text/plain,hello", "web_fetch.invalid_url"],
    ["https://user:secret@example.com/", "web_fetch.invalid_url"],
    ["https://localhost/", "web_fetch.restricted_url"],
    ["https://api.local/", "web_fetch.restricted_url"],
    ["https://metadata.google.internal/", "web_fetch.restricted_url"],
    ["http://127.0.0.1/", "web_fetch.restricted_url"],
    ["http://10.0.0.1/", "web_fetch.restricted_url"],
    ["http://192.168.1.1/", "web_fetch.restricted_url"],
    ["http://[::1]/", "web_fetch.restricted_url"],
    ["http://[fc00::1]/", "web_fetch.restricted_url"],
    ["http://[::ffff:127.0.0.1]/", "web_fetch.restricted_url"],
  ])("请求前拒绝非公开 URL：%s", async (url, code) => {
    const resolve_proxy = vi.fn(async () => "DIRECT");
    await expect(
      create_agent_web_fetch(resolve_proxy)(url, new AbortController().signal),
    ).rejects.toMatchObject({ details: { code } });
    expect(resolve_proxy).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("socket lookup 只把公网地址交给实际连接", async () => {
    set_dns_addresses([
      { address: "192.168.1.1", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    mocks.fetch.mockResolvedValue(fake_response(200, "ok").value);
    await create_agent_web_fetch(async () => "DIRECT")(
      "https://example.com",
      new AbortController().signal,
    );

    await expect(run_lookup(read_public_lookup(), true)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it("socket lookup 没有公网地址时拒绝连接", async () => {
    set_dns_addresses([
      { address: "192.168.1.1", family: 4 },
      { address: "fc00::1", family: 6 },
    ]);
    mocks.fetch.mockResolvedValue(fake_response(200, "ok").value);
    await create_agent_web_fetch(async () => "DIRECT")(
      "https://example.com",
      new AbortController().signal,
    );

    await expect(run_lookup(read_public_lookup(), false)).rejects.toMatchObject({
      details: { code: "web_fetch.restricted_url", url: "https://example.com/" },
    });
  });

  it("解压后的响应正文超过字节上限时拒绝结果", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel,
    });
    mocks.fetch.mockResolvedValue(new Response(body) as never);

    await expect(
      create_agent_web_fetch(async () => "DIRECT")(
        "https://example.com",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      details: { code: "web_fetch.response_too_large", url: "https://example.com/" },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("调用前取消不解析代理或发起请求", async () => {
    const resolve_proxy = vi.fn(async () => "DIRECT");
    const controller = new AbortController();
    const reason = new Error("用户取消");
    controller.abort(reason);

    await expect(
      create_agent_web_fetch(resolve_proxy)("https://example.com", controller.signal),
    ).rejects.toBe(reason);
    expect(resolve_proxy).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("固定总超时会中止挂起的网络请求", async () => {
    vi.useFakeTimers();
    let timeout_ms = 0;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      timeout_ms = milliseconds;
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("超时", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    mocks.fetch.mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
    });
    const pending = create_agent_web_fetch(async () => "DIRECT")(
      "https://example.com",
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(timeout_ms);

    await rejection;
  });
});

function fake_response(status_code: number, content: string, headers: Record<string, string> = {}) {
  const value = new Response(content, { status: status_code, headers });
  return { value: value as never };
}

function run_lookup(
  lookup: NonNullable<import("node:net").TcpNetConnectOpts["lookup"]>,
  all: boolean,
): Promise<string | import("node:dns").LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup("example.com", { all }, (error, address) => {
      if (error !== null) reject(error);
      else resolve(address);
    });
  });
}

function set_dns_addresses(addresses: import("node:dns").LookupAddress[]): void {
  vi.spyOn(dns, "lookup").mockImplementation((...arguments_: unknown[]) => {
    const callback = arguments_.at(-1) as (
      error: NodeJS.ErrnoException | null,
      result: import("node:dns").LookupAddress[],
    ) => void;
    callback(null, addresses);
  });
}

function read_public_lookup(): NonNullable<import("node:net").TcpNetConnectOpts["lookup"]> {
  const options = mocks.agent_options.at(-1) as
    | { connect?: { lookup?: NonNullable<import("node:net").TcpNetConnectOpts["lookup"]> } }
    | undefined;
  const lookup = options?.connect?.lookup;
  if (lookup === undefined) throw new Error("直连 dispatcher 缺少受控 lookup。");
  return lookup;
}
