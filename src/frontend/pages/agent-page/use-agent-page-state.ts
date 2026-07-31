import { useEffect, useRef, useState } from "react";

import type {
  AgentAssistantMessagePart,
  AgentContextUsage,
  AgentEntry,
  AgentSessionEvent,
  AgentSessionSnapshot,
  AgentSessionState,
  AgentSkillSnapshot,
  AgentToolEntry,
  AgentUserMessagePart,
} from "@shared/agent";
import { AGENT_SESSION_EVENT_TOPIC, normalize_agent_user_message_parts } from "@shared/agent";
import { is_json_record, read_json_record, type JsonRecord } from "@domain/json";
import { api_fetch, api_get, open_event_stream } from "@frontend/app/desktop/desktop-api";

const EMPTY_SNAPSHOT: AgentSessionSnapshot = {
  state: "idle",
  entries: [],
  skills: [],
  contextUsage: null,
};

type UseAgentPageState = {
  state: AgentSessionState;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  contextUsage: AgentContextUsage | null;
  loading: boolean;
  error: boolean;
  resetting: boolean;
  send: (parts: readonly AgentUserMessagePart[]) => Promise<boolean>;
  stop: () => Promise<void>;
  reset: () => Promise<boolean>;
};

/**
 * 持有 Agent 页面私有状态，并把 HTTP 快照与 SSE 增量合并为同一公开视图。
 */
export function useAgentPageState(): UseAgentPageState {
  const [snapshot, set_snapshot] = useState<AgentSessionSnapshot>(EMPTY_SNAPSHOT);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState(false);
  const [resetting, set_resetting] = useState(false);
  const request_failed_ref = useRef(false); // 重连只清除传输错误，不能吞掉尚未重试的命令失败
  // 命令互斥必须同步生效；否则同一帧的重复调用会在 React 提交状态前穿透 UI 禁用态。
  const command_event_queue_ref = useRef<AgentSessionEvent[] | null>(null);
  const send_in_flight_ref = useRef(false);

  useEffect(() => {
    let disposed = false;
    let event_source: EventSource | null = null;
    let syncing = false;
    let opened_once = false;
    const pending_events: AgentSessionEvent[] = [];

    const sync_snapshot = async (): Promise<void> => {
      if (syncing || disposed) return;
      syncing = true;
      try {
        let next = normalize_snapshot(await api_get<AgentSessionSnapshot>("/api/agent/snapshot"));
        if (disposed) return;
        for (const event of pending_events.splice(0)) {
          next = apply_agent_event(next, event);
        }
        set_snapshot(next);
        set_loading(false);
        set_error(request_failed_ref.current);
      } catch {
        if (!disposed) {
          set_loading(false);
          set_error(true);
        }
      } finally {
        syncing = false;
      }
    };

    void open_event_stream()
      .then((source) => {
        event_source = source;
        if (disposed) {
          source.close();
          return;
        }
        source.addEventListener(AGENT_SESSION_EVENT_TOPIC, ((event: MessageEvent<string>) => {
          try {
            const agent_event = normalize_agent_event(JSON.parse(event.data) as unknown);
            if (agent_event === null) return;
            if (agent_event.type === "request_failed") {
              request_failed_ref.current = true;
              set_error(true);
              return;
            }
            const command_events = command_event_queue_ref.current;
            if (command_events !== null) command_events.push(agent_event);
            else if (syncing) pending_events.push(agent_event);
            else set_snapshot((current) => apply_agent_event(current, agent_event));
          } catch {
            set_error(true);
          }
        }) as EventListener);
        source.onopen = () => {
          if (opened_once) void sync_snapshot();
          opened_once = true;
        };
        source.onerror = () => set_error(true);
        void sync_snapshot();
      })
      .catch(() => {
        if (!disposed) {
          set_loading(false);
          set_error(true);
        }
      });

    return () => {
      disposed = true;
      event_source?.close();
    };
  }, []);

  const begin_command = (): AgentSessionEvent[] | null => {
    if (command_event_queue_ref.current !== null) return null;
    const events: AgentSessionEvent[] = [];
    command_event_queue_ref.current = events;
    return events;
  };

  const finish_command = (
    events: AgentSessionEvent[],
    acknowledged_snapshot?: AgentSessionSnapshot,
  ): void => {
    if (command_event_queue_ref.current !== events) return;
    // 必须先校验 ack；若校验抛错，命令 catch 仍需用同一队列重放已到达的 SSE。
    const normalized_snapshot =
      acknowledged_snapshot === undefined ? undefined : normalize_snapshot(acknowledged_snapshot);
    command_event_queue_ref.current = null;
    // HTTP ack 可能晚于对应 SSE；先应用 ack，再按真实到达顺序重放事件，禁止状态倒退。
    if (normalized_snapshot !== undefined) {
      set_snapshot(replay_agent_events(normalized_snapshot, events));
      return;
    }
    if (events.length > 0) {
      set_snapshot((current) => replay_agent_events(current, events));
    }
  };

  const send = async (parts: readonly AgentUserMessagePart[]): Promise<boolean> => {
    if (snapshot.state === "running" || send_in_flight_ref.current) return false;
    const command_events = begin_command();
    if (command_events === null) return false;
    send_in_flight_ref.current = true;
    request_failed_ref.current = false;
    set_error(false);
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/message", {
        parts,
      });
      finish_command(command_events, next);
      return true;
    } catch {
      finish_command(command_events);
      request_failed_ref.current = true;
      set_error(true);
      return false;
    } finally {
      send_in_flight_ref.current = false;
    }
  };

  const stop = async (): Promise<void> => {
    if (snapshot.state !== "running") return;
    const command_events = begin_command();
    if (command_events === null) return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/stop");
      finish_command(command_events, next);
    } catch {
      finish_command(command_events);
      request_failed_ref.current = true;
      set_error(true);
    }
  };

  const reset = async (): Promise<boolean> => {
    const command_events = begin_command();
    if (command_events === null) return false;
    request_failed_ref.current = false;
    set_error(false);
    set_resetting(true);
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/reset");
      finish_command(command_events, next);
      return true;
    } catch {
      finish_command(command_events);
      request_failed_ref.current = true;
      set_error(true);
      return false;
    } finally {
      set_resetting(false);
    }
  };

  return {
    state: snapshot.state,
    entries: snapshot.entries,
    skills: snapshot.skills,
    contextUsage: snapshot.contextUsage,
    loading,
    error,
    resetting,
    send,
    stop,
    reset,
  };
}

