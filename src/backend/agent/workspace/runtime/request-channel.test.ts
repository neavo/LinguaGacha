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

  it("恢复宿主应用错误的 code 与公开详情", async () => {
    const channel = new AgentWorkspaceRequestChannel(
      async () => undefined,
      () => undefined,
    );
    const pending = channel.call({ kind: "resolve_proxy", url: "https://example.com" });
    channel.accept({
      type: "response",
      id: 1,
      result: {
        ok: false,
        error: {
          code: "data.revision_conflict",
          message: "revision changed",
          public_details: { expected_revision: 2, current_revision: 3 },
        },
      },
    });
    await expect(pending).rejects.toMatchObject({
      code: "data.revision_conflict",
      message: "revision changed",
      public_details: { expected_revision: 2, current_revision: 3 },
    });
  });
});
