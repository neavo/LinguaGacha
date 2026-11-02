import { expect, it, vi } from "vitest";
import { parse_proxy_route, resolve_proxy_route } from "./proxy-route";

it.each([
  ["DIRECT", { kind: "direct" }],
  ["PROXY 127.0.0.1:7890; DIRECT", { kind: "proxy", uri: "http://127.0.0.1:7890/" }],
  ["HTTPS proxy.example:443", { kind: "proxy", uri: "https://proxy.example/" }],
  ["SOCKS5 localhost:1080", { kind: "socks5", uri: "socks5://localhost:1080" }],
  ["SOCKS localhost:1080", { kind: "socks5", uri: "socks5://localhost:1080" }],
  ["SOCKS4 old:1080; PROXY; HTTPS :::; DIRECT", { kind: "direct" }],
])("按候选顺序解析 %s", (rules, expected) => {
  expect(parse_proxy_route(rules)).toEqual(expected);
});

it.each(["", "SOCKS4 old:1080", "PROXY :::; HTTPS"])("无可用候选时失败：%s", (rules) => {
  expect(() => parse_proxy_route(rules)).toThrow();
});

it.each(["localhost", "[::1]", "127.0.0.1", "127.45.67.89"])("回环 %s 固定直连", async (host) => {
  const resolveProxy = vi.fn();
  expect(await resolve_proxy_route({ resolveProxy }, `http://${host}:8080/path`)).toEqual({
    kind: "direct",
  });
  expect(resolveProxy).not.toHaveBeenCalled();
});

it("每次远端解析都传递完整地址与取消信号，保留宿主错误", async () => {
  const failure = new Error("host failed");
  const resolveProxy = vi.fn().mockResolvedValueOnce("DIRECT").mockRejectedValueOnce(failure);
  const signal = new AbortController().signal;
  const url = "https://remote.invalid//path?q=1";
  expect(await resolve_proxy_route({ resolveProxy }, url, signal)).toEqual({ kind: "direct" });
  await expect(resolve_proxy_route({ resolveProxy }, url, signal)).rejects.toBe(failure);
  expect(resolveProxy.mock.calls).toEqual([
    [url, signal],
    [url, signal],
  ]);
});
