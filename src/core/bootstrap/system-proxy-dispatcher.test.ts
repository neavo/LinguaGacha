import { afterEach, describe, expect, it } from "vitest";
import { getGlobalDispatcher } from "undici";

import {
  EMPTY_SYSTEM_PROXY_STARTUP_NOTICE,
  build_system_proxy_startup_notice,
  collect_system_proxy_urls,
  install_system_proxy_dispatcher,
  install_system_proxy_dispatcher_from_snapshot,
  parse_system_proxy_route,
} from "./system-proxy-dispatcher";

describe("system-proxy-dispatcher", () => {
  const original_dispatcher = getGlobalDispatcher(); // original_dispatcher 用于确认测试后全局 dispatcher 被恢复
  const installed_disposers: Array<() => Promise<void>> = []; // installed_disposers 收尾失败测试中的代理安装

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
    const urls = collect_system_proxy_urls(
      {
        models: [
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
        ],
      },
      [
        {
          api_format: "Anthropic",
          api_url: "https://api.anthropic.com",
        },
        {
          api_format: "OpenAI",
          api_url: "https://api.openai.com/v1",
        },
      ],
    );

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
