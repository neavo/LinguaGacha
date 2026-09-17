import { describe, expect, it, vi } from "vitest";
import type { AgentWorkspaceRuntimeChildMessage } from "./protocol";
import { AgentWorkspaceRequestChannel } from "./request-channel";

describe("AgentWorkspaceRequestChannel", () => {
  it("关联乱序响应并取消单个待决请求", async () => {
    const sent: AgentWorkspaceRuntimeChildMessage[] = [];
    const pending = vi.fn();
    const channel = new AgentWorkspaceRequestChannel(async (message) => {
      sent.push(message);
    }, pending);
    const first = channel.call({ kind: "resolve_proxy", url: "https://example.com/first" });
    const controller = new AbortController();
    const second = channel.call({ kind: "print_pdf", html: "<p>second</p>" }, controller.signal);
    channel.accept({
      type: "response",
      id: 1,
      result: { ok: true, value: "PROXY proxy.example:8080" },
    });
    await expect(first).resolves.toBe("PROXY proxy.example:8080");
    expect(pending).toHaveBeenLastCalledWith(true);
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(second).rejects.toBe(reason);
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(sent).toContainEqual({ type: "cancel", id: 2 });
    channel.accept({ type: "response", id: 2, result: { ok: true, value: "DIRECT" } });
  });

  it("发送失败结算原请求", async () => {
    const failed = new AgentWorkspaceRequestChannel(
      async () => {
        throw new Error("IPC closed");
      },
      () => undefined,
    );
    await expect(
      failed.call({ kind: "resolve_proxy", url: "https://example.com" }),
    ).rejects.toThrow("IPC closed");
  });
});
