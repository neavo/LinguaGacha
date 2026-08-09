import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AgentAssistantMessagePart,
  AgentEntry,
  AgentEntryStatus,
  AgentMessageInput,
  AgentSessionEvent,
  AgentSessionSnapshot,
  AgentSessionState,
  AgentSkillDisplayDescriptions,
  AgentSkillSnapshot,
  AgentToolEntry,
} from "@shared/agent";
import { AGENT_SESSION_EVENT_TOPIC, normalize_agent_message_input } from "@shared/agent";
import { LOCALES } from "@shared/i18n/types";
import { is_json_record, read_json_record, type JsonRecord } from "@domain/json";
import { api_fetch, api_get, open_event_stream } from "@frontend/app/desktop/desktop-api";
import { read_agent_input_history, update_agent_input_history } from "./agent-input-history";

/** 首帧占位不代表恢复成功；transport 在合法快照或明确失败后才离开 restoring。 */
const EMPTY_SNAPSHOT: AgentSessionSnapshot = {
  state: "idle",
  entries: [],
  skills: [],
  contextTokens: null,
};

/** 前端命令状态只表达当前互斥中的写请求，不复述后端会话状态。 */
export type AgentCommand = "send" | "stop" | "compact" | "reset" | null;
/** 传输状态独立于命令与回合结果，禁止一次性操作错误污染共享会话。 */
export type AgentTransportState = "restoring" | "ready" | "restore_failed" | "disconnected";

type AgentSessionStateView = {
  state: AgentSessionState;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  contextTokens: number | null;
  transport: AgentTransportState;
  command: AgentCommand;
  send: (message: AgentMessageInput) => Promise<void>;
  stop: () => Promise<void>;
  retryCompaction: () => Promise<void>;
  reset: () => Promise<void>;
  reconnect: () => void;
};

/** 跨路由保留完整输入事实；光标、菜单与历史索引仍由当前 Composer 持有。 */
export type AgentInputSession = {
  revision: number;
  read_draft: () => AgentMessageInput;
  write_draft: (draft: AgentMessageInput) => void;
  read_history: () => readonly string[];
};

/** 页面消费的完整 Agent 会话入口，输入事实与后端会话镜像共享同一生命周期。 */
export type AgentSessionController = AgentSessionStateView & {
  input: AgentInputSession;
};

/** null 默认值让越过应用装配边界的误用立即失败，不伪造可运行会话。 */
const AgentSessionContext = createContext<AgentSessionController | null>(null);

/**
 * 把 HTTP 快照与 SSE 增量合并为同一公开视图；Provider 决定它的跨路由生命周期。
 */
