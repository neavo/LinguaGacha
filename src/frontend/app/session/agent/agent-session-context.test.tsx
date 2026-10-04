import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentEntry } from "@shared/agent";
import { AgentSessionStore } from "./agent-session-store";
import { AgentSessionStoreContext, useAgentEntry } from "./agent-session-context";

it("条目 Hook 只跟随当前选择，切换与移除后更新正文", async () => {
  const store = new AgentSessionStore(window.localStorage, vi.fn());
  const first = message("first", "第一条");
  const second = message("second", "第二条");
  store.timeline.replace([first, second]);
  store.timeline.notify();
  const container = document.createElement("div");
  const root = createRoot(container);
  const rendered = vi.fn();

  /** 渲染次数验证条目订阅范围，正文验证通知实际到达 React。 */
  function Probe({ id }: { id: string | null }) {
    const entry = useAgentEntry(id);
    rendered();
    return <span>{entry?.kind === "assistant_message" ? entry.parts[0].text : ""}</span>;
  }

  /** 使用同一组件实例切换身份，触发真实订阅清理。 */
  const show = async (id: string | null) =>
    act(async () => {
      root.render(
        <AgentSessionStoreContext.Provider value={store}>
          <Probe id={id} />
        </AgentSessionStoreContext.Provider>,
      );
    });
  /** 模拟同一批次的条目事实与通知边界。 */
  const update = async (entry: AgentEntry) =>
    act(async () => {
      store.timeline.update([entry]);
      store.timeline.notify();
    });

  try {
    await show("first");
    rendered.mockClear();
    await update(message("second", "第二条更新"));
    expect(rendered).not.toHaveBeenCalled();
    await update(message("first", "第一条更新"));
    expect(container.textContent).toBe("第一条更新");
    await show("second");
    rendered.mockClear();
    await update(message("first", "旧订阅更新"));
    expect(rendered).not.toHaveBeenCalled();
    expect(container.textContent).toBe("第二条更新");
    await act(async () => {
      store.timeline.replace([]);
      store.timeline.notify();
    });
    expect(container.textContent).toBe("");
    await show(null);
    rendered.mockClear();
    await update(message("second", "空选择后的更新"));
    expect(rendered).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

/** 两个条目共用最小有效消息，正文由场景决定。 */
function message(id: string, text: string): AgentEntry {
  return {
    kind: "assistant_message",
    id,
    parts: [{ kind: "text", text }],
    status: "running",
    createdAt: 1,
  };
}
