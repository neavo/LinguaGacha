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
  public closed = false;
  private readonly listeners = new Map<string, EventListener>();

  public addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  public close(): void {
    this.closed = true;
  }

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
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "已恢复",
          createdAt: 1,
          complete: true,
        },
      ],
      toolStatuses: [],
      skills: [{ name: "glossary-audit", description: "审校术语" }],
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

  it("先恢复 snapshot，再把同一消息的增量与完成帧合并", async () => {
    const snapshots: Array<{ state: string; text: string; complete: boolean }> = [];

    function Probe(): null {
      const state = useAgentPageState();
      useEffect(() => {
        const message = state.messages.at(-1);
        snapshots.push({
          state: state.state,
          text: message?.text ?? "",
          complete: message?.complete ?? false,
        });
      }, [state.messages, state.state]);
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe />);
    });
    await wait_for(() =>
      expect(snapshots.at(-1)).toEqual({ state: "complete", text: "已恢复", complete: true }),
    );

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "message_delta",
        messageId: "assistant-2",
        role: "assistant",
        delta: "第一段",
        offset: 0,
        createdAt: 2,
        complete: false,
      });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
        type: "message_delta",
        messageId: "assistant-2",
        role: "assistant",
        delta: "第二段",
        offset: 3,
        createdAt: 2,
        complete: true,
      });
    });

    expect(snapshots.at(-1)).toEqual({
      state: "complete",
      text: "第一段第二段",
      complete: true,
    });
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
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            text: "重连已恢复",
            createdAt: 1,
            complete: true,
          },
        ],
        toolStatuses: [],
        skills: [{ name: "glossary-audit", description: "审校术语" }],
      });
    const texts: string[] = [];

    function Probe(): null {
      const state = useAgentPageState();
      useEffect(() => {
        texts.push(state.messages.at(-1)?.text ?? "");
      }, [state.messages]);
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe />);
    });
    await wait_for(() => expect(desktop_api_mocks.open_event_stream).toHaveBeenCalledTimes(1));
    event_source.emit(AGENT_SESSION_EVENT_TOPIC, {
      type: "message_delta",
      messageId: "assistant-1",
      role: "assistant",
      delta: "订阅期增量",
      offset: 0,
      createdAt: 1,
      complete: false,
    });
    await act(async () => {
      resolve_seed({
        state: "running",
        messages: [],
        toolStatuses: [],
        skills: [{ name: "glossary-audit", description: "审校术语" }],
      });
    });
    await wait_for(() => expect(texts.at(-1)).toBe("订阅期增量"));

    event_source.emit_open();
    event_source.emit_open();
    await wait_for(() => expect(desktop_api_mocks.api_get).toHaveBeenCalledTimes(2));
    await wait_for(() => expect(texts.at(-1)).toBe("重连已恢复"));
  });

  it("按快照选择 skill、代发默认 prompt，并在失败后由重试恢复", async () => {
    desktop_api_mocks.api_fetch.mockResolvedValue({
      state: "running",
      messages: [],
      toolStatuses: [],
      skills: [{ name: "glossary-audit", description: "审校术语" }],
    });
    let latest!: ReturnType<typeof useAgentPageState>;

    function Probe(): null {
      latest = useAgentPageState();
      return null;
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe />);
    });
    await wait_for(() => expect(latest.loading).toBe(false));
    expect(latest.skills).toEqual([{ name: "glossary-audit", description: "审校术语" }]);

    await act(async () => {
      latest.select_skill("glossary-audit");
    });
    await act(async () => {
      await latest.send("请执行已选能力所描述的任务。");
    });
    expect(desktop_api_mocks.api_fetch).toHaveBeenCalledWith("/api/agent/message", {
      text: "请执行已选能力所描述的任务。",
      skill: "glossary-audit",
    });

    await act(async () => {
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, { type: "request_failed" });
      event_source.emit(AGENT_SESSION_EVENT_TOPIC, { type: "session_state", state: "complete" });
    });
    expect(latest.error).toBe(true);

    await act(async () => {
      latest.update_input("重试");
    });
    await act(async () => {
      await latest.send("默认任务");
    });
    event_source.emit_open();
    event_source.emit_open();
    await wait_for(() => expect(desktop_api_mocks.api_get).toHaveBeenCalledTimes(2));
    await wait_for(() => expect(latest.error).toBe(false));
  });
});

async function wait_for(assertion: () => void): Promise<void> {
  await act(async () => await vi.waitFor(assertion));
}
