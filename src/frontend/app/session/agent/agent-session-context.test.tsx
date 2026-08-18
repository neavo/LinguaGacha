import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_SESSION_EVENT_TOPIC,
  type AgentEntryStatus,
  type AgentMessageAttachment,
  type AgentSessionSnapshot,
} from "@shared/agent";
import { AGENT_INPUT_HISTORY_STORAGE_KEY } from "./agent-input-history";

const desktop_api_mocks = vi.hoisted(() => ({
  api_get: vi.fn(),
  api_fetch: vi.fn(),
  open_event_stream: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => desktop_api_mocks);

import { AgentSessionProvider, useAgentSession } from "./agent-session-context";

/** 多个会话入口共享同一份新协议夹具，避免各用例维护平行字段形状。 */
const TEST_SKILLS: AgentSessionSnapshot["skills"] = [
  {
    name: "glossary-audit",
    displayDescriptions: {
      "zh-CN": "审校术语",
      "en-US": "Review glossary",
      "de-DE": "Glossar prüfen",
    },
  },
  {
    name: "corpus-search",
    displayDescriptions: {
      "zh-CN": "检索语料",
      "en-US": "Search corpus",
      "de-DE": "Korpus durchsuchen",
    },
  },
];

/** 只实现页面状态测试需要的订阅、重连与 JSON 发帧表面。 */
class FakeEventSource {
  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, EventListener>();

  /** 页面每个 topic 只注册一个监听器，后注册值可直接替换。 */
  public addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  /** fake 不持有外部资源，关闭保持无副作用。 */
  public close(): void {}

  /** 通过真实 MessageEvent.data 形状投递 JSON 载荷。 */
  public emit(type: string, payload: unknown): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }

  /** 绕过 JSON 编码以验证损坏帧的恢复路径。 */
  public emit_raw(type: string, data: string): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }

  /** 模拟 EventSource 重连后的 open 通知。 */
  public emit_open(): void {
    this.onopen?.();
  }
}

