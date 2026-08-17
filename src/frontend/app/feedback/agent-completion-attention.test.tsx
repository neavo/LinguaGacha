import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEntry } from "@shared/agent";

const agent_mock = vi.hoisted(() => ({
  session: null as unknown,
  request_user_attention: vi.fn(),
}));

vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentSession: () => agent_mock.session,
}));

import {
  AgentCompletionAttention,
  resolve_agent_completion_attention,
} from "./agent-completion-attention";

describe("resolve_agent_completion_attention", () => {
  it("只在运行后的成功或失败 round 收束时请求提醒", () => {
    expect(
      resolve_agent_completion_attention(true, {
        state: "idle",
        entries: [round_entry("success")],
      }),
    ).toEqual({ was_running: false, should_request: true });
    expect(
      resolve_agent_completion_attention(true, {
        state: "idle",
        entries: [round_entry("error")],
      }),
    ).toEqual({ was_running: false, should_request: true });
    expect(
      resolve_agent_completion_attention(true, {
        state: "idle",
        entries: [round_entry("stopped")],
      }),
    ).toEqual({ was_running: false, should_request: false });
    expect(
      resolve_agent_completion_attention(true, {
        state: "idle",
        entries: [],
      }),
    ).toEqual({ was_running: false, should_request: false });
  });

  it("运行中的中间 round 不提前提醒，历史终态也不补发", () => {
    expect(
      resolve_agent_completion_attention(false, {
        state: "idle",
        entries: [round_entry("success")],
      }),
    ).toEqual({ was_running: false, should_request: false });
    expect(
      resolve_agent_completion_attention(true, {
        state: "running",
        entries: [round_entry("running")],
      }),
    ).toEqual({ was_running: true, should_request: false });
  });
});

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

  it("整段运行结束只请求一次提醒，停止和重复快照不重复请求", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await render_attention();
    agent_mock.session = { state: "running", entries: [round_entry("running")] };
    await render_attention();
    agent_mock.session = { state: "idle", entries: [round_entry("stopped")] };
    await render_attention();
    expect(agent_mock.request_user_attention).not.toHaveBeenCalled();

    agent_mock.session = { state: "running", entries: [round_entry("running")] };
    await render_attention();
    agent_mock.session = { state: "idle", entries: [round_entry("success")] };
    await render_attention();
    await render_attention();

    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);
  });

  async function render_attention(): Promise<void> {
    await act(async () => {
      root?.render(<AgentCompletionAttention />);
    });
  }
});

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
