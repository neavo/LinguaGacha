import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desktop_web_fetch,
  WEB_FETCH_MAX_REDIRECTS,
  WEB_FETCH_MAX_RESPONSE_BYTES,
  WEB_FETCH_TIMEOUT_MS,
  type DesktopWebFetchRuntime,
} from "./desktop-web-fetch";

describe("desktop_web_fetch", () => {
  const fetch_mock = vi.fn();
  const resolve_host = vi.fn();
  const runtime = {
    fetch: fetch_mock,
    resolveHost: resolve_host,
  } as unknown as DesktopWebFetchRuntime;

  beforeEach(() => {
    fetch_mock.mockReset();
    resolve_host.mockReset();
    resolve_host.mockResolvedValue({ endpoints: [{ address: "93.184.216.34" }] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("使用固定 Chromium GET 选项抓取公开 URL 并返回原始字节", async () => {
    fetch_mock.mockResolvedValue(
      new Response(new Uint8Array([111, 107]), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );

    await expect(
      desktop_web_fetch(
        runtime,
        { url: "https://example.com:8443/a" },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      requestedUrl: "https://example.com:8443/a",
      url: "https://example.com:8443/a",
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: new Uint8Array([111, 107]),
    });
    expect(resolve_host).toHaveBeenCalledWith("example.com", { cacheUsage: "disallowed" });
    expect(fetch_mock).toHaveBeenCalledWith(
      "https://example.com:8443/a",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        bypassCustomProtocolHandlers: true,
        signal: expect.any(AbortSignal),
        headers: {
          Accept: expect.stringContaining("text/html"),
        },
      }),
    );
  });

  it.each([301, 302, 303, 307, 308])(
    "跟随 %i 相对重定向并逐跳重新解析 hostname",
    async (status) => {
      fetch_mock
        .mockResolvedValueOnce(
          new Response(null, { status, headers: { location: "https://next.example/b" } }),
        )
        .mockResolvedValueOnce(new Response("done", { status: 200 }));

      const result = await desktop_web_fetch(
        runtime,
        { url: "https://origin.example/a" },
        new AbortController().signal,
      );

      expect(result.url).toBe("https://next.example/b");
      expect(resolve_host.mock.calls.map(([hostname]) => hostname)).toEqual([
        "origin.example",
        "next.example",
      ]);
    },
  );

  it.each([
    [301, "缺少 Location"],
    [304, "HTTP 304"],
  ])("拒绝无效重定向响应 %i", async (status, error) => {
    fetch_mock.mockResolvedValue(new Response(null, { status }));
    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow(error);
  });

  it("拒绝超过五跳的重定向", async () => {
    fetch_mock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/again" } }),
    );
    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow(`超过 ${WEB_FETCH_MAX_REDIRECTS.toString()} 次`);
  });

  it("非 2xx 只暴露状态码且不读取错误正文", async () => {
    const get_reader = vi.fn();
    const cancel = vi.fn(async () => undefined);
    fetch_mock.mockResolvedValue({
      status: 500,
      headers: new Headers(),
      body: { getReader: get_reader, cancel },
    });

    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow("HTTP 500");
    expect(get_reader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    "file:///etc/passwd",
    "data:text/plain,hello",
    "https://user:secret@example.com/",
    "https://localhost/",
    "https://api.local/",
    "https://metadata.google.internal/",
  ])("拒绝非公开 URL：%s", async (url) => {
    await expect(
      desktop_web_fetch(runtime, { url }, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("拒绝受限 IP literal：%s", async (url) => {
    await expect(desktop_web_fetch(runtime, { url }, new AbortController().signal)).rejects.toThrow(
      "受限地址",
    );
    expect(resolve_host).not.toHaveBeenCalled();
  });

  it("DNS 任一 endpoint 受限时拒绝混合结果", async () => {
    resolve_host.mockResolvedValue({
      endpoints: [{ address: "93.184.216.34" }, { address: "192.168.1.1" }],
    });

    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow("受限地址");
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it("DNS 失败或没有 endpoint 时拒绝请求", async () => {
    resolve_host.mockRejectedValueOnce(new Error("dns failed"));
    await expect(
      desktop_web_fetch(runtime, { url: "https://one.example" }, new AbortController().signal),
    ).rejects.toThrow("无法解析");

    resolve_host.mockResolvedValueOnce({ endpoints: [] });
    await expect(
      desktop_web_fetch(runtime, { url: "https://two.example" }, new AbortController().signal),
    ).rejects.toThrow("没有可用地址");
  });

  it("Content-Length 超限时在读取前取消响应", async () => {
    const get_reader = vi.fn();
    const cancel = vi.fn(async () => undefined);
    fetch_mock.mockResolvedValue({
      status: 200,
      headers: new Headers({
        "content-length": (WEB_FETCH_MAX_RESPONSE_BYTES + 1).toString(),
      }),
      body: { getReader: get_reader, cancel },
    });

    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow("2 MiB");
    expect(get_reader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("实际响应流超限时立即取消 reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(WEB_FETCH_MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    fetch_mock.mockResolvedValue(new Response(stream, { status: 200 }));

    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).rejects.toThrow("2 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("调用方取消会中止挂起的响应体读取", async () => {
    const cancel = vi.fn();
    fetch_mock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel,
        }),
        { status: 200 },
      ),
    );
    const controller = new AbortController();
    const reason = new Error("用户取消");
    const request = desktop_web_fetch(runtime, { url: "https://example.com" }, controller.signal);
    await vi.waitFor(() => expect(fetch_mock).toHaveBeenCalledOnce());

    controller.abort(reason);

    await expect(request).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("调用方取消会结束挂起的 hostname 解析等待", async () => {
    resolve_host.mockReturnValue(new Promise<never>(() => undefined));
    const controller = new AbortController();
    const reason = new Error("解析期间取消");
    const request = desktop_web_fetch(runtime, { url: "https://example.com" }, controller.signal);
    const rejection = expect(request).rejects.toBe(reason);
    await vi.waitFor(() => expect(resolve_host).toHaveBeenCalledOnce());

    controller.abort(reason);

    await rejection;
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it("固定超时会中止 fetch", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("超时", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    fetch_mock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const request = desktop_web_fetch(
      runtime,
      { url: "https://example.com" },
      new AbortController().signal,
    );
    const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(WEB_FETCH_TIMEOUT_MS);

    await rejection;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(WEB_FETCH_TIMEOUT_MS);
  });

  it("空响应体返回空 Uint8Array", async () => {
    fetch_mock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      desktop_web_fetch(runtime, { url: "https://example.com" }, new AbortController().signal),
    ).resolves.toMatchObject({ body: new Uint8Array() });
  });
});
