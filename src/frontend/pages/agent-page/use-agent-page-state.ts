import { useEffect, useRef, useState } from "react";

import type {
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
};

type UseAgentPageState = {
  state: AgentSessionState;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  loading: boolean;
  error: boolean;
  send: (parts: readonly AgentUserMessagePart[]) => Promise<boolean>;
  stop: () => Promise<void>;
};

/**
 * 持有 Agent 页面私有状态，并把 HTTP 快照与 SSE 增量合并为同一公开视图。
 */
export function useAgentPageState(): UseAgentPageState {
  const [snapshot, set_snapshot] = useState<AgentSessionSnapshot>(EMPTY_SNAPSHOT);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState(false);
  const request_failed_ref = useRef(false); // 重连只清除传输错误，不能吞掉尚未重试的命令失败

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

  const send = async (parts: readonly AgentUserMessagePart[]): Promise<boolean> => {
    if (snapshot.state === "running") return false;
    request_failed_ref.current = false;
    set_error(false);
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/message", {
        parts,
      });
      set_snapshot(normalize_snapshot(next));
      return true;
    } catch {
      request_failed_ref.current = true;
      set_error(true);
      return false;
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

  return {
    state: snapshot.state,
    entries: snapshot.entries,
    skills: snapshot.skills,
    loading,
    error,
    send,
    stop,
  };
}

/** 以完整条目按 id 覆盖；首次出现的位置就是后端确认的真实时序。 */
export function apply_agent_event(
  snapshot: AgentSessionSnapshot,
  event: AgentSessionEvent,
): AgentSessionSnapshot {
  if (event.type === "snapshot_seed") return normalize_snapshot(event.snapshot);
  if (event.type === "request_failed") return snapshot;
  if (event.type === "session_state") return { ...snapshot, state: event.state };
  const entries = [...snapshot.entries];
  const entry = structuredClone(event.entry);
  const index = entries.findIndex((entry) => entry.id === event.entry.id);
  if (index < 0) entries.push(entry);
  else entries[index] = entry;
  return { ...snapshot, entries };
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
  return { state, entries, skills };
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
  if (record["type"] === "entry_upsert") {
    const entry = normalize_entry(record["entry"])[0];
    return entry === undefined ? null : { type: "entry_upsert", entry };
  }
  return null;
}

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
    const parts = normalize_agent_user_message_parts(value["parts"]);
    if (parts === null || parts.length === 0) return [];
    return [
      {
        kind: "user_message",
        id: value["id"],
        parts,
        createdAt: value["createdAt"],
      },
    ];
  }
  if (value["kind"] === "assistant_message" && typeof value["text"] === "string") {
    return [
      {
        kind: "assistant_message",
        id: value["id"],
        text: value["text"],
        complete: value["complete"] === true,
        createdAt: value["createdAt"],
      },
    ];
  }
  if (value["kind"] === "tool_call") return normalize_tool_entry(value);
  return [];
}

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
