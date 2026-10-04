import { act, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { apply_model_auth_snapshot, useModelAuthSnapshot } from "./model-auth-store";

it("账户快照拒绝迟到修订，支持补读和新后端实例", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  /** 从公开订阅观察最终状态，验证 HTTP 与 SSE 共用的修订边界。 */
  function Probe(): JSX.Element {
    const snapshot = useModelAuthSnapshot();
    return <span>{snapshot?.connected ? "connected" : "disconnected"}</span>;
  }
  try {
    await act(async () => root.render(<Probe />));
    const snapshot = { instance_id: "current", revision: 2, login: null, connected: true };
    await act(async () => {
      apply_model_auth_snapshot(snapshot);
    });
    await act(async () => {
      expect(apply_model_auth_snapshot({ ...snapshot, revision: 1, connected: false })).toBe(false);
    });
    expect(container.textContent).toBe("connected");
    // CLI 可以更新文件，同一后端补读时 revision 相同也应接收最新连接事实。
    await act(async () => {
      apply_model_auth_snapshot({ ...snapshot, connected: false });
    });
    expect(container.textContent).toBe("disconnected");
    await act(async () => {
      apply_model_auth_snapshot({ instance_id: "next", revision: 0, login: null, connected: true });
    });
    expect(container.textContent).toBe("connected");
  } finally {
    await act(async () => root.unmount());
  }
});
