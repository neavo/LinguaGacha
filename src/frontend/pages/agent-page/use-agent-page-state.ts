import { useEffect, useRef, useState } from "react";

import type {
  AgentMessageSnapshot,
  AgentSessionEvent,
  AgentSessionSnapshot,
  AgentSessionState,
  AgentSkillSnapshot,
  AgentToolStatus,
} from "@shared/agent";
import { AGENT_SESSION_EVENT_TOPIC } from "@shared/agent";
import { is_json_record, read_json_integer, read_json_record } from "@domain/json";
import { api_fetch, api_get, open_event_stream } from "@frontend/app/desktop/desktop-api";

const EMPTY_SNAPSHOT: AgentSessionSnapshot = {
  state: "idle",
  messages: [],
  toolStatuses: [],
  skills: [],
};

type UseAgentPageState = {
  state: AgentSessionState;
  messages: AgentMessageSnapshot[];
  tool_statuses: AgentToolStatus[];
  skills: AgentSkillSnapshot[];
  input: string;
  selected_skill: string | null;
  skill_menu_open: boolean;
  loading: boolean;
  error: boolean;
  update_input: (value: string) => void;
  select_skill: (name: string) => void;
  clear_skill: () => void;
  send: (default_skill_prompt: string) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
};

/**
 * 持有 Agent 页面私有状态，并把 HTTP 快照与 SSE 增量合并为同一公开视图。
 */
export function useAgentPageState(): UseAgentPageState {
  const [snapshot, set_snapshot] = useState<AgentSessionSnapshot>(EMPTY_SNAPSHOT);
  const [input, set_input] = useState("");
  const [selected_skill, set_selected_skill] = useState<string | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState(false);
  const request_failed_ref = useRef(false); // 重连只清除传输错误，不能吞掉尚未重试的命令失败
  const skill_menu_open =
    snapshot.skills.length > 0 && selected_skill === null && /(^|\s)@[^\s@]*$/u.test(input);

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
            if (syncing) pending_events.push(agent_event);
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

  const update_input = (value: string): void => {
    set_input(value);
  };

  const select_skill = (name: string): void => {
    set_selected_skill(name);
    set_input((current) => current.replace(/(^|\s)@[^\s@]*$/u, "$1").trimStart());
  };

  const clear_skill = (): void => {
    set_selected_skill(null);
  };

  const send = async (default_skill_prompt: string): Promise<void> => {
    if (snapshot.state === "running") return;
    const text = input.trim() || (selected_skill === null ? "" : default_skill_prompt.trim());
    if (text === "") return;
    request_failed_ref.current = false;
    set_error(false);
    set_input("");
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/message", {
        text,
        ...(selected_skill === null ? {} : { skill: selected_skill }),
      });
      set_snapshot(normalize_snapshot(next));
    } catch {
      request_failed_ref.current = true;
      set_input(text);
      set_error(true);
    }
  };

  const stop = async (): Promise<void> => {
    if (snapshot.state !== "running") return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/stop");
      set_snapshot(normalize_snapshot(next));
    } catch {
      request_failed_ref.current = true;
      set_error(true);
    }
  };

  const reset = async (): Promise<void> => {
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/reset");
      set_snapshot(normalize_snapshot(next));
      set_selected_skill(null);
      set_input("");
      request_failed_ref.current = false;
      set_error(false);
    } catch {
      request_failed_ref.current = true;
      set_error(true);
    }
  };

  return {
    state: snapshot.state,
    messages: snapshot.messages,
    tool_statuses: snapshot.toolStatuses,
    skills: snapshot.skills,
    input,
    selected_skill,
    skill_menu_open,
    loading,
    error,
    update_input,
    select_skill,
    clear_skill,
    send,
    stop,
    reset,
  };
}

/**
 * 以 offset 幂等合并单个 Agent 事件；缺帧或重复帧保持当前快照等待下一次权威恢复。
 */
