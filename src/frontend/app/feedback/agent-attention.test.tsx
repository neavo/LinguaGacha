import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatStatus, AgentEntry, AgentPendingDecision } from "@shared/agent";
import type {
  AgentCommand,
  AgentTransportState,
} from "@frontend/app/session/agent/agent-chat-store";

type MockSession = {
  chatId: string | null;
  state: AgentChatStatus;
  transport: AgentTransportState;
  command: AgentCommand;
  pendingDecision: AgentPendingDecision | null;
  entries: AgentEntry[];
};

const agent_mock = vi.hoisted(() => ({
  session: null as unknown as MockSession,
  request_user_attention: vi.fn(async () => undefined),
}));

vi.mock("@frontend/app/session/agent/agent-chat-context", () => ({
  useAgentChatId: () => agent_mock.session.chatId,
  useAgentControls: () => agent_mock.session,
  useAgentTimeline: () => ({
    latestRoundId:
      agent_mock.session.entries.findLast(
        (entry) => entry.kind === "user_message" && entry.delivery === "round",
      )?.id ?? null,
  }),
  useAgentEntry: (id: string | null) => agent_mock.session.entries.find((entry) => entry.id === id),
}));

vi.mock("./desktop-attention", () => ({
  request_user_attention: agent_mock.request_user_attention,
}));

import { AgentAttention } from "@frontend/app/feedback/agent-attention";

describe("AgentAttention", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    agent_mock.request_user_attention.mockReset();
    agent_mock.session = create_session();
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it.each(["question", "write_approval"] as const)(
    "待决 %s 同身份快照与命令往返不重发，新身份按新事项请求",
    async (kind) => {
      await mount_attention();

      agent_mock.session = create_session({ pendingDecision: make_decision(kind, "call-1") });
      await render_attention();
      expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);

      // 快照重建产生新对象引用，以及普通命令执行往返，都不应重复提醒。
      agent_mock.session = create_session({ pendingDecision: make_decision(kind, "call-1") });
      await render_attention();
      agent_mock.session = create_session({
        command: "queue_update",
        pendingDecision: make_decision(kind, "call-1"),
      });
      await render_attention();
      agent_mock.session = create_session({
        command: null,
        pendingDecision: make_decision(kind, "call-1"),
      });
      await render_attention();
      expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);

      // 下一个新待决身份正常再次触发。
      agent_mock.session = create_session({ pendingDecision: make_decision(kind, "call-2") });
      await render_attention();
      expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(2);
    },
  );

  it("不可交互期间延迟提醒，解决后不补发，重连仍存在时保留去重", async () => {
    agent_mock.session = create_session({
      transport: "restoring",
      pendingDecision: make_decision("question", "call-restore"),
    });
    await mount_attention();
    expect(agent_mock.request_user_attention).not.toHaveBeenCalled();

    // 恢复完成仍存在时触发一次。
    agent_mock.session = create_session({
      transport: "ready",
      pendingDecision: make_decision("question", "call-restore"),
    });
    await render_attention();
    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);

    // 断线再恢复后仍是同一事项，不重复请求。
    agent_mock.session = create_session({
      transport: "disconnected",
      pendingDecision: make_decision("question", "call-restore"),
    });
    await render_attention();
    agent_mock.session = create_session({
      transport: "ready",
      pendingDecision: make_decision("question", "call-restore"),
    });
    await render_attention();
    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);

    // 命令提交期间出现新事项并在命令结束前已解决，不补发过期提醒。
    agent_mock.session = create_session({
      command: "send",
      pendingDecision: make_decision("write_approval", "call-ephemeral"),
    });
    await render_attention();
    agent_mock.session = create_session({ command: null, pendingDecision: null });
    await render_attention();
    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);
  });

  it("会话切换隔离待决身份并防止旧运行记忆误报历史终态", async () => {
    agent_mock.session = create_session({
      chatId: "chat-a",
      state: "running",
      pendingDecision: make_decision("question", "call-shared"),
    });
    await mount_attention();
    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(1);

    // 在 chat-a 运行中切到带历史终态和同名决策 id 的 chat-b：只触发 chat-b 的新待决事项，不误报 chat-b 历史终态。
    agent_mock.session = create_session({
      chatId: "chat-b",
      state: "idle",
      pendingDecision: make_decision("question", "call-shared"),
      entries: [round_entry("success")],
    });
    await render_attention();
    expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "error", "stopped", null] as const)(
    "本会话运行结束为 %s 时按轮次结果提醒一次，历史终态与停止过程不误报",
    async (status) => {
      const terminal = status === null ? [] : [round_entry(status)];
      agent_mock.session = create_session({ state: "idle", entries: terminal });
      await mount_attention();
      expect(agent_mock.request_user_attention).not.toHaveBeenCalled();

      agent_mock.session = create_session({ state: "running", entries: [round_entry("running")] });
      await render_attention();
      expect(agent_mock.request_user_attention).not.toHaveBeenCalled();

      if (status === "stopped") {
        agent_mock.session = create_session({ state: "stopping", entries: terminal });
        await render_attention();
      }

      agent_mock.session = create_session({
        state: "idle",
        transport: "disconnected",
        entries: terminal,
      });
      await render_attention();
      expect(agent_mock.request_user_attention).not.toHaveBeenCalled();

      agent_mock.session = create_session({ state: "idle", entries: terminal });
      await render_attention();
      await render_attention();
      expect(agent_mock.request_user_attention).toHaveBeenCalledTimes(
        status === "success" || status === "error" ? 1 : 0,
      );
    },
  );

  /** 挂载组件并推进首次渲染。 */
  async function mount_attention(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render_attention();
  }

  /** 在同一挂载中推送连续快照，观察桌面提醒调用次数。 */
  async function render_attention(): Promise<void> {
    await act(async () => {
      root?.render(<AgentAttention />);
    });
  }
});

/** 构造默认可交互会话状态。 */
function create_session(overrides: Partial<MockSession> = {}): MockSession {
  return {
    chatId: "chat-1",
    state: "idle",
    transport: "ready",
    command: null,
    pendingDecision: null,
    entries: [],
    ...overrides,
  };
}

/** 构造可区分身份的待决提问或写入审批。 */
function make_decision(kind: AgentPendingDecision["kind"], id: string): AgentPendingDecision {
  if (kind === "question") {
    return {
      kind: "question",
      id,
      question: {
        prompt: "请选择下一步",
        options: [{ id: "opt-1", label: "继续" }],
      },
    };
  }
  return {
    kind: "write_approval",
    id,
    summary: {
      pages: 1,
      items: 0,
      glossary: 0,
      textPreserve: 0,
      preReplacement: 0,
      postReplacement: 0,
      prompts: 0,
      knowledge: 0,
      files: 0,
    },
  };
}

/** 构造后端普通用户轮次的最小有效条目。 */
function round_entry(status: AgentEntry["status"]): AgentEntry {
  return {
    kind: "user_message",
    id: `round-${status}`,
    delivery: "round",
    averageTokensPerSecond: null,
    text: "任务",
    attachments: [],
    status,
    createdAt: 1,
    endedAt: status === "running" ? null : 2,
  };
}