/** 按接收顺序重放命令期间积压的 SSE，保持条目覆盖与会话状态语义一致。 */
function replay_agent_events(
  snapshot: AgentSessionSnapshot,
  events: readonly AgentSessionEvent[],
): AgentSessionSnapshot {
  return events.reduce(apply_agent_event, snapshot);
}

/** 以完整条目按 id 覆盖；首次出现的位置就是后端确认的真实时序。 */
export function apply_agent_event(
  snapshot: AgentSessionSnapshot,
  event: AgentSessionEvent,
): AgentSessionSnapshot {
  switch (event.type) {
    case "snapshot_seed":
      return normalize_snapshot(event.snapshot);
    case "request_failed":
      return snapshot;
    case "session_state":
      return { ...snapshot, state: event.state };
    case "context_usage":
      return { ...snapshot, contextUsage: { ...event.contextUsage } };
    case "entry_upsert": {
      const entries = [...snapshot.entries];
      const entry = structuredClone(event.entry);
      const index = entries.findIndex((entry) => entry.id === event.entry.id);
      if (index < 0) entries.push(entry);
      else entries[index] = entry;
      return { ...snapshot, entries };
    }
  }
}

/**
 * API 与 SSE 都是不可信 JSON 边界，以下归一函数只接纳协议声明的字段和值域。
 */
function normalize_snapshot(value: unknown): AgentSessionSnapshot {
  const record = read_json_record(value);
  const state = normalize_state(record["state"]);
  const entries = Array.isArray(record["entries"])
    ? record["entries"].flatMap(normalize_entry)
    : [];
  const skills = Array.isArray(record["skills"]) ? record["skills"].flatMap(normalize_skill) : [];
  const context_usage = normalize_context_usage(record["contextUsage"]);
  if (context_usage === undefined) throw new TypeError("Agent snapshot contextUsage 非法");
  return { state, entries, skills, contextUsage: context_usage };
}

/** SSE 顶层判别失败时丢弃单帧，重连仍会读取权威 snapshot。 */
function normalize_agent_event(value: unknown): AgentSessionEvent | null {
  const record = read_json_record(value);
  switch (record["type"]) {
    case "request_failed":
      return { type: "request_failed" };
    case "snapshot_seed":
      return { type: "snapshot_seed", snapshot: normalize_snapshot(record["snapshot"]) };
    case "session_state":
      return { type: "session_state", state: normalize_state(record["state"]) };
    case "context_usage": {
      const context_usage = normalize_context_usage(record["contextUsage"]);
      return context_usage === null || context_usage === undefined
        ? null
        : { type: "context_usage", contextUsage: context_usage };
    }
    case "entry_upsert": {
      const entry = normalize_entry(record["entry"])[0];
      return entry === undefined ? null : { type: "entry_upsert", entry };
    }
    default:
      return null;
  }
}

