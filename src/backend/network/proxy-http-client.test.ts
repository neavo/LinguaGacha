import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { Request, Response, Headers, FormData } from "undici";
import { ProxyHttpClient } from "./proxy-http-client";
import { with_http_response_info } from "./http-response-info";
import { to_log_error } from "../../shared/error/log-error";
import { listen } from "./proxy-test-support";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 登记客户端，测试结束时统一恢复全局入口并关闭连接池。 */
function client(
  resolveProxy = async (_url: string) => "DIRECT",
  redirects: "error" | "request" = "error",
) {
  const value = new ProxyHttpClient({ resolveProxy }, { redirects });
  cleanups.push(() => value.dispose());
  return value;
}

it("每次跳转按完整目标重新选路，同 origin 切换代理后回到回环直连", async () => {
  const received: string[] = [];
  const end = await listen(
    createServer((request, response) => {
      received.push(`end:${request.url}`);
      response.end("finished");
    }),
    cleanups,
  );
  const proxy_b = await listen(
    createServer((request, response) => {
      received.push(`B:${request.url}`);
      response.writeHead(302, { location: `${end}/end` }).end();
    }),
    cleanups,
  );
  const proxy_a = await listen(
    createServer((request, response) => {
      received.push(`A:${request.url}`);
      response.writeHead(302, { location: "http://remote.invalid/b?step=2" }).end();
    }),
    cleanups,
  );
  const start = await listen(
    createServer((request, response) => {
      received.push(`start:${request.url}`);
      response.writeHead(302, { location: "http://remote.invalid/a?step=1" }).end();
    }),
    cleanups,
  );
  const resolveProxy = vi.fn(
    async (url: string) => `PROXY ${new URL(url.includes("/a?") ? proxy_a : proxy_b).host}`,
  );
  const transport = client(resolveProxy, "request");
  const response = await transport.fetch(`${start}/start`, { signal: AbortSignal.timeout(2000) });
  expect(await response.text()).toBe("finished");
  expect(response.url).toBe(`${end}/end`);
  expect(resolveProxy.mock.calls.map(([url]) => url)).toEqual([
    "http://remote.invalid/a?step=1",
    "http://remote.invalid/b?step=2",
  ]);
  expect(received).toEqual([
    "start:/start",
    "A:http://remote.invalid/a?step=1",
    "B:http://remote.invalid/b?step=2",
    "end:/end",
  ]);
});

it("关闭先结束代理等待，迟到路由不能再发送请求", async () => {
  const received = vi.fn();
  const proxy = await listen(
    createServer((request, response) => {
      received(request.url);
      response.end("late request");
    }),
    cleanups,
  );
  const started = Promise.withResolvers<void>();
  const route = Promise.withResolvers<string>();
  const transport = client(async () => {
    started.resolve();
    return await route.promise;
  });
  const pending = transport.fetch("http://remote.invalid/late");
  const result = pending.then(
    () => "sent",
    () => "cancelled",
  );
  await started.promise;
  await transport.dispose();
  route.resolve(`PROXY ${new URL(proxy).host}`);
  expect(await result).toBe("cancelled");
  expect(received).not.toHaveBeenCalled();
});

it("安装和关闭统一恢复 fetch 及同版本构造器", async () => {
  const original = {
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    FormData: globalThis.FormData,
  };
  const transport = client();
  transport.install_as_global_fetch();
  expect(globalThis).toMatchObject({
    fetch: transport.fetch,
    Request,
    Response,
    Headers,
    FormData,
  });
  expect(() => transport.install_as_global_fetch()).toThrow();
  const closing = transport.dispose();
  expect(transport.dispose()).toBe(closing);
  await closing;
  expect(globalThis).toMatchObject(original);
  await expect(transport.fetch("http://remote.invalid")).rejects.toThrow();
});

it("后端禁止跳转，工作区遵循 Request 和调用选项", async () => {
  const received: string[] = [];
  const root = await listen(
    createServer((request, response) => {
      received.push(request.url!);
      if (request.url === "/redirect") response.writeHead(302, { location: "/end" }).end();
      else response.end("ok");
    }),
    cleanups,
  );
  await expect(client().fetch(`${root}/redirect`, { redirect: "follow" })).rejects.toThrow();
  const transport = client(undefined, "request");
  const request = new Request(`${root}/redirect`, { redirect: "manual" });
  const manual = await transport.fetch(request as unknown as globalThis.Request);
  expect(manual.status).toBe(302);
  await manual.text();
  expect(
    await (
      await transport.fetch(request as unknown as globalThis.Request, { redirect: "follow" })
    ).text(),
  ).toBe("ok");
  await expect(transport.fetch(`${root}/redirect`, { redirect: "error" })).rejects.toThrow();
  expect(received).toEqual(["/redirect", "/redirect", "/redirect", "/end", "/redirect"]);
});

it("真实响应保留状态、重试时间和解压后的响应流", async () => {
  const root = await listen(
    createServer((_request, response) => {
      response.writeHead(429, { "Retry-After": "90", "Content-Encoding": "gzip" });
      response.end(gzipSync("limited"));
    }),
    cleanups,
  );
  const transport = client();
  const result = await with_http_response_info(async () => ({
    body: await (await transport.fetch(root)).text(),
  }));
  expect(result).toMatchObject({
    body: "limited",
    http_status: 429,
    retry_after_ms: 90_000,
    http_received_at: expect.any(Number),
  });
});

it("路由失败通过 fetch cause 和日志快照保留原始原因", async () => {
  const cause = new Error("host resolver failed");
  const transport = client(async () => {
    throw cause;
  });
  const error = await transport.fetch("http://remote.invalid").catch((error: unknown) => error);
  expect(error).toHaveProperty("cause", cause);
  expect(to_log_error(error)).toMatchObject({
    cause_chain: [expect.objectContaining({ message: cause.message })],
  });
});
