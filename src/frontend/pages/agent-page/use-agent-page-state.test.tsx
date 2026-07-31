import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_SESSION_EVENT_TOPIC } from "@shared/agent";

const desktop_api_mocks = vi.hoisted(() => ({
  api_get: vi.fn(),
  api_fetch: vi.fn(),
  open_event_stream: vi.fn(),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => desktop_api_mocks);

import { useAgentPageState } from "./use-agent-page-state";

class FakeEventSource {
  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, EventListener>();

  public addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  public close(): void {}

  public emit(type: string, payload: unknown): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }

  public emit_open(): void {
    this.onopen?.();
  }
}

describe("useAgentPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let event_source: FakeEventSource;

  beforeEach(() => {
    event_source = new FakeEventSource();
    desktop_api_mocks.api_get.mockReset().mockResolvedValue({
      state: "complete",
      entries: [assistant_entry("assistant-1", "已恢复", true, 1)],
      skills: [
        { name: "glossary-audit", description: "审校术语" },
        { name: "corpus-search", description: "检索语料" },
      ],
    });
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
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "entry_upsert",
        entry: assistant_entry("assistant-2", "第一段", false, 2),
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
          complete: true,
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
      complete: true,
    });
  });

  it("只接纳字段完整且值域合法的时间线条目", async () => {
    desktop_api_mocks.api_get.mockResolvedValue({
      state: "complete",
      entries: [
        {
          kind: "tool_call",
          id: "running",
          toolName: "read_skill",
          status: "running",
          output: null,
          createdAt: 1,
        },
        {
          kind: "tool_call",
          id: "complete",
          toolName: "query_project_items",
          status: "success",
          output: '{"results":[]}',
          createdAt: 2,
        },
        {
          kind: "tool_call",
          id: "unknown",
          toolName: "missing_tool",
          status: "error",
          output: "工具不存在",
          createdAt: 3,
        },
        {
          kind: "tool_call",
          id: "legacy",
          toolName: "query_project_items",
          status: "success",
          detail: "旧协议不得兼容",
          createdAt: 4,
        },
        {
          kind: "tool_call",
          id: "invalid",
          toolName: "query_quality_rules",
          status: "success",
          output: { entries: [] },
          createdAt: 5,
        },
        {
          kind: "assistant_message",
          id: "assistant-new",
          parts: [
            { kind: "thinking", text: "检查" },
            { kind: "thinking", text: "\n完成" },
            { kind: "text", text: "结论" },
          ],
          complete: true,
          createdAt: 6,
        },
        {
          kind: "assistant_message",
          id: "assistant-legacy",
          text: "旧协议不得兼容",
          complete: true,
          createdAt: 7,
        },
        {
          kind: "assistant_message",
          id: "assistant-unknown",
          parts: [{ kind: "reasoning", text: "未知类型" }],
          complete: true,
          createdAt: 8,
        },
        {
          kind: "assistant_message",
          id: "assistant-invalid-text",
          parts: [{ kind: "thinking", text: { value: "非法正文" } }],
          complete: true,
          createdAt: 9,
        },
        {
          kind: "user_message",
          id: "user-new",
          parts: [
            { kind: "skill", name: "glossary-audit" },
            { kind: "text", text: "审校" },
          ],
          createdAt: 10,
          endedAt: 12,
        },
        {
          kind: "user_message",
          id: "user-missing-ended-at",
          parts: [{ kind: "text", text: "旧协议不得兼容" }],
          createdAt: 11,
        },
        {
          kind: "user_message",
          id: "user-invalid-ended-at",
          parts: [{ kind: "text", text: "非法结束时间" }],
          createdAt: 12,
          endedAt: "13",
        },
        {
          kind: "user_message",
          id: "user-float-ended-at",
          parts: [{ kind: "text", text: "浮点结束时间" }],
          createdAt: 13,
          endedAt: 13.5,
        },
      ],
      skills: [],
    });
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    expect(latest.entries).toEqual([
      {
        kind: "tool_call",
        id: "running",
        toolName: "read_skill",
        status: "running",
        output: null,
        createdAt: 1,
      },
      {
        kind: "tool_call",
        id: "complete",
        toolName: "query_project_items",
        status: "success",
        output: '{"results":[]}',
        createdAt: 2,
      },
      {
        kind: "tool_call",
        id: "unknown",
        toolName: "missing_tool",
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
        complete: true,
        createdAt: 6,
      },
      {
        kind: "user_message",
        id: "user-new",
        parts: [
          { kind: "skill", name: "glossary-audit" },
          { kind: "text", text: "审校" },
        ],
        createdAt: 10,
        endedAt: 12,
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
      .mockResolvedValueOnce({
        state: "complete",
        entries: [assistant_entry("assistant-1", "重连已恢复", true, 1)],
        skills: [],
      });
    const texts: string[] = [];

    await render_probe(() => {
      const state = useAgentPageState();
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
      entry: assistant_entry("assistant-1", "订阅期条目", false, 1),
    });
    await act(async () => {
      resolve_seed({ state: "running", entries: [], skills: [] });
    });
    await wait_for(() => expect(texts.at(-1)).toBe("订阅期条目"));

    event_source.emit_open();
    event_source.emit_open();
    await wait_for(() => expect(desktop_api_mocks.api_get).toHaveBeenCalledTimes(2));
    await wait_for(() => expect(texts.at(-1)).toBe("重连已恢复"));
  });

  it("发送有序 parts，命令受理后返回 true", async () => {
    desktop_api_mocks.api_fetch.mockResolvedValue({
      state: "running",
      entries: [],
      skills: [
        { name: "glossary-audit", description: "审校术语" },
        { name: "corpus-search", description: "检索语料" },
      ],
    });
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    let accepted = false;
    await act(async () => {
      accepted = await latest.send([
        { kind: "text", text: "请处理 " },
        { kind: "skill", name: "corpus-search" },
      ]);
    });

    expect(accepted).toBe(true);
    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/message", {
      parts: [
        { kind: "text", text: "请处理 " },
        { kind: "skill", name: "corpus-search" },
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
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    let result!: Promise<boolean>;
    await act(async () => {
      result = latest.send([{ kind: "text", text: "继续" }]);
      await Promise.resolve();
    });
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "entry_upsert",
        entry: assistant_entry("assistant-2", "SSE 新消息", false, 2),
      });
      resolve_send({ state: "running", entries: [], skills: [] });
      await result;
    });

    expect(latest.state).toBe("running");
    expect(latest.entries).toEqual([assistant_entry("assistant-2", "SSE 新消息", false, 2)]);
  });

  it("同一帧重复发送只受理第一个请求", async () => {
    let resolve_send!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_send = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = latest.send([{ kind: "text", text: "第一次" }]);
      second = latest.send([{ kind: "text", text: "第二次" }]);
      await Promise.resolve();
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledOnce();
    await expect(second).resolves.toBe(false);
    await act(async () => {
      resolve_send({ state: "running", entries: [], skills: [] });
      await first;
    });
    await expect(first).resolves.toBe(true);
  });

  it("模型失败与发送失败都保持错误态，发送失败返回 false", async () => {
    desktop_api_mocks.api_fetch.mockRejectedValue(new Error("offline"));
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, { type: "request_failed" });
    });
    expect(latest.error).toBe(true);

    let accepted = true;
    await act(async () => {
      accepted = await latest.send([{ kind: "text", text: "重试" }]);
    });
    expect(accepted).toBe(false);
    expect(latest.error).toBe(true);
  });

  it("停止成功后应用空闲快照", async () => {
    desktop_api_mocks.api_get.mockResolvedValue({
      state: "running",
      entries: [assistant_entry("assistant-1", "处理中", false, 1)],
      skills: [],
    });
    desktop_api_mocks.api_fetch.mockResolvedValue({
      state: "idle",
      entries: [assistant_entry("assistant-1", "已停止", true, 1)],
      skills: [],
    });
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));

    await act(async () => {
      await latest.stop();
    });

    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/stop");
    expect(latest.state).toBe("idle");
    expect(latest.entries).toEqual([assistant_entry("assistant-1", "已停止", true, 1)]);
  });

  it("停止失败时保留运行快照并显示错误态", async () => {
    desktop_api_mocks.api_get.mockResolvedValue({
      state: "running",
      entries: [assistant_entry("assistant-1", "处理中", false, 1)],
      skills: [],
    });
    desktop_api_mocks.api_fetch.mockRejectedValue(new Error("offline"));
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));
    const previous_entries = latest.entries;

    await act(async () => {
      await latest.stop();
    });

    expect(latest.state).toBe("running");
    expect(latest.entries).toEqual(previous_entries);
    expect(latest.error).toBe(true);
  });

  it("重置期间清除旧错误，并在成功后归一应用权威空快照", async () => {
    let resolve_reset!: (value: unknown) => void;
    desktop_api_mocks.api_fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_reset = resolve;
        }),
    );
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));
    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, { type: "request_failed" });
    });

    let result!: Promise<boolean>;
    await act(async () => {
      result = latest.reset();
      await Promise.resolve();
    });
    expect(latest.resetting).toBe(true);
    expect(latest.error).toBe(false);
    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/reset");

    let accepted = false;
    await act(async () => {
      resolve_reset({
        state: "unknown",
        entries: [{ kind: "legacy" }],
        skills: [{ name: "glossary-audit", description: "审校术语" }],
      });
      accepted = await result;
    });
    expect(accepted).toBe(true);
    expect(latest).toMatchObject({
      state: "idle",
      entries: [],
      skills: [{ name: "glossary-audit", description: "审校术语" }],
      error: false,
      resetting: false,
    });
  });

  it("重置失败保留当前快照并恢复可操作错误态", async () => {
    desktop_api_mocks.api_fetch.mockRejectedValue(new Error("offline"));
    let latest!: ReturnType<typeof useAgentPageState>;
    await render_probe(() => {
      latest = useAgentPageState();
    });
    await wait_for(() => expect(latest.loading).toBe(false));
    const previous_entries = latest.entries;

    let accepted = true;
    await act(async () => {
      accepted = await latest.reset();
    });

    expect(accepted).toBe(false);
    expect(latest.entries).toEqual(previous_entries);
    expect(latest.error).toBe(true);
    expect(latest.resetting).toBe(false);
  });

  async function render_probe(use_probe: () => void): Promise<void> {
    function Probe(): null {
      use_probe();
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));
  }
});

function assistant_entry(id: string, text: string, complete: boolean, createdAt: number) {
  return {
    kind: "assistant_message",
    id,
    parts: [{ kind: "text", text }],
    complete,
    createdAt,
  };
}

async function wait_for(assertion: () => void): Promise<void> {
  await act(async () => await vi.waitFor(assertion));
}
