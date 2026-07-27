import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxyAgent, getGlobalDispatcher, type Dispatcher } from "undici";

import {
  EMPTY_SYSTEM_PROXY_STARTUP_NOTICE,
  build_system_proxy_startup_notice,
  collect_system_proxy_urls,
  install_system_proxy_dispatcher,
  install_system_proxy_dispatcher_from_snapshot,
  parse_system_proxy_route,
} from "./llm-system-proxy-dispatcher";

describe("llm-system-proxy-dispatcher", () => {
  const original_dispatcher = getGlobalDispatcher(); // 用于确认测试后全局 dispatcher 被恢复
  const installed_disposers: Array<() => Promise<void>> = []; // 收尾失败测试中的代理安装

  afterEach(async () => {
    while (installed_disposers.length > 0) {
      const dispose = installed_disposers.pop();
      if (dispose !== undefined) {
        await dispose();
      }
    }
    expect(getGlobalDispatcher()).toBe(original_dispatcher);
  });

  it("按当前模型配置、内置预设和 provider 默认地址收集远端代理 URL", () => {
    const urls = collect_system_proxy_urls([
      {
        api_format: "Anthropic",
        api_url: "https://api.anthropic.com",
      },
      {
        api_format: "OpenAI",
        api_url: "https://api.openai.com/v1",
      },
      {
        api_format: "OpenAI",
        api_url: "https://api.example/v1/chat/completions",
      },
      {
        api_format: "SakuraLLM",
        api_url: "http://127.0.0.1:8080",
      },
      {
        api_format: "Google",
        api_url: "",
      },
    ]);

    expect(urls).toEqual([
      "https://api.anthropic.com",
      "https://api.openai.com/v1",
      "https://api.example/v1",
      "https://generativelanguage.googleapis.com",
    ]);
  });

  it("解析 Chromium resolveProxy 返回的首个可支持路由", () => {
    expect(parse_system_proxy_route("DIRECT")).toEqual({ kind: "direct" });
    expect(parse_system_proxy_route("PROXY 127.0.0.1:7890; DIRECT")).toEqual({
      kind: "proxy",
      uri: "http://127.0.0.1:7890/",
    });
    expect(parse_system_proxy_route("HTTPS proxy.example:443")).toEqual({
      kind: "proxy",
      uri: "https://proxy.example/",
    });
    expect(parse_system_proxy_route("SOCKS localhost:1080")).toEqual({
      kind: "socks5",
      uri: "socks5://localhost:1080",
    });
    expect(parse_system_proxy_route("UNKNOWN value")).toEqual({ kind: "direct" });
  });

  it("启动期只解析每个远端 origin 一次，并在释放时恢复原 dispatcher", async () => {
    const resolved_urls: string[] = [];
    const installation = await install_system_proxy_dispatcher({
      urls: ["https://api.example/v1/models", "https://api.example/v1/chat/completions"],
      resolver: {
        resolveProxy: async (url) => {
          resolved_urls.push(url);
          return "PROXY 127.0.0.1:7890";
        },
      },
    });
    installed_disposers.push(installation.dispose);

    expect(resolved_urls).toEqual(["https://api.example/v1/models"]);
    expect(installation.snapshot.routes).toEqual({
      "https://api.example": {
        kind: "proxy",
        uri: "http://127.0.0.1:7890/",
      },
    });
    expect(getGlobalDispatcher()).not.toBe(original_dispatcher);

    await installation.dispose();
    installed_disposers.pop();

    expect(getGlobalDispatcher()).toBe(original_dispatcher);
  });

  it("DIRECT 快照不替换当前线程全局 dispatcher", async () => {
    const installation = install_system_proxy_dispatcher_from_snapshot({
      routes: {
        "https://api.example": { kind: "direct" },
      },
    });
    installed_disposers.push(installation.dispose);

    expect(getGlobalDispatcher()).toBe(original_dispatcher);
    expect(installation.snapshot.routes["https://api.example"]).toEqual({ kind: "direct" });
  });

  it("系统代理单项解析失败时降级 DIRECT，并保留其它代理命中", async () => {
    const installation = await install_system_proxy_dispatcher({
      urls: ["https://bad.example/v1", "https://good.example/v1"],
      resolver: {
        resolveProxy: async (url) => {
          if (url.includes("bad.example")) {
            throw new Error("resolve failed");
          }
          return "PROXY 127.0.0.1:7890";
        },
      },
    });
    installed_disposers.push(installation.dispose);

    expect(installation.snapshot.routes).toEqual({
      "https://bad.example": { kind: "direct" },
      "https://good.example": {
        kind: "proxy",
        uri: "http://127.0.0.1:7890/",
      },
    });
    expect(getGlobalDispatcher()).not.toBe(original_dispatcher);
  });

  it("单个代理池快速关闭失败时仍等待其它代理池释放完毕", async () => {
    const installation = install_system_proxy_dispatcher_from_snapshot({
      routes: {
        "https://first.example": {
          kind: "proxy",
          uri: "http://127.0.0.1:7890/",
        },
        "https://second.example": {
          kind: "proxy",
          uri: "http://127.0.0.1:7891/",
        },
      },
    });
    installed_disposers.push(installation.dispose);
    const proxy_agents: ProxyAgent[] = [];
    vi.spyOn(ProxyAgent.prototype, "dispatch").mockImplementation(
      function (this: ProxyAgent): boolean {
        proxy_agents.push(this);
        return true;
      },
    );
    const dispatcher = getGlobalDispatcher();
    const handler = {} as Dispatcher.DispatchHandler;
    dispatcher.dispatch(
      {
        headers: [],
        method: "GET",
        origin: "https://first.example",
        path: "/",
      },
      handler,
    );
    dispatcher.dispatch(
      {
        headers: [],
        method: "GET",
        origin: "https://second.example",
        path: "/",
      },
      handler,
    );
    const close_failure = new Error("proxy close failed");
    vi.spyOn(proxy_agents[0]!, "close").mockRejectedValueOnce(close_failure);
    let release_second_close: () => void = () => undefined;
    const second_close_block = new Promise<void>((resolve) => {
      release_second_close = resolve;
    });
    vi.spyOn(proxy_agents[1]!, "close").mockImplementationOnce(
      async () => await second_close_block,
    );
    let dispose_settled = false;
    const disposing = installation.dispose().then(
      () => {
        dispose_settled = true;
        return { error: null };
      },
      (error: unknown) => {
        dispose_settled = true;
        return { error };
      },
    );

    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(getGlobalDispatcher()).toBe(original_dispatcher);
      expect(dispose_settled).toBe(false);
    } finally {
      release_second_close();
    }

    const result = await disposing;
    installed_disposers.pop();
    expect(result.error).toBeInstanceOf(AggregateError);
    expect((result.error as AggregateError).errors).toEqual([close_failure]);
  });

  it("启动提示摘要只暴露代理命中结果，不暴露代理 URI", () => {
    const notice = build_system_proxy_startup_notice({
      routes: {
        "https://api.example": { kind: "proxy", uri: "http://user:password@127.0.0.1:7890/" },
        "https://api.openai.com": { kind: "direct" },
      },
    });

    expect(build_system_proxy_startup_notice(null)).toBe(EMPTY_SYSTEM_PROXY_STARTUP_NOTICE);
    expect(notice).toEqual({
      detected: true,
      proxiedOriginCount: 1,
      proxyDisplay: "http://127.0.0.1:7890",
    });
    expect(JSON.stringify(notice)).not.toContain("user:password");
  });
});
