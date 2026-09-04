import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./agent-session-store", () => ({
  AgentSessionStore: class {
    public readonly connect = store.connect;
    public readonly disconnect = store.disconnect;
  },
}));

import { AgentSessionProvider, useAgentSessionActions } from "./agent-session-context";

describe("AgentSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("随 Provider 挂载和卸载管理会话连接", async () => {
    container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(<AgentSessionProvider>content</AgentSessionProvider>));
    expect(store.connect).toHaveBeenCalledOnce();

    await act(async () => root?.unmount());
    root = null;
    expect(store.disconnect).toHaveBeenCalledOnce();
  });

  it("拒绝在 Provider 外使用会话 Hook", async () => {
    function Consumer(): null {
      useAgentSessionActions();
      return null;
    }

    container = document.createElement("div");
    root = createRoot(container);

    await expect(act(async () => root?.render(<Consumer />))).rejects.toThrow(
      "Agent session hooks must be used inside AgentSessionProvider.",
    );
  });
});