/** null 只表示完整快照尚无运行时；undefined 表示协议字段非法。 */
function normalize_context_usage(value: unknown): AgentContextUsage | null | undefined {
  if (value === null) return null;
  if (
    !is_json_record(value) ||
    typeof value["tokens"] !== "number" ||
    !Number.isSafeInteger(value["tokens"]) ||
    value["tokens"] < 0 ||
    typeof value["contextWindow"] !== "number" ||
    !Number.isSafeInteger(value["contextWindow"]) ||
    value["contextWindow"] <= 0 ||
    typeof value["maxTokens"] !== "number" ||
    !Number.isSafeInteger(value["maxTokens"]) ||
    value["maxTokens"] <= 0
  ) {
    return undefined;
  }
  return {
    tokens: value["tokens"],
    contextWindow: value["contextWindow"],
    maxTokens: value["maxTokens"],
  };
}

/** 单条协议记录必须完整通过所属 kind 的字段校验，否则整条丢弃。 */
function normalize_entry(value: unknown): AgentEntry[] {
  if (
    !is_json_record(value) ||
    typeof value["id"] !== "string" ||
    typeof value["createdAt"] !== "number" ||
    !Number.isInteger(value["createdAt"])
  ) {
    return [];
  }
  if (value["kind"] === "user_message") {
    const ended_at = value["endedAt"];
    if (ended_at !== null && (typeof ended_at !== "number" || !Number.isInteger(ended_at))) {
      return [];
    }
    const parts = normalize_agent_user_message_parts(value["parts"]);
    if (parts === null || parts.length === 0) return [];
    return [
      {
        kind: "user_message",
        id: value["id"],
        parts,
        createdAt: value["createdAt"],
        endedAt: ended_at,
      },
    ];
  }
  if (value["kind"] === "assistant_message") {
    const parts = normalize_assistant_message_parts(value["parts"]);
    if (parts === null) return [];
    return [
      {
        kind: "assistant_message",
        id: value["id"],
        parts,
        complete: value["complete"] === true,
        createdAt: value["createdAt"],
      },
    ];
  }
  if (value["kind"] === "tool_call") return normalize_tool_entry(value);
  return [];
}

/** Assistant parts 去空并合并相邻同类块，维持与后端相同的规范形状。 */
function normalize_assistant_message_parts(value: unknown): AgentAssistantMessagePart[] | null {
  if (!Array.isArray(value)) return null;
  const parts: AgentAssistantMessagePart[] = [];
  for (const value_part of value) {
    if (
      !is_json_record(value_part) ||
      (value_part["kind"] !== "text" && value_part["kind"] !== "thinking") ||
      typeof value_part["text"] !== "string"
    ) {
      return null;
    }
    if (
      value_part["text"] === "" ||
      (value_part["kind"] === "thinking" && value_part["text"].trim() === "")
    ) {
      continue;
    }
    const part: AgentAssistantMessagePart =
      value_part["kind"] === "text"
        ? { kind: "text", text: value_part["text"] }
        : { kind: "thinking", text: value_part["text"] };
    const previous = parts.at(-1);
    if (previous?.kind === part.kind) previous.text += part.text;
    else parts.push(part);
  }
  return parts;
}

/** 工具条目只接纳公开状态和值域，不兼容旧 detail 载荷。 */
function normalize_tool_entry(value: JsonRecord): AgentToolEntry[] {
  const status_value = value["status"];
  if (
    (status_value !== "running" && status_value !== "success" && status_value !== "error") ||
    typeof value["toolName"] !== "string" ||
    (value["output"] !== null && typeof value["output"] !== "string")
  ) {
    return [];
  }
  return [
    {
      kind: "tool_call",
      id: value["id"] as string,
      toolName: value["toolName"],
      status: status_value,
      output: value["output"],
      createdAt: value["createdAt"] as number,
    },
  ];
}

/** 未知会话状态安全降级为 idle。 */
function normalize_state(value: unknown): AgentSessionState {
  return value === "running" || value === "complete" ? value : "idle";
}

/** skill snapshot 只保留能力选择所需的名称与描述。 */
function normalize_skill(value: unknown): AgentSkillSnapshot[] {
  if (
    !is_json_record(value) ||
    typeof value["name"] !== "string" ||
    typeof value["description"] !== "string"
  ) {
    return [];
  }
  return [{ name: value["name"], description: value["description"] }];
}
