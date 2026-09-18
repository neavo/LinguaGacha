import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEntry } from "@shared/agent";

const agent_mock = vi.hoisted(() => ({
  session: null as unknown,
  request_user_attention: vi.fn(),
}));

vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentControls: () => ({ state: (agent_mock.session as { state: string }).state }),
  useAgentTimeline: () => ({ entries: (agent_mock.session as { entries: AgentEntry[] }).entries }),
}));

import { AgentCompletionAttention } from "@frontend/app/feedback/agent-completion-attention";

describe("AgentCompletionAttention", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    agent_mock.request_user_attention.mockReset();
    agent_mock.session = { state: "idle", entries: [] };
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: { requestUserAttention: agent_mock.request_user_attention },
    });
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it.each(["success", "error", "stopped", null] as const)(
    "运行结束为 %s 时按轮次结果提醒一次",
    async (status) => {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const terminal = status === null ? [] : [round_entry(status)];
      agent_mock.session = { state: "idle", entries: terminal };
      await render_attention();
      expect(agent_mock.request_user_attention).not.toHaveBeenCalled();
      agent_mock.session = { state: "running", entries: terminal };
      await render_attention();
      expect(agent_mock.request_user_attention).not.toHaveBeenCalled();
      agent_mock.session = { state: "idle", entries: terminal };
      await render_attention();
      await render_attention();
      expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(
        status === "success" || status === "error" ? 1 : 0,
      );
    },
  );

  /** 在同一挂载中推送连续快照，观察宿主通知次数。 */
  async function render_attention(): Promise<void> {
    await act(async () => {
      root?.render(<AgentCompletionAttention />);
    });
  }
});

/** 构造后端普通用户轮次的最小有效条目。 */
function round_entry(status: AgentEntry["status"]): AgentEntry {
  return {
    kind: "user_message",
    id: `round-${status}`,
    delivery: "round",
    text: "任务",
    attachments: [],
    status,
    createdAt: 1,
    endedAt: status === "running" ? null : 2,
  };
}
