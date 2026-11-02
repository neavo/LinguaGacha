import { createServer } from "node:http";
import { Agent, Dispatcher, ProxyAgent, Socks5ProxyAgent, fetch, Request } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { ProxyDispatcher } from "./proxy-dispatcher";
import { listen } from "./proxy-test-support";
import type { ProxyResolver } from "./proxy-route";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 登记调度器，失败用例也通过强制销毁回收传输。 */
function dispatcher(resolveProxy: ProxyResolver["resolveProxy"] = async () => "DIRECT") {
  const value = new ProxyDispatcher({ resolveProxy });
  cleanups.push(() => value.destroy());
  return value;
}

it("逐次查询完整路径并复用同一路由的代理池", async () => {
  const received: string[] = [];
  const root = await listen(
    createServer((request, response) => {
      received.push(request.url!);
      response.end("proxied");
    }),
    cleanups,
  );
  const resolveProxy = vi.fn(async (_url: string) => `PROXY ${new URL(root).host}`);
  const transport = dispatcher(resolveProxy);
  const dispatch = vi.spyOn(ProxyAgent.prototype, "dispatch");
  for (const path of ["//other.invalid/path?q=1", "/next?q=2"]) {
    expect(
      await (await fetch(`http://remote.invalid${path}`, { dispatcher: transport })).text(),
    ).toBe("proxied");
  }
  expect(resolveProxy.mock.calls.map(([url]) => url)).toEqual([
    "http://remote.invalid//other.invalid/path?q=1",
    "http://remote.invalid/next?q=2",
  ]);
  expect(received).toEqual(resolveProxy.mock.calls.map(([url]) => url));
  expect(dispatch.mock.instances).toHaveLength(2);
  expect(dispatch.mock.instances[0]).toBe(dispatch.mock.instances[1]);
});

it.each(["resolve", "reject"] as const)(
  "解析器忽略取消后迟到 %s，只结算一次且不创建代理池",
  async (outcome) => {
    const started = Promise.withResolvers<void>();
    const route = Promise.withResolvers<string>();
    let signal: AbortSignal | undefined;
    const transport = dispatcher(async (_url, waiting) => {
      signal = waiting;
      started.resolve();
      return await route.promise;
    });
    const dispatch = vi.spyOn(ProxyAgent.prototype, "dispatch");
    const close = vi.spyOn(ProxyAgent.prototype, "close");
    const abort = new AbortController();
    const reason = new Error("caller cancelled");
    const pending = fetch(new Request("http://remote.invalid/pending", { signal: abort.signal }), {
      dispatcher: transport,
    });
    const rejected = expect(pending).rejects.toBe(reason);
    await started.promise;
    abort.abort(reason);
    await rejected;
    expect(signal?.aborted).toBe(true);
    if (outcome === "resolve") route.resolve("PROXY 127.0.0.1:1");
    else route.reject(new Error("late host failure"));
    await route.promise.catch(() => undefined); // 消费手动控制的源 Promise，派发链自身也必须处理迟到拒绝。
    await transport.close();
    expect(dispatch).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  },
);