function useAgentSessionState(
  on_message_accepted: (message: AgentMessageInput) => void,
): AgentSessionStateView {
  const [snapshot, set_snapshot] = useState<AgentSessionSnapshot>(EMPTY_SNAPSHOT);
  const [transport, set_transport] = useState<AgentTransportState>("restoring");
  const [command, set_command] = useState<AgentCommand>(null);
  const [connection_revision, set_connection_revision] = useState(0); // 用户重试时重建整个传输 effect
  const loaded_once_ref = useRef(false); // 区分首次恢复失败与已恢复会话断线
  // 命令互斥必须同步生效；否则同一帧的重复调用会在 React 提交状态前穿透 UI 禁用态。
  const command_event_queue_ref = useRef<AgentSessionEvent[] | null>(null);

  useEffect(() => {
    let disposed = false;
    let event_source: EventSource | null = null;
    let syncing = false;
    let opened_once = false;
    const pending_events: AgentSessionEvent[] = [];
    /** 首次恢复失败与已有快照后的断线需要不同的页面恢复路径。 */
    const set_transport_failure = (): void => {
      set_transport(loaded_once_ref.current ? "disconnected" : "restore_failed");
    };

    /** 先订阅再拉快照，并按到达顺序重放同步窗口内的事件。 */
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
        loaded_once_ref.current = true;
        set_transport("ready");
      } catch {
        if (!disposed) {
          set_transport_failure();
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
            const command_events = command_event_queue_ref.current;
            if (command_events !== null) command_events.push(agent_event);
            else if (syncing) pending_events.push(agent_event);
            else set_snapshot((current) => apply_agent_event(current, agent_event));
          } catch {
            set_transport_failure();
            void sync_snapshot();
          }
        }) as EventListener);
        source.onopen = () => {
          if (opened_once) void sync_snapshot();
          opened_once = true;
        };
        source.onerror = set_transport_failure;
        void sync_snapshot();
      })
      .catch(() => {
        if (!disposed) {
          set_transport_failure();
        }
      });

    return () => {
      disposed = true;
      event_source?.close();
    };
  }, [connection_revision]);

  /** 同步取得命令互斥并建立 SSE 暂存队列，阻止同一渲染帧的重复提交。 */
  const begin_command = (next_command: Exclude<AgentCommand, null>): AgentSessionEvent[] | null => {
    if (command_event_queue_ref.current !== null) return null;
    const events: AgentSessionEvent[] = [];
    command_event_queue_ref.current = events;
    set_command(next_command);
    return events;
  };

  /** 用 HTTP ack 建立基线，再重放命令期间到达的 SSE，保证公开状态不倒退。 */
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

  /** 发送成功只表示后端已受理；模型回合结果继续由 snapshot / SSE 条目表达。 */
  const send = async (message: AgentMessageInput): Promise<void> => {
    if (transport === "restoring" || !loaded_once_ref.current || snapshot.state === "running") {
      return;
    }
    const normalized_message = normalize_agent_message_input(message);
    if (normalized_message === null) return;
    const command_events = begin_command("send");
    if (command_events === null) return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/message", normalized_message);
      finish_command(command_events, next);
      on_message_accepted(normalized_message);
    } catch (error) {
      finish_command(command_events);
      throw error;
    } finally {
      set_command(null);
    }
  };

  /** stop 失败保留仍在运行的权威快照，让用户可以继续尝试停止。 */
  const stop = async (): Promise<void> => {
    if (snapshot.state !== "running") return;
    const command_events = begin_command("stop");
    if (command_events === null) return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/stop");
      finish_command(command_events, next);
    } catch (error) {
      finish_command(command_events);
      throw error;
    } finally {
      set_command(null);
    }
  };

  /** 后端在压缩恢复成功后原子续跑失败任务，renderer 只应用权威快照与事件。 */
  const retry_compaction = async (): Promise<void> => {
    const command_events = begin_command("compact");
    if (command_events === null) return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/compaction/retry");
      finish_command(command_events, next);
    } catch (error) {
      finish_command(command_events);
      throw error;
    } finally {
      set_command(null);
    }
  };

  /** reset 只有收到合法权威快照才算成功，失败时保留当前对话。 */
  const reset = async (): Promise<void> => {
    const command_events = begin_command("reset");
    if (command_events === null) return;
    try {
      const next = await api_fetch<AgentSessionSnapshot>("/api/agent/reset");
      finish_command(command_events, next);
    } catch (error) {
      finish_command(command_events);
      throw error;
    } finally {
      set_command(null);
    }
  };

  /** 显式重试把 transport 置回 restoring，并推进 connection revision 重建传输。 */
  const reconnect = (): void => {
    set_transport("restoring");
    set_connection_revision((current) => current + 1);
  };

  return {
    state: snapshot.state,
    entries: snapshot.entries,
    skills: snapshot.skills,
    contextTokens: snapshot.contextTokens,
    transport,
    command,
    send,
    stop,
    retryCompaction: retry_compaction,
    reset,
    reconnect,
  };
}

/** 常驻拥有 Agent 传输镜像、命令和 renderer 私有输入会话，页面切换只替换消费者。 */
export function AgentSessionProvider(props: { children: ReactNode }): JSX.Element {
  // 草稿和历史用 ref 避免每次编辑重渲染整棵应用；revision 只通知受理后的原子清空。
  const draft_ref = useRef<AgentMessageInput>({ text: "", images: [] });
  const input_history_ref = useRef<string[] | null>(null);
  if (input_history_ref.current === null) {
    input_history_ref.current = read_agent_input_history(window.localStorage);
  }
  const [input_revision, set_input_revision] = useState(0);

  const read_draft = useCallback((): AgentMessageInput => draft_ref.current, []);
  const write_draft = useCallback((draft: AgentMessageInput): void => {
    draft_ref.current = draft;
  }, []);
  const read_history = useCallback((): readonly string[] => input_history_ref.current ?? [], []);
  const accept_message = useCallback((message: AgentMessageInput): void => {
    if (message.text !== "") {
      input_history_ref.current = update_agent_input_history(
        window.localStorage,
        input_history_ref.current ?? [],
        message.text,
      );
    }
    draft_ref.current = { text: "", images: [] };
    set_input_revision((current) => current + 1);
  }, []);

  const session = useAgentSessionState(accept_message);
  const input = useMemo<AgentInputSession>(
    () => ({
      revision: input_revision,
      read_draft,
      write_draft,
      read_history,
    }),
    [input_revision, read_draft, read_history, write_draft],
  );

  return (
    <AgentSessionContext.Provider value={{ ...session, input }}>
      {props.children}
    </AgentSessionContext.Provider>
  );
}

/** 只允许应用装配树内的页面消费共享会话，缺少 Provider 属于编程错误。 */
export function useAgentSession(): AgentSessionController {
  const session = useContext(AgentSessionContext);
  if (session === null) {
    throw new Error("useAgentSession must be used inside AgentSessionProvider.");
  }
  return session;
}

/** 按接收顺序重放命令期间积压的 SSE，保持条目覆盖与会话状态语义一致。 */
function replay_agent_events(
  snapshot: AgentSessionSnapshot,
  events: readonly AgentSessionEvent[],
): AgentSessionSnapshot {
  return events.reduce(apply_agent_event, snapshot);
}