export function apply_agent_event(
  snapshot: AgentSessionSnapshot,
  event: AgentSessionEvent,
): AgentSessionSnapshot {
  if (event.type === "snapshot_seed") return normalize_snapshot(event.snapshot);
  if (event.type === "request_failed") return snapshot;
  if (event.type === "session_state") return { ...snapshot, state: event.state };
  if (event.type === "tool_status") {
    const tool_statuses = snapshot.toolStatuses.filter(
      (status) => status.toolCallId !== event.toolCallId,
    );
    tool_statuses.push({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      status: event.status,
    });
    return { ...snapshot, toolStatuses: tool_statuses };
  }

  const existing = snapshot.messages.find((message) => message.id === event.messageId);
  const messages = snapshot.messages.map((message) => ({ ...message }));
  if (existing === undefined) {
    if (event.offset !== 0) return snapshot;
    messages.push({
      id: event.messageId,
      role: event.role,
      text: event.delta,
      createdAt: event.createdAt,
      complete: event.complete,
    });
  } else {
    const index = messages.findIndex((message) => message.id === event.messageId);
    const current = messages[index];
    if (current !== undefined) {
      if (event.offset < current.text.length) {
        return event.complete && !current.complete
          ? {
              ...snapshot,
              messages: messages.map((message) =>
                message.id === event.messageId ? { ...message, complete: true } : message,
              ),
            }
          : snapshot;
      }
      if (event.offset > current.text.length) return snapshot;
      messages[index] = {
        ...current,
        text: current.text + event.delta,
        complete: event.complete,
      };
    }
  }
  return { ...snapshot, messages };
}

/**
 * API 与 SSE 都是不可信 JSON 边界，以下归一函数只接纳协议声明的字段和值域。
 */
function normalize_snapshot(value: unknown): AgentSessionSnapshot {
  const record = read_json_record(value);
  const state = normalize_state(record["state"]);
  const messages = Array.isArray(record["messages"])
    ? record["messages"].flatMap(normalize_message)
    : [];
  const tool_statuses = Array.isArray(record["toolStatuses"])
    ? record["toolStatuses"].flatMap(normalize_tool_status)
    : [];
  const skills = Array.isArray(record["skills"]) ? record["skills"].flatMap(normalize_skill) : [];
  return { state, messages, toolStatuses: tool_statuses, skills };
}

function normalize_agent_event(value: unknown): AgentSessionEvent | null {
  const record = read_json_record(value);
  if (record["type"] === "request_failed") return { type: "request_failed" };
  if (record["type"] === "snapshot_seed") {
    return { type: "snapshot_seed", snapshot: normalize_snapshot(record["snapshot"]) };
  }
  if (record["type"] === "session_state") {
    return { type: "session_state", state: normalize_state(record["state"]) };
  }
  if (record["type"] === "tool_status") {
    const normalized = normalize_tool_status(record);
    return normalized.length === 0 ? null : { type: "tool_status", ...normalized[0]! };
  }
  if (
    record["type"] === "message_delta" &&
    typeof record["messageId"] === "string" &&
    (record["role"] === "user" || record["role"] === "assistant") &&
    typeof record["delta"] === "string" &&
    typeof record["offset"] === "number" &&
    Number.isInteger(record["offset"]) &&
    record["offset"] >= 0
  ) {
    return {
      type: "message_delta",
      messageId: record["messageId"],
      role: record["role"],
      delta: record["delta"],
      offset: record["offset"],
      createdAt: read_json_integer(record["createdAt"], Date.now()),
      complete: record["complete"] === true,
    };
  }
  return null;
}

function normalize_message(value: unknown): AgentMessageSnapshot[] {
  if (
    !is_json_record(value) ||
    typeof value["id"] !== "string" ||
    (value["role"] !== "user" && value["role"] !== "assistant") ||
    typeof value["text"] !== "string"
  ) {
    return [];
  }
  return [
    {
      id: value["id"],
      role: value["role"],
      text: value["text"],
      createdAt: read_json_integer(value["createdAt"], Date.now()),
      complete: value["complete"] === true,
    },
  ];
}

function normalize_tool_status(value: unknown): AgentToolStatus[] {
  if (
    !is_json_record(value) ||
    typeof value["toolCallId"] !== "string" ||
    typeof value["toolName"] !== "string" ||
    (value["status"] !== "running" && value["status"] !== "success" && value["status"] !== "error")
  ) {
    return [];
  }
  return [
    {
      toolCallId: value["toolCallId"],
      toolName: value["toolName"],
      status: value["status"],
    },
  ];
}

function normalize_state(value: unknown): AgentSessionState {
  return value === "running" || value === "complete" ? value : "idle";
}

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