it.each(["close", "destroy"] as const)(
  "%s 及时取消未完成的解析，迟到路由与新请求均不能建池",
  async (operation) => {
    const started = Promise.withResolvers<void>();
    const route = Promise.withResolvers<string>();
    const resolveProxy = vi.fn(async (_url: string, _signal?: AbortSignal) => {
      started.resolve();
      return await route.promise;
    });
    const transport = dispatcher(resolveProxy);
    const close = vi.spyOn(ProxyAgent.prototype, "close");
    const destroy = vi.spyOn(ProxyAgent.prototype, "destroy");
    const pending = fetch("http://remote.invalid/pending", { dispatcher: transport });
    const rejected = expect(pending).rejects.toMatchObject({
      cause: { code: operation === "close" ? "UND_ERR_CLOSED" : "UND_ERR_DESTROYED" },
    });
    await started.promise;
    const closing = transport[operation]();
    expect(transport[operation]()).toBe(closing);
    await closing;
    await rejected;
    expect(resolveProxy.mock.calls[0]![1]?.aborted).toBe(true);
    route.resolve("PROXY 127.0.0.1:1");
    await route.promise;
    await expect(fetch("http://remote.invalid/new", { dispatcher: transport })).rejects.toThrow();
    await transport.destroy();
    expect(resolveProxy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  },
);

it("稳定控制器保持开始次数、this、背压和取消交接", async () => {
  const route = Promise.withResolvers<string>();
  const transport = dispatcher(async () => await route.promise);
  const handed = Promise.withResolvers<void>();
  let downstream: Dispatcher.DispatchHandler | undefined;
  const rawHeaders = ["X-Test", "raw"];
  const next: Dispatcher.DispatchController = {
    aborted: false,
    paused: false,
    reason: null,
    rawHeaders,
    abort: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  vi.spyOn(Agent.prototype, "dispatch").mockImplementation((_options, handler) => {
    downstream = handler;
    handler.onRequestStart?.(next, { connected: true });
    handed.resolve();
    return true;
  });
  let controller: Dispatcher.DispatchController | undefined;
  const handler: Dispatcher.DispatchHandler = {
    onRequestStart: vi.fn(function (this: Dispatcher.DispatchHandler, value) {
      expect(this).toBe(handler);
      controller = value;
      value.pause();
    }),
    onResponseStart: vi.fn(function (this: Dispatcher.DispatchHandler, value) {
      expect(this).toBe(handler);
      expect(value).toBe(controller);
      expect(value.rawHeaders).toBe(rawHeaders);
    }),
    onResponseError: vi.fn(),
  };
  expect(
    transport.dispatch({ origin: "http://remote.invalid", path: "/", method: "GET" }, handler),
  ).toBe(true);
  expect(controller?.paused).toBe(true);
  route.resolve("DIRECT");
  await handed.promise;
  expect(handler.onRequestStart).toHaveBeenCalledOnce();
  expect(next.pause).toHaveBeenCalledOnce();
  downstream!.onResponseStart?.(next, 200, {});
  controller!.resume();
  expect(next.resume).toHaveBeenCalledOnce();
  const reason = new Error("stop transfer");
  controller!.abort(reason);
  controller!.abort(reason);
  expect(next.abort).toHaveBeenCalledExactlyOnceWith(reason);
  downstream!.onResponseError?.(next, reason);
  downstream!.onResponseError?.(next, reason);
  expect(handler.onResponseError).toHaveBeenCalledExactlyOnceWith(controller, reason);
});

it("有序关闭等待响应流结束，并拒绝关闭后的新派发", async () => {
  const tail = Promise.withResolvers<void>();
  const root = await listen(
    createServer((_request, response) => {
      response.write("head");
      void tail.promise.then(() => response.end("tail"));
    }),
    cleanups,
  );
  const transport = dispatcher();
  const response = await fetch(root, { dispatcher: transport });
  let closed = false;
  const closing = transport.close().then(() => {
    closed = true;
  });
  await expect(fetch(root, { dispatcher: transport })).rejects.toThrow();
  expect(closed).toBe(false);
  tail.resolve();
  expect(await response.text()).toBe("headtail");
  await closing;
  expect(closed).toBe(true);
});

it("关闭期间可升级销毁，中断已收到响应头的传输", async () => {
  const root = await listen(
    createServer((_request, response) => response.write("head")),
    cleanups,
  );
  const transport = dispatcher();
  const response = await fetch(root, { dispatcher: transport });
  const body = expect(response.text()).rejects.toMatchObject({
    cause: { message: "force release" },
  });
  const pool_closing = Promise.withResolvers<void>();
  const close: (callback: () => void) => void = Agent.prototype.close;
  vi.spyOn(Agent.prototype, "close").mockImplementation(function (this: Agent) {
    const result = new Promise<void>((resolve) => close.call(this, resolve));
    pool_closing.resolve();
    return result;
  });
  let closed = false;
  const closing = transport.close().then(() => {
    closed = true;
  });
  await pool_closing.promise;
  const reason = new Error("force release");
  const destroyed = new Promise<void>((resolve, reject) =>
    transport.destroy(reason, (error) => (error ? reject(error) : resolve())),
  );
  await destroyed;
  expect(closed).toBe(true);
  await Promise.all([closing, body]);
});

it("所有池都尝试关闭，回调与重复调用保留聚合失败的原始原因", async () => {
  const transport = new ProxyDispatcher({
    resolveProxy: async (url) =>
      url.endsWith("/http") ? "PROXY 127.0.0.1:1" : "SOCKS5 127.0.0.1:2",
  });
  const started = Promise.withResolvers<void>();
  let dispatches = 0;
  // 两个代理池完成交接后才触发关闭，避免测试依赖微任务执行次数。
  const accept = (_options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
    handler.onRequestStart?.(
      { aborted: false, paused: false, reason: null, abort() {}, pause() {}, resume() {} },
      {},
    );
    if (++dispatches === 2) started.resolve();
    return true;
  };
  vi.spyOn(ProxyAgent.prototype, "dispatch").mockImplementation(accept);
  vi.spyOn(Socks5ProxyAgent.prototype, "dispatch").mockImplementation(accept);
  transport.dispatch({ origin: "http://remote.invalid", path: "/http", method: "GET" }, {});
  transport.dispatch({ origin: "http://remote.invalid", path: "/socks", method: "GET" }, {});
  await started.promise;
  const failure = new Error("direct close failed");
  const direct = vi.spyOn(Agent.prototype, "close").mockImplementation(() => {
    throw failure;
  });
  const http = vi.spyOn(ProxyAgent.prototype, "close").mockImplementation(() => Promise.resolve());
  const socks = vi
    .spyOn(Socks5ProxyAgent.prototype, "close")
    .mockImplementation(() => Promise.resolve());
  const result = transport.close();
  expect(transport.close()).toBe(result);
  const callback = new Promise<Error | null | undefined>((resolve) => transport.close(resolve));
  await expect(result).rejects.toMatchObject({ errors: [failure] });
  expect(await callback).toBe(await result.catch((error: unknown) => error));
  expect(direct).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledOnce();
  expect(socks).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
  await expect(transport.destroy()).rejects.toMatchObject({ errors: [await callback] });
});

it("代理连接失败保留原因且不尝试后续 DIRECT", async () => {
  const broken = createServer((_request, response) =>
    response.destroy(new Error("proxy disconnected")),
  );
  const root = await listen(broken, cleanups);
  const transport = dispatcher(async () => `PROXY ${new URL(root).host}; DIRECT`);
  const error = await fetch("http://remote.invalid/", { dispatcher: transport }).catch(
    (error: unknown) => error,
  );
  expect(error).toMatchObject({ cause: { code: "UND_ERR_SOCKET" } });
});
