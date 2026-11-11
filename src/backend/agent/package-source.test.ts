import { expect, it, vi } from "vitest";
import { AgentPackageSources } from "./package-source";

const IPIP = (location: string) => `当前 IP：203.0.113.1  来自于：${location}\n`;
type Reply = string | Error | Response;

/** 按地址返回固定响应，`Error` 表示网络或超时失败。 */
function create_sources(replies: Readonly<{ ipip: Reply; ipwho: Reply }>) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const reply = String(url).includes("ipip") ? replies.ipip : replies.ipwho;
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : new Response(reply);
  });
  const log = vi.fn();
  return { sources: new AgentPackageSources({ log, fetch }), fetch, log };
}

it.each([
  [
    "两路都在大陆以外",
    IPIP("美国 加利福尼亚州"),
    JSON.stringify({ success: true, country_code: "JP" }),
    "official",
  ],
  [
    "IPIP 港澳台归大陆以外",
    IPIP("中国 香港"),
    JSON.stringify({ success: true, country_code: "HK" }),
    "official",
  ],
  [
    "IPIP 失败时采用另一路有效结果",
    new Error("timeout"),
    JSON.stringify({ success: true, country_code: "US" }),
    "official",
  ],
  [
    "ipwho 业务失败时采用另一路",
    IPIP("新加坡"),
    JSON.stringify({ success: false, message: "limit" }),
    "official",
  ],
  [
    "任一路大陆即选镜像",
    IPIP("中国 湖北 武汉  电信"),
    JSON.stringify({ success: true, country_code: "US" }),
    "mirror",
  ],
  [
    "ipwho 报告大陆",
    IPIP("日本 东京"),
    JSON.stringify({ success: true, country_code: "CN" }),
    "mirror",
  ],
  ["两路都未知", new Error("offline"), new Response("busy", { status: 429 }), "mirror"],
  [
    "无法识别的文本与代码不算海外",
    "blocked",
    JSON.stringify({ success: true, country_code: "XX" }),
    "mirror",
  ],
  ["未知国家名不算海外", IPIP("火星 基地"), "not json", "mirror"],
  [
    "未知地区代码不算海外",
    "blocked",
    JSON.stringify({ success: true, country_code: "ZZ" }),
    "mirror",
  ],
] as const)("%s", async (_name, ipip, ipwho, expected) => {
  const { sources, log } = create_sources({ ipip, ipwho });
  await expect(sources.resolve("chat", new AbortController().signal)).resolves.toBe(expected);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]![0]).not.toContain("203.0.113.1"); // 日志不记录公网地址
});

it("同一对话并发与后续调用共用一次查询，其他对话独立判定，重置后重新查询", async () => {
  const { sources, fetch } = create_sources({
    ipip: IPIP("中国 北京"),
    ipwho: JSON.stringify({ success: true, country_code: "CN" }),
  });
  const signal = new AbortController().signal;
  await Promise.all([sources.resolve("a", signal), sources.resolve("a", signal)]);
  await sources.resolve("a", signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  await sources.resolve("b", signal);
  expect(fetch).toHaveBeenCalledTimes(4);
  sources.forget("a");
  await sources.resolve("a", signal);
  expect(fetch).toHaveBeenCalledTimes(6);
});

it("执行取消向上传播且不缓存，迟到的取消不移除较新的查询；关闭后拒绝查询", async () => {
  const { sources, fetch } = create_sources({
    ipip: IPIP("美国"),
    ipwho: JSON.stringify({ success: true, country_code: "US" }),
  });
  const pending = Promise.withResolvers<Response>();
  fetch.mockImplementationOnce(async (_url, init) => {
    init?.signal?.addEventListener("abort", () => pending.reject(init.signal?.reason));
    return await pending.promise;
  });
  const controller = new AbortController();
  const stopped = new Error("stop");
  const cancelled = sources.resolve("a", controller.signal);
  sources.forget("a"); // 重置期间旧查询仍在途
  const newer = sources.resolve("a", new AbortController().signal);
  controller.abort(stopped);
  await expect(cancelled).rejects.toBe(stopped);
  await expect(newer).resolves.toBe("official");
  await expect(sources.resolve("a", new AbortController().signal)).resolves.toBe("official");
  expect(fetch).toHaveBeenCalledTimes(4); // 较新的结果仍被复用

  sources.close();
  await expect(sources.resolve("c", new AbortController().signal)).rejects.toThrow("closed");
});
