import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceRuntimeChildMessage } from "./protocol";
import { AgentWorkspaceProxyChannel } from "./proxy-channel";

describe("AgentWorkspaceProxyChannel", () => {
  it("关联乱序响应并取消单个待决请求", async () => {
    const sent: AgentWorkspaceRuntimeChildMessage[] = [];
    const pending = vi.fn();
    const channel = new AgentWorkspaceProxyChannel(async (message) => {
      sent.push(message);
    }, pending);
    const first = channel.resolveProxy("https://example.com/first");
    const controller = new AbortController();
    const second = channel.resolveProxy("https://example.com/second", controller.signal);
    channel.accept({
      type: "proxy_result",
      id: 1,
      result: { ok: true, rules: "PROXY proxy.example:8080" },
    });
    await expect(first).resolves.toBe("PROXY proxy.example:8080");
    expect(pending).toHaveBeenLastCalledWith(true);
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(second).rejects.toBe(reason);
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(sent).toContainEqual({ type: "proxy_cancel", id: 2 });
    channel.accept({ type: "proxy_result", id: 2, result: { ok: true, rules: "DIRECT" } });
  });

  it("发送失败结算原请求", async () => {
    const failed = new AgentWorkspaceProxyChannel(
      async () => {
        throw new Error("IPC closed");
      },
      () => undefined,
    );
    await expect(failed.resolveProxy("https://example.com")).rejects.toThrow("IPC closed");
  });
});