describe("AgentSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let event_source: FakeEventSource;

  beforeEach(() => {
    window.localStorage.clear();
    event_source = new FakeEventSource();
    desktop_api_mocks.api_get.mockReset().mockResolvedValue(
      agent_snapshot({
        state: "idle",
        entries: [assistant_entry("assistant-1", "已恢复", "success", 1)],
        skills: TEST_SKILLS,
      }),
    );
    desktop_api_mocks.api_fetch.mockReset();
    desktop_api_mocks.open_event_stream.mockReset().mockResolvedValue(event_source);
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("按 id 覆盖完整条目并保留首次出现的真实顺序", async () => {
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "entry_upsert",
        entry: assistant_entry("assistant-2", "第一段", "running", 2),
      });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "entry_upsert",
        entry: {
          kind: "assistant_message",
          id: "assistant-2",
          parts: [
            { kind: "thinking", text: "检查" },
            { kind: "text", text: "第一段第二段" },
          ],
          status: "success",
          createdAt: 2,
        },
      });
    });

    expect(latest.entries.map((entry) => entry.id)).toEqual(["assistant-1", "assistant-2"]);
    expect(latest.entries.at(-1)).toMatchObject({
      parts: [
        { kind: "thinking", text: "检查" },
        { kind: "text", text: "第一段第二段" },
      ],
      status: "success",
    });
  });

  it("只接纳合法上下文用量事件，非法帧不覆盖当前值", async () => {
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: 31_488,
      });
    });
    expect(latest.contextTokens).toBe(31_488);

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: -1,
      });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: 1.5,
      });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: null,
      });
    });
    expect(latest.contextTokens).toBe(31_488);
  });

  it("用合法进度事件替换全部待办，并拒绝不完整标签", async () => {
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "task_progress",
        taskProgress: ["读取工程", "检查章节", "汇总结果"],
      });
    });
    expect(latest.taskProgress).toEqual(["读取工程", "检查章节", "汇总结果"]);

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "task_progress",
        taskProgress: ["读取工程", " "],
      });
    });
    expect(latest.taskProgress).toEqual(["读取工程", "检查章节", "汇总结果"]);
  });

  it("用完整队列事件替换投影，并转发队列协议命令", async () => {
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    const item = {
      id: "queue-1",
      text: "稍后处理",
      attachments: [],
      status: "queued" as const,
      createdAt: 1,
    };
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "input_queue",
        inputQueue: { paused: true, canSendNow: true, items: [item] },
      });
    });
    expect(latest.inputQueue).toEqual({ paused: true, canSendNow: true, items: [item] });
    latest.input.write_draft({ text: "普通草稿", attachments: [] });

    desktop_api_mocks.api_fetch.mockResolvedValue(
      agent_snapshot({ inputQueue: { paused: false, canSendNow: false, items: [] } }),
    );
    await act(async () => {
      await latest.updateQueuedMessage(item.id, { text: "修改后", attachments: [] });
      await latest.deleteQueuedMessage(item.id);
      await latest.reorderQueuedMessages([item.id]);
      await latest.sendQueuedMessage(item.id);
    });
    expect(desktop_api_mocks.api_fetch.mock.calls).toEqual([
      ["/api/agent/queue/update", { id: item.id, message: { text: "修改后", attachments: [] } }],
      ["/api/agent/queue/delete", { id: item.id }],
      ["/api/agent/queue/reorder", { ids: [item.id] }],
      ["/api/agent/queue/send", { id: item.id }],
    ]);
    expect(latest.input.read_draft()).toEqual({ text: "普通草稿", attachments: [] });
    expect(latest.input.read_history()).toEqual([]);
  });

  it("运行中仍受理普通发送并在 ack 后清空草稿", async () => {
    desktop_api_mocks.api_get.mockResolvedValue(agent_snapshot({ state: "running" }));
    desktop_api_mocks.api_fetch.mockResolvedValue(
      agent_snapshot({
        state: "running",
        inputQueue: {
          paused: false,
          canSendNow: false,
          items: [
            {
              id: "queue-1",
              text: "排队",
              attachments: [],
              status: "queued",
              createdAt: 1,
            },
          ],
        },
      }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "排队", attachments: [] });

    await act(async () => latest.send({ text: "排队", attachments: [] }));

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/message", {
      text: "排队",
      attachments: [],
    });
    expect(latest.input.read_draft()).toEqual({ text: "", attachments: [] });
  });

  it("携带消息 continue 通过唯一入口受理并清空草稿", async () => {
    desktop_api_mocks.api_get.mockResolvedValue(
      agent_snapshot({
        inputQueue: {
          paused: true,
          canSendNow: true,
          items: [
            {
              id: "queue-1",
              text: "已有消息",
              attachments: [],
              status: "queued",
              createdAt: 1,
            },
          ],
        },
      }),
    );
    desktop_api_mocks.api_fetch.mockResolvedValue(agent_snapshot({ state: "running" }));
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "追加消息", attachments: [] });

    await act(async () => latest.continue({ text: "追加消息", attachments: [] }));

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/continue", {
      message: { text: "追加消息", attachments: [] },
    });
    expect(latest.input.read_draft()).toEqual({ text: "", attachments: [] });
    expect(latest.input.read_history()).toEqual(["追加消息"]);
  });

  it.each([
    [
      "inputQueue",
      { state: "idle", entries: [], skills: [], taskProgress: [], contextTokens: null },
    ],
    [
      "contextTokens",
      {
        state: "idle",
        entries: [],
        skills: [],
        inputQueue: { paused: false, canSendNow: false, items: [] },
        taskProgress: [],
      },
    ],
  ])("缺失必需快照字段 %s 时按当前协议失败", async (_field, snapshot) => {
    desktop_api_mocks.api_get.mockResolvedValue(snapshot);
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("restore_failed"));
  });

  it("拒绝旧会话终态，并允许用户按当前协议重新恢复", async () => {
    desktop_api_mocks.api_get
      .mockResolvedValueOnce({
        state: "complete",
        entries: [],
        skills: [],
        inputQueue: { paused: false, canSendNow: false, items: [] },
        taskProgress: [],
        contextTokens: null,
      })
      .mockResolvedValueOnce(
        agent_snapshot({ entries: [assistant_entry("assistant-current", "已恢复", "success", 2)] }),
      );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("restore_failed"));
    expect(latest.entries).toEqual([]);
    await latest.send({ text: "不可发送", attachments: [] });
    expect(desktop_api_mocks.api_fetch).not.toHaveBeenCalled();

    await act(async () => latest.reconnect());
    await wait_for(() => expect(latest.transport).toBe("ready"));
    expect(latest.entries).toEqual([assistant_entry("assistant-current", "已恢复", "success", 2)]);
  });

  it("skill 清单只接纳完整的新 UI 描述协议", async () => {
    desktop_api_mocks.api_get.mockResolvedValue({
      state: "idle",
      entries: [],
      inputQueue: { paused: false, canSendNow: true, items: [] },
      taskProgress: [],
      contextTokens: null,
      skills: [
        TEST_SKILLS[0],
        { name: "legacy", description: "旧描述" },
        {
          name: "incomplete",
          displayDescriptions: { "zh-CN": "不完整", "en-US": "Incomplete" },
        },
        {
          name: "blank",
          displayDescriptions: { "zh-CN": "空白", "en-US": "Blank", "de-DE": " " },
        },
      ],
    });
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    expect(latest.skills).toEqual([TEST_SKILLS[0]]);
  });

  it("只接纳字段完整且值域合法的时间线条目", async () => {
    desktop_api_mocks.api_get.mockResolvedValue({
      state: "idle",
      entries: [
        {
          kind: "tool_call",
          id: "running",
          toolName: "read_skill",
          input: '{"path":"SKILL.md"}',
          status: "running",
          output: null,
          createdAt: 1,
        },
        {
          kind: "tool_call",
          id: "success",
          toolName: "workspace_script",
          input: '{"script":"return []"}',
          status: "success",
          output: '{"items":[]}',
          createdAt: 2,
        },
        {
          kind: "tool_call",
          id: "unknown",
          toolName: "missing_tool",
          input: "{}",
          status: "error",
          output: "工具不存在",
          createdAt: 3,
        },
        {
          kind: "tool_call",
          id: "legacy",
          toolName: "workspace_script",
          status: "success",
          detail: "旧协议不得兼容",
          createdAt: 4,
        },
        {
          kind: "tool_call",
          id: "invalid",
          toolName: "workspace_load",
          input: "{}",
          status: "success",
          output: { entries: [] },
          createdAt: 5,
        },
        {
          kind: "tool_call",
          id: "invalid-running-output",
          toolName: "workspace_script",
          input: "{}",
          status: "running",
          output: "不应存在",
          createdAt: 6,
        },
        {
          kind: "tool_call",
          id: "invalid-success-output",
          toolName: "workspace_script",
          input: "{}",
          status: "success",
          output: null,
          createdAt: 7,
        },
        {
          kind: "assistant_message",
          id: "assistant-new",
          parts: [
            { kind: "thinking", text: "检查" },
            { kind: "thinking", text: "\n完成" },
            { kind: "text", text: "结论" },
          ],
          status: "success",
          createdAt: 6,
        },
        {
          kind: "assistant_message",
          id: "assistant-legacy",
          text: "旧协议不得兼容",
          status: "success",
          createdAt: 7,
        },
        {
          kind: "assistant_message",
          id: "assistant-unknown",
          parts: [{ kind: "reasoning", text: "未知类型" }],
          status: "success",
          createdAt: 8,
        },
        {
          kind: "assistant_message",
          id: "assistant-invalid-text",
          parts: [{ kind: "thinking", text: { value: "非法正文" } }],
          status: "success",
          createdAt: 9,
        },
        {
          kind: "user_message",
          id: "user-new",
          delivery: "round",
          text: "@skill(glossary-audit) 审校",
          attachments: [
            ...image_attachments("webp-image"),
            { kind: "response_annotation", selectedText: "旧回复", comment: "审校" },
          ],
          status: "success",
          createdAt: 10,
          endedAt: 12,
        },
        {
          kind: "user_message",
          id: "user-steer",
          delivery: "steer",
          text: "立即补充",
          attachments: [],
          status: "success",
          createdAt: 11,
          endedAt: 11,
        },
        {
          kind: "user_message",
          id: "user-invalid-steer",
          delivery: "steer",
          text: "尚未提交",
          attachments: [],
          status: "running",
          createdAt: 11,
          endedAt: null,
        },
        {
          kind: "user_message",
          id: "user-missing-ended-at",
          delivery: "round",
          text: "缺少结束时间",
          attachments: [],
          status: "success",
          createdAt: 11,
        },
        {
          kind: "user_message",
          id: "user-invalid-ended-at",
          delivery: "round",
          text: "非法结束时间",
          attachments: [],
          status: "success",
          createdAt: 12,
          endedAt: "13",
        },
        {
          kind: "user_message",
          id: "user-float-ended-at",
          delivery: "round",
          text: "浮点结束时间",
          attachments: [],
          status: "success",
          createdAt: 13,
          endedAt: 13.5,
        },
        {
          kind: "context_compaction",
          id: "compaction-success",
          status: "success",
          createdAt: 14,
        },
        {
          kind: "context_compaction",
          id: "compaction-stopped",
          status: "stopped",
          createdAt: 15,
        },
      ],
      skills: [],
      inputQueue: { paused: false, canSendNow: true, items: [] },
      taskProgress: [],
      contextTokens: null,
    });
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    expect(latest.entries).toEqual([
      {
        kind: "tool_call",
        id: "running",
        toolName: "read_skill",
        input: '{"path":"SKILL.md"}',
        status: "running",
        output: null,
        createdAt: 1,
      },
      {
        kind: "tool_call",
        id: "success",
        toolName: "workspace_script",
        input: '{"script":"return []"}',
        status: "success",
        output: '{"items":[]}',
        createdAt: 2,
      },
      {
        kind: "tool_call",
        id: "unknown",
        toolName: "missing_tool",
        input: "{}",
        status: "error",
        output: "工具不存在",
        createdAt: 3,
      },
      {
        kind: "assistant_message",
        id: "assistant-new",
        parts: [
          { kind: "thinking", text: "检查\n完成" },
          { kind: "text", text: "结论" },
        ],
        status: "success",
        createdAt: 6,
      },
      {
        kind: "user_message",
        id: "user-new",
        delivery: "round",
        text: "@skill(glossary-audit) 审校",
        attachments: [
          ...image_attachments("webp-image"),
          { kind: "response_annotation", selectedText: "旧回复", comment: "审校" },
        ],
        status: "success",
        createdAt: 10,
        endedAt: 12,
      },
      {
        kind: "user_message",
        id: "user-steer",
        delivery: "steer",
        text: "立即补充",
        attachments: [],
        status: "success",
        createdAt: 11,
        endedAt: 11,
      },
      {
        kind: "context_compaction",
        id: "compaction-success",
        status: "success",
        createdAt: 14,
      },
    ]);
  });

  it("先订阅再恢复 snapshot，重连后重新读取权威状态", async () => {
    let resolve_seed!: (value: unknown) => void;
    desktop_api_mocks.api_get
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolve_seed = resolve;
          }),
      )
      .mockResolvedValueOnce(
        agent_snapshot({
          state: "idle",
          entries: [assistant_entry("assistant-1", "重连已恢复", "success", 1)],
        }),
      );
    const texts: string[] = [];
    let latest!: ReturnType<typeof useAgentSession>;

    await render_probe(() => {
      const state = useAgentSession();
      latest = state;
      useEffect(() => {
        const entry = state.entries.at(-1);
        texts.push(
          entry?.kind === "assistant_message"
            ? entry.parts
                .filter((part) => part.kind === "text")
                .map((part) => part.text)
                .join("")
            : "",
        );
      }, [state.entries]);
    });
    await wait_for(() => expect(desktop_api_mocks.open_event_stream).toHaveBeenCalledOnce());
    event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
      type: "entry_upsert",
      entry: assistant_entry("assistant-1", "订阅期条目", "running", 1),
    });
    await act(async () => {
      resolve_seed(agent_snapshot({ state: "running" }));
    });
    await wait_for(() => expect(texts.at(-1)).toBe("订阅期条目"));

    await act(async () => event_source.onerror?.());
    expect(latest.transport).toBe("disconnected");
    expect(texts.at(-1)).toBe("订阅期条目");

    event_source.emit_open();
    event_source.emit_open();
    await wait_for(() => expect(desktop_api_mocks.api_get).toHaveBeenCalledTimes(2));
    await wait_for(() => expect(texts.at(-1)).toBe("重连已恢复"));
    expect(latest.transport).toBe("ready");
  });

  it("损坏帧触发权威 snapshot 自愈而不永久停在断线态", async () => {
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    desktop_api_mocks.api_get.mockResolvedValueOnce(
      agent_snapshot({ entries: [assistant_entry("assistant-recovered", "已校正", "success", 2)] }),
    );

    await act(async () => event_source.emit_raw(AGENT_SESSION_EVENT_TOPIC, "{"));
    await wait_for(() => expect(desktop_api_mocks.api_get).toHaveBeenCalledTimes(2));
    await wait_for(() => expect(latest.transport).toBe("ready"));
    expect(latest.entries).toEqual([
      assistant_entry("assistant-recovered", "已校正", "success", 2),
    ]);
  });

  it("发送规范文本，受理后原子记录历史并清空草稿", async () => {
    desktop_api_mocks.api_fetch.mockResolvedValue(
      agent_snapshot({
        state: "running",
        skills: TEST_SKILLS,
      }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "  请处理 @skill(corpus-search)  ", attachments: [] });

    await act(async () => {
      await latest.send({ text: "  请处理 @skill(corpus-search)  ", attachments: [] });
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/message", {
      text: "请处理 @skill(corpus-search)",
      attachments: [],
    });
    expect(latest.input.read_draft()).toEqual({ text: "", attachments: [] });
    expect(latest.input.read_history()).toEqual(["请处理 @skill(corpus-search)"]);
    expect(
      JSON.parse(window.localStorage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY) ?? "null"),
    ).toEqual(latest.input.read_history());
    expect(latest.input.revision).toBe(1);
  });

  it("纯图片受理后清空完整草稿且不写入文本历史", async () => {
    desktop_api_mocks.api_fetch.mockResolvedValue(agent_snapshot({ state: "running" }));
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "", attachments: image_attachments("webp-image") });

    await act(async () => {
      await latest.send({ text: "", attachments: image_attachments("webp-image") });
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/message", {
      text: "",
      attachments: image_attachments("webp-image"),
    });
    expect(latest.input.read_draft()).toEqual({ text: "", attachments: [] });
    expect(latest.input.read_history()).toEqual([]);
  });

  it("以原输入修订轮次表示重试，且不改写输入历史或草稿", async () => {
    window.localStorage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(["历史消息"]));
    desktop_api_mocks.api_fetch.mockResolvedValue(agent_snapshot({ state: "running" }));
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({
      text: "正在编辑的新任务",
      attachments: image_attachments("webp-draft"),
    });

    await act(async () => {
      await latest.reviseLatestRound("user-1", { text: "历史消息", attachments: [] });
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/round/revise", {
      entryId: "user-1",
      message: { text: "历史消息", attachments: [] },
    });
    expect(latest.input.read_draft()).toEqual({
      text: "正在编辑的新任务",
      attachments: image_attachments("webp-draft"),
    });
    expect(latest.input.read_history()).toEqual(["历史消息"]);
    expect(latest.input.revision).toBe(0);
    expect(latest.command).toBeNull();
  });

  it("历史修订不占用普通草稿，输入历史由编辑器成功回写", async () => {
    window.localStorage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(["旧消息"]));
    desktop_api_mocks.api_get.mockResolvedValue(
      agent_snapshot({ entries: [user_entry("user-1", "旧消息", ["old-image"])] }),
    );
    desktop_api_mocks.api_fetch.mockResolvedValue(agent_snapshot());
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "普通草稿", attachments: image_attachments("draft-image") });

    await act(async () => {
      await latest.reviseLatestRound("user-1", { text: "新消息", attachments: [] });
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/round/revise", {
      entryId: "user-1",
      message: { text: "新消息", attachments: [] },
    });
    expect(latest.input.read_draft()).toEqual({
      text: "普通草稿",
      attachments: image_attachments("draft-image"),
    });
    expect(latest.input.read_history()).toEqual(["旧消息"]);
    act(() => latest.input.replace_history("旧消息", "新消息"));
    expect(latest.input.read_history()).toEqual(["新消息"]);
  });

  it("消费页面卸载后仍保留完整草稿", async () => {
    let latest: ReturnType<typeof useAgentSession> | null = null;
    function Probe(): null {
      latest = useAgentSession();
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render_visible = async (visible: boolean): Promise<void> => {
      await act(async () =>
        root?.render(<AgentSessionProvider>{visible ? <Probe /> : null}</AgentSessionProvider>),
      );
    };

    await render_visible(true);
    await wait_for(() => expect(latest?.transport).toBe("ready"));
    latest!.input.write_draft({
      text: "检查 @skill(glossary-audit)",
      attachments: [
        ...image_attachments("webp-image"),
        {
          kind: "response_annotation",
          selectedText: "旧回复",
          comment: "跨页面保留",
        },
      ],
    });

    await render_visible(false);
    latest = null;
    await render_visible(true);

    const restored_session = latest as ReturnType<typeof useAgentSession> | null;
    expect(restored_session?.input.read_draft()).toEqual({
      text: "检查 @skill(glossary-audit)",
      attachments: [
        ...image_attachments("webp-image"),
        {
          kind: "response_annotation",
          selectedText: "旧回复",
          comment: "跨页面保留",
        },
      ],
    });
  });

  it("发送 ack 晚于 SSE 时先应用 ack 再重放增量", async () => {
    let resolve_send!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_send = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    let result!: Promise<void>;
    await act(async () => {
      result = latest.send({ text: "继续", attachments: [] });
      await Promise.resolve();
    });
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "entry_upsert",
        entry: assistant_entry("assistant-2", "SSE 新消息", "running", 2),
      });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: 200,
      });
      resolve_send(
        agent_snapshot({
          state: "running",
          contextTokens: 100,
        }),
      );
      await result;
    });

    expect(latest.state).toBe("running");
    expect(latest.entries).toEqual([assistant_entry("assistant-2", "SSE 新消息", "running", 2)]);
    expect(latest.contextTokens).toBe(200);
  });

  it("非法命令 ack 不吞掉排队事件或锁死后续命令", async () => {
    let resolve_send!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_send = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    let first!: Promise<void>;
    await act(async () => {
      first = latest.send({ text: "继续", attachments: [] });
      await Promise.resolve();
    });
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "context_tokens",
        contextTokens: 200,
      });
      resolve_send({ state: "running", entries: [], skills: [] });
      await expect(first).rejects.toBeInstanceOf(TypeError);
    });

    expect(latest.contextTokens).toBe(200);

    desktop_api_mocks.api_fetch.mockResolvedValue(agent_snapshot({ state: "running" }));
    await act(async () => {
      await latest.send({ text: "再次继续", attachments: [] });
    });
  });

  it("同一帧重复发送只受理第一个请求", async () => {
    let resolve_send!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_send = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = latest.send({ text: "第一次", attachments: [] });
      second = latest.send({ text: "第二次", attachments: [] });
      await Promise.resolve();
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledOnce();
    await second;
    await act(async () => {
      resolve_send(agent_snapshot({ state: "running" }));
      await first;
    });
    await first;
  });

  it("发送失败向页面回传错误并保留草稿与快照", async () => {
    const offline = new Error("offline");
    desktop_api_mocks.api_fetch.mockRejectedValue(offline);
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    latest.input.write_draft({ text: "重试草稿", attachments: [] });

    await act(async () => {
      await expect(latest.send({ text: "重试", attachments: [] })).rejects.toBe(offline);
    });
    expect(latest.input.read_draft()).toEqual({ text: "重试草稿", attachments: [] });
    expect(latest.input.read_history()).toEqual([]);
    expect(latest.input.revision).toBe(0);
  });

  it("停止成功后应用空闲快照", async () => {
    desktop_api_mocks.api_get.mockResolvedValue(
      agent_snapshot({
        state: "running",
        entries: [assistant_entry("assistant-1", "处理中", "running", 1)],
      }),
    );
    desktop_api_mocks.api_fetch.mockResolvedValue(
      agent_snapshot({
        state: "idle",
        entries: [assistant_entry("assistant-1", "已停止", "stopped", 1)],
      }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    await act(async () => {
      await latest.stop();
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/stop");
    expect(latest.state).toBe("idle");
    expect(latest.entries).toEqual([assistant_entry("assistant-1", "已停止", "stopped", 1)]);
  });

  it("停止失败时向页面回传错误并保留运行快照", async () => {
    desktop_api_mocks.api_get.mockResolvedValue(
      agent_snapshot({
        state: "running",
        entries: [assistant_entry("assistant-1", "处理中", "running", 1)],
      }),
    );
    const offline = new Error("offline");
    desktop_api_mocks.api_fetch.mockRejectedValue(offline);
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    const previous_entries = latest.entries;

    await act(async () => {
      await expect(latest.stop()).rejects.toBe(offline);
    });

    expect(latest.state).toBe("running");
    expect(latest.entries).toEqual(previous_entries);
  });

  it("统一 continue 命令应用后端决定的压缩运行条目", async () => {
    const failed_compaction = {
      kind: "context_compaction" as const,
      id: "compaction-1",
      status: "error" as const,
      createdAt: 1,
    };
    desktop_api_mocks.api_get.mockResolvedValue(agent_snapshot({ entries: [failed_compaction] }));
    desktop_api_mocks.api_fetch.mockResolvedValue(
      agent_snapshot({ entries: [{ ...failed_compaction, status: "running" }] }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));

    await act(async () => latest.continue());

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/continue", {});
    expect(latest.entries).toEqual([{ ...failed_compaction, status: "running" }]);
    expect(latest.command).toBeNull();
  });

  it("重置期间公开命令状态，并在成功后应用权威空快照", async () => {
    let resolve_reset!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_reset = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    let result!: Promise<void>;
    await act(async () => {
      result = latest.reset();
      await Promise.resolve();
    });
    expect(latest.command).toBe("reset");
    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/reset");

    await act(async () => {
      resolve_reset(agent_snapshot({ skills: TEST_SKILLS.slice(0, 1) }));
      await result;
    });
    expect(latest).toMatchObject({
      state: "idle",
      entries: [],
      skills: TEST_SKILLS.slice(0, 1),
      command: null,
    });
  });

  it("重置失败向页面回传错误并保留当前快照", async () => {
    const offline = new Error("offline");
    desktop_api_mocks.api_fetch.mockRejectedValue(offline);
    let latest!: ReturnType<typeof useAgentSession>;
    await render_probe(() => {
      latest = useAgentSession();
    });
    await wait_for(() => expect(latest.transport).toBe("ready"));
    const previous_entries = latest.entries;

    await act(async () => {
      await expect(latest.reset()).rejects.toBe(offline);
    });

    expect(latest.entries).toEqual(previous_entries);
    expect(latest.command).toBeNull();
  });

  /** 探针只暴露 Hook 的公开返回值，不读取或注入内部 setter。 */
  async function render_probe(use_probe: () => void): Promise<void> {
    function Probe(): null {
      use_probe();
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AgentSessionProvider>
          <Probe />
        </AgentSessionProvider>,
      ),
    );
  }
});

function assistant_entry(id: string, text: string, status: AgentEntryStatus, createdAt: number) {
  return {
    kind: "assistant_message" as const,
    id,
    parts: [{ kind: "text" as const, text }],
    status,
    createdAt,
  };
}

function user_entry(id: string, text: string, images: string[] = []) {
  return {
    kind: "user_message" as const,
    id,
    delivery: "round" as const,
    text,
    attachments: image_attachments(...images),
    status: "success" as const,
    createdAt: 1,
    endedAt: 2,
  };
}

function image_attachments(...images: string[]): AgentMessageAttachment[] {
  return images.map((webpBase64) => ({ kind: "image", webpBase64 }));
}

function agent_snapshot(overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot {
  return {
    state: "idle",
    entries: [],
    skills: [],
    inputQueue: { paused: false, canSendNow: false, items: [] },
    taskProgress: [],
    contextTokens: null,
    ...overrides,
  };
}

async function wait_for(assertion: () => void): Promise<void> {
  await act(async () => await vi.waitFor(assertion));
}
