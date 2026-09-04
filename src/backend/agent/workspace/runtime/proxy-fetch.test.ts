import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentWorkspaceRuntimeChildMessage } from "./protocol";
import { AgentWorkspaceProxyChannel, install_agent_workspace_proxy_fetch } from "./proxy-fetch";

describe("Agent Workspace 透明代理 fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("按目标 URL 请求路线并为代理路线复用显式 HttpClient", async () => {
    const native_fetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    const close = vi.fn();
    const create_http_client = vi.fn(() => ({ close }));
    vi.stubGlobal("fetch", native_fetch);
    vi.stubGlobal("Deno", { createHttpClient: create_http_client });
    const sent: AgentWorkspaceRuntimeChildMessage[] = [];
    const channel = new AgentWorkspaceProxyChannel(async (message) => {
      sent.push(message);
    });
    const restore = install_agent_workspace_proxy_fetch(channel);

    const first = fetch("https://example.com/first");
    await vi.waitFor(() =>
      expect(sent).toContainEqual({
        type: "proxy_request",
        id: 1,
        url: "https://example.com/first",
      }),
    );
    channel.accept({
      type: "proxy_result",
      id: 1,
      result: { ok: true, route: { kind: "proxy", uri: "http://proxy.example:8080/" } },
    });
    await expect(first).resolves.toBeInstanceOf(Response);

    const second = fetch("https://example.com/second");
    await vi.waitFor(() =>
      expect(sent).toContainEqual({
        type: "proxy_request",
        id: 2,
        url: "https://example.com/second",
      }),
    );
    channel.accept({
      type: "proxy_result",
      id: 2,
      result: { ok: true, route: { kind: "proxy", uri: "http://proxy.example:8080/" } },
    });
    await second;

    expect(create_http_client).toHaveBeenCalledOnce();
    expect(native_fetch).toHaveBeenCalledTimes(2);
    expect(native_fetch.mock.calls[0]?.[1]).toMatchObject({
      client: expect.any(Object),
    });
    restore();
    expect(close).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toBe(native_fetch);
  });

  it("DIRECT 使用原生 fetch，调用信号取消仍在等待的代理解析", async () => {
    const native_fetch = vi.fn<typeof fetch>(async () => new Response("ok"));
    vi.stubGlobal("fetch", native_fetch);
    vi.stubGlobal("Deno", { createHttpClient: vi.fn() });
    const sent: AgentWorkspaceRuntimeChildMessage[] = [];
    const channel = new AgentWorkspaceProxyChannel(async (message) => {
      sent.push(message);
    });
    const restore = install_agent_workspace_proxy_fetch(channel);

    const direct = fetch("http://localhost:3000");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    channel.accept({
      type: "proxy_result",
      id: 1,
      result: { ok: true, route: { kind: "direct" } },
    });
    await direct;
    expect(native_fetch.mock.calls[0]?.[1]).not.toHaveProperty("client");

    const controller = new AbortController();
    const cancelled = fetch("https://example.com/pending", { signal: controller.signal });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    expect(sent).toContainEqual({ type: "proxy_cancel", id: 2 });
    restore();
  });
});