/** 以完整条目按 id 覆盖；首次出现的位置就是后端确认的真实时序。 */
function apply_agent_event(
  snapshot: AgentSessionSnapshot,
  event: AgentSessionEvent,
): AgentSessionSnapshot {
  switch (event.type) {
    case "snapshot_seed":
      return normalize_snapshot(event.snapshot);
    case "session_state":
      return { ...snapshot, state: event.state };
    case "context_tokens":
      return { ...snapshot, contextTokens: event.contextTokens };
    case "entry_upsert": {
      const entries = [...snapshot.entries];
      const index = entries.findIndex((entry) => entry.id === event.entry.id);
      if (index < 0) entries.push(event.entry);
      else entries[index] = event.entry;
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
  const context_tokens = normalize_context_tokens(record["contextTokens"]);
  if (context_tokens === undefined) throw new TypeError("Agent snapshot contextTokens 非法");
  return { state, entries, skills, contextTokens: context_tokens };
}

/** SSE 顶层判别失败时丢弃单帧，重连仍会读取权威 snapshot。 */
function normalize_agent_event(value: unknown): AgentSessionEvent | null {
  const record = read_json_record(value);
  switch (record["type"]) {
    case "snapshot_seed":
      return { type: "snapshot_seed", snapshot: normalize_snapshot(record["snapshot"]) };
    case "session_state":
      return { type: "session_state", state: normalize_state(record["state"]) };
    case "context_tokens": {
      const context_tokens = normalize_context_tokens(record["contextTokens"]);
      return context_tokens === null || context_tokens === undefined
        ? null
        : { type: "context_tokens", contextTokens: context_tokens };
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
function normalize_context_tokens(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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
    const status = normalize_entry_status(value["status"]);
    const ended_at = value["endedAt"];
    if (
      status === null ||
      (ended_at !== null && (typeof ended_at !== "number" || !Number.isInteger(ended_at))) ||
      (status === "running") !== (ended_at === null)
    ) {
      return [];
    }
    const message = normalize_agent_message_input(value);
    if (message === null) return [];
    return [
      {
        kind: "user_message",
        id: value["id"],
        text: message.text,
        images: message.images,
        status,
        createdAt: value["createdAt"],
        endedAt: ended_at,
      },
    ];
  }
  if (value["kind"] === "assistant_message") {
    const status = normalize_entry_status(value["status"]);
    const parts = normalize_assistant_message_parts(value["parts"]);
    if (parts === null || status === null) return [];
    return [
      {
        kind: "assistant_message",
        id: value["id"],
        parts,
        status,
        createdAt: value["createdAt"],
      },
    ];
  }
  if (value["kind"] === "context_compaction") {
    const status = normalize_entry_status(value["status"]);
    if (status === null || status === "stopped") return [];
    return [
      {
        kind: "context_compaction",
        id: value["id"],
        status,
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
  const status = normalize_entry_status(value["status"]);
  if (
    status === null ||
    typeof value["toolName"] !== "string" ||
    typeof value["input"] !== "string"
  ) {
    return [];
  }
  const entry_base = {
    kind: "tool_call" as const,
    id: value["id"] as string,
    toolName: value["toolName"],
    input: value["input"],
    createdAt: value["createdAt"] as number,
  };
  if (status === "running" || status === "stopped") {
    if (value["output"] !== null) return [];
    return [{ ...entry_base, status, output: null }];
  }
  if (typeof value["output"] !== "string") return [];
  return [{ ...entry_base, status, output: value["output"] }];
}

/** 所有条目共享一个公开值域，kind 只决定字段形状，不建立平行状态词表。 */
function normalize_entry_status(value: unknown): AgentEntryStatus | null {
  return value === "running" || value === "success" || value === "error" || value === "stopped"
    ? value
    : null;
}

/** 完整快照不兼容旧会话状态，避免把协议错误伪装为空闲。 */
function normalize_state(value: unknown): AgentSessionState {
  if (value === "idle" || value === "running") return value;
  throw new TypeError("Agent snapshot state 非法");
}

/** skill snapshot 严格接纳新协议的完整 UI 描述，不兼容旧单数 description。 */
function normalize_skill(value: unknown): AgentSkillSnapshot[] {
  if (!is_json_record(value) || typeof value["name"] !== "string") return [];
  const raw_descriptions = value["displayDescriptions"];
  if (!is_json_record(raw_descriptions)) return [];
  const display_descriptions = {} as AgentSkillDisplayDescriptions;
  for (const locale of LOCALES) {
    const description = raw_descriptions[locale];
    if (typeof description !== "string" || description.trim() === "") return [];
    display_descriptions[locale] = description.trim();
  }
  return [{ name: value["name"], displayDescriptions: display_descriptions }];
}
