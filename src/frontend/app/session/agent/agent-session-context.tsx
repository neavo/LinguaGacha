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
  AgentEntry,
  AgentApprovalMode,
  AgentPendingWriteApproval,
  AgentPendingWriteSummary,
  AgentEntryStatus,
  AgentInputQueueSnapshot,
  AgentMessageInput,
  AgentQueuedInput,
  AgentSessionEvent,
  AgentSessionSnapshot,
  AgentSessionState,
  AgentSkillDisplayDescriptions,
  AgentSkillSnapshot,
  AgentToolEntry,
} from "@shared/agent";
import {
  AGENT_SESSION_EVENT_TOPIC,
  normalize_agent_assistant_message_parts,
  normalize_agent_message_input,
} from "@shared/agent";
import { LOCALES } from "@shared/i18n/types";
import { is_json_record, read_json_record, type JsonRecord } from "@domain/json";
import { api_fetch, api_get, open_event_stream } from "@frontend/app/desktop/desktop-api";
import {
  read_agent_input_history,
  replace_agent_input_history,
  update_agent_input_history,
} from "./agent-input-history";

/** 首帧占位不代表恢复成功；transport 在合法快照或明确失败后才离开 restoring。 */
const EMPTY_SNAPSHOT: AgentSessionSnapshot = {
  state: "idle",
  approvalMode: "manual",
  pendingWriteApproval: null,
  entries: [],
  skills: [],
  inputQueue: { paused: false, canSendNow: false, items: [] },
  taskProgress: [],
  contextTokens: null,
};

/** 前端命令状态只表达当前互斥中的写请求，不复述后端会话状态。 */
export type AgentCommand =
  | "send"
  | "revise"
  | "continue"
  | "stop"
  | "reset"
  | "queue_update"
  | "queue_delete"
  | "queue_reorder"
  | "queue_send"
  | "approval_mode"
  | "approval_decision"
  | null;
/** 传输状态独立于命令与回合结果，禁止一次性操作错误污染共享会话。 */
export type AgentTransportState = "restoring" | "ready" | "restore_failed" | "disconnected";

type AgentSessionStateView = {
  state: AgentSessionState;
  approvalMode: AgentApprovalMode;
  pendingWriteApproval: AgentPendingWriteApproval | null;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  inputQueue: AgentInputQueueSnapshot;
  taskProgress: string[];
  contextTokens: number | null;
  transport: AgentTransportState;
  command: AgentCommand;
  send: (message: AgentMessageInput) => Promise<void>;
  reviseLatestRound: (entryId: string, message: AgentMessageInput) => Promise<void>;
  updateQueuedMessage: (id: string, message: AgentMessageInput) => Promise<void>;
  deleteQueuedMessage: (id: string) => Promise<void>;
  reorderQueuedMessages: (ids: readonly string[]) => Promise<void>;
  sendQueuedMessage: (id: string) => Promise<void>;
  continue: (message?: AgentMessageInput) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  setApprovalMode: (approval_mode: AgentApprovalMode) => Promise<void>;
  approvePendingWrite: (switch_to_auto: boolean) => Promise<void>;
  rejectPendingWrite: () => Promise<void>;
  reconnect: () => void;
};

/** 跨路由保留普通 Composer 草稿与输入历史；行内修订草稿由目标组件短暂拥有。 */
export type AgentInputSession = {
  revision: number;
  read_draft: () => AgentMessageInput;
  write_draft: (draft: AgentMessageInput) => void;
  read_history: () => readonly string[];
  replace_history: (previous_text: string, next_text: string) => void;
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

  /** 所有窄命令共用 HTTP ack 与命令期间 SSE 重放，只保留各自前置条件和受理副作用。 */
  const execute_command = async (
    next_command: Exclude<AgentCommand, null>,
    request: () => Promise<AgentSessionSnapshot>,
    on_accepted?: () => void,
  ): Promise<void> => {
    const events = begin_command(next_command);
    if (events === null) return;
    try {
      const next = await request();
      finish_command(events, next);
      on_accepted?.();
    } catch (error) {
      finish_command(events);
      throw error;
    } finally {
      set_command(null);
    }
  };

  /** 发送成功只表示后端已受理；模型回合结果继续由 snapshot / SSE 条目表达。 */
  const send = async (message: AgentMessageInput): Promise<void> => {
    if (transport === "restoring" || !loaded_once_ref.current) {
      return;
    }
    const normalized_message = normalize_agent_message_input(message);
    if (normalized_message === null) return;
    await execute_command(
      "send",
      () => api_fetch<AgentSessionSnapshot>("/api/agent/message", normalized_message),
      () => on_message_accepted(normalized_message),
    );
  };

  /** 队列修改复用消息规范化与统一命令回放。 */
  const update_queued_message = async (id: string, message: AgentMessageInput): Promise<void> => {
    const normalized_message = normalize_agent_message_input(message);
    if (normalized_message === null) return;
    await execute_command("queue_update", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/queue/update", {
        id,
        message: normalized_message,
      }),
    );
  };

  /** 删除命令只提交稳定身份，权威队列由 ack 与 SSE 决定。 */
  const delete_queued_message = async (id: string): Promise<void> => {
    await execute_command("queue_delete", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/queue/delete", { id }),
    );
  };

  /** renderer 只提交完整身份排列，不在本地乐观改写顺序。 */
  const reorder_queued_messages = async (ids: readonly string[]): Promise<void> => {
    await execute_command("queue_reorder", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/queue/reorder", { ids: [...ids] }),
    );
  };

  /** 立即发送由后端判断走空闲 round 还是运行中 Pi steer。 */
  const send_queued_message = async (id: string): Promise<void> => {
    await execute_command("queue_send", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/queue/send", { id }),
    );
  };

  /** 修订成功后才恢复普通草稿并更新 user 输入历史；相同输入表示重试。 */
  const revise_latest_round = async (
    entry_id: string,
    message: AgentMessageInput,
  ): Promise<void> => {
    if (transport === "restoring" || !loaded_once_ref.current || snapshot.state === "running") {
      return;
    }
    const normalized_message = normalize_agent_message_input(message);
    if (normalized_message === null) return;
    await execute_command("revise", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/round/revise", {
        entryId: entry_id,
        message: normalized_message,
      }),
    );
  };

  /** 空 continue 不制造消息；可选消息由后端原子追加队尾后再恢复。 */
  const continue_session = async (message?: AgentMessageInput): Promise<void> => {
    if (transport === "restoring" || !loaded_once_ref.current || snapshot.state === "running") {
      return;
    }
    let normalized_message: AgentMessageInput | undefined;
    if (message !== undefined) {
      const candidate = normalize_agent_message_input(message);
      if (candidate === null) return;
      normalized_message = candidate;
    }
    await execute_command(
      "continue",
      () =>
        api_fetch<AgentSessionSnapshot>(
          "/api/agent/continue",
          normalized_message === undefined ? {} : { message: normalized_message },
        ),
      normalized_message === undefined ? undefined : () => on_message_accepted(normalized_message),
    );
  };

  /** stop 失败保留仍在运行的权威快照，让用户可以继续尝试停止。 */
  const stop = async (): Promise<void> => {
    if (snapshot.state !== "running") return;
    await execute_command("stop", () => api_fetch<AgentSessionSnapshot>("/api/agent/stop"));
  };

  /** reset 只有收到合法权威快照才算成功，失败时保留当前对话。 */
  const reset = async (): Promise<void> => {
    await execute_command("reset", () => api_fetch<AgentSessionSnapshot>("/api/agent/reset"));
  };

  /** 写入审批模式由后端确认并通过 ack / SSE 回流，页面不做本地乐观切换。 */
  const set_approval_mode = async (approval_mode: AgentApprovalMode): Promise<void> => {
    await execute_command("approval_mode", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/approval-mode", { approvalMode: approval_mode }),
    );
  };

  /** 以 snapshot 中冻结的审批 ID 确认当前写入，避免页面自行猜测状态。 */
  const approve_pending_write = async (switch_to_auto: boolean): Promise<void> => {
    const pending = snapshot.pendingWriteApproval;
    if (pending === null) return;
    await execute_command("approval_decision", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/approval/approve", {
        id: pending.id,
        switchToAuto: switch_to_auto,
      }),
    );
  };

  /** 以 snapshot 中冻结的审批 ID 拒绝当前写入，工具终态继续由后端事件同步。 */
  const reject_pending_write = async (): Promise<void> => {
    const pending = snapshot.pendingWriteApproval;
    if (pending === null) return;
    await execute_command("approval_decision", () =>
      api_fetch<AgentSessionSnapshot>("/api/agent/approval/reject", { id: pending.id }),
    );
  };

  /** 显式重试把 transport 置回 restoring，并推进 connection revision 重建传输。 */
  const reconnect = (): void => {
    set_transport("restoring");
    set_connection_revision((current) => current + 1);
  };

  return {
    state: snapshot.state,
    approvalMode: snapshot.approvalMode,
    pendingWriteApproval: snapshot.pendingWriteApproval,
    entries: snapshot.entries,
    skills: snapshot.skills,
    inputQueue: snapshot.inputQueue,
    taskProgress: snapshot.taskProgress,
    contextTokens: snapshot.contextTokens,
    transport,
    command,
    send,
    reviseLatestRound: revise_latest_round,
    updateQueuedMessage: update_queued_message,
    deleteQueuedMessage: delete_queued_message,
    reorderQueuedMessages: reorder_queued_messages,
    sendQueuedMessage: send_queued_message,
    continue: continue_session,
    stop,
    reset,
    setApprovalMode: set_approval_mode,
    approvePendingWrite: approve_pending_write,
    rejectPendingWrite: reject_pending_write,
    reconnect,
  };
}

/** 常驻拥有 Agent 传输镜像、命令和 renderer 私有输入会话，页面切换只替换消费者。 */
export function AgentSessionProvider(props: { children: ReactNode }): JSX.Element {
  // 普通草稿和输入历史跨路由保留；历史/队列修订拥有各自的行内草稿，不再占用这里的值。
  const draft_ref = useRef<AgentMessageInput>({ text: "", attachments: [] });
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
  /** 页面原位编辑成功后显式替换对应 user / 队列文本，不改变普通 Composer 草稿。 */
  const replace_history = useCallback((previous_text: string, next_text: string): void => {
    input_history_ref.current = replace_agent_input_history(
      window.localStorage,
      input_history_ref.current ?? [],
      previous_text,
      next_text,
    );
  }, []);
  /** 普通消息受理后更新辅助历史并清空唯一草稿。 */
  const accept_message = useCallback((message: AgentMessageInput): void => {
    if (message.text !== "") {
      input_history_ref.current = update_agent_input_history(
        window.localStorage,
        input_history_ref.current ?? [],
        message.text,
      );
    }
    draft_ref.current = { text: "", attachments: [] };
    set_input_revision((current) => current + 1);
  }, []);

  /** 后端会话镜像与跨路由普通草稿共享生命周期；历史修订草稿由行内编辑器拥有。 */
  const session = useAgentSessionState(accept_message);
  const input = useMemo<AgentInputSession>(
    () => ({
      revision: input_revision,
      read_draft,
      write_draft,
      read_history,
      replace_history,
    }),
    [input_revision, read_draft, read_history, replace_history, write_draft],
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
    case "approval_mode":
      return { ...snapshot, approvalMode: event.approvalMode };
    case "pending_write_approval":
      return { ...snapshot, pendingWriteApproval: event.pendingWriteApproval };
    case "input_queue":
      return { ...snapshot, inputQueue: event.inputQueue };
    case "task_progress":
      return { ...snapshot, taskProgress: event.taskProgress };
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
  const approval_mode = normalize_approval_mode(record["approvalMode"]);
  const pending_write_approval = normalize_pending_write_approval(record["pendingWriteApproval"]);
  const entries = Array.isArray(record["entries"])
    ? record["entries"].flatMap(normalize_entry)
    : [];
  const skills = Array.isArray(record["skills"]) ? record["skills"].flatMap(normalize_skill) : [];
  const input_queue = normalize_input_queue(record["inputQueue"]);
  const task_progress = normalize_task_progress(record["taskProgress"]);
  const context_tokens = normalize_context_tokens(record["contextTokens"]);
  if (
    approval_mode === null ||
    pending_write_approval === undefined ||
    input_queue === null ||
    task_progress === null ||
    context_tokens === undefined
  ) {
    throw new TypeError("Agent snapshot is invalid.");
  }
  return {
    state,
    approvalMode: approval_mode,
    pendingWriteApproval: pending_write_approval,
    entries,
    skills,
    inputQueue: input_queue,
    taskProgress: task_progress,
    contextTokens: context_tokens,
  };
}

/** SSE 顶层判别失败时丢弃单帧，重连仍会读取权威 snapshot。 */
function normalize_agent_event(value: unknown): AgentSessionEvent | null {
  const record = read_json_record(value);
  switch (record["type"]) {
    case "snapshot_seed":
      return { type: "snapshot_seed", snapshot: normalize_snapshot(record["snapshot"]) };
    case "session_state":
      return { type: "session_state", state: normalize_state(record["state"]) };
    case "approval_mode": {
      const approval_mode = normalize_approval_mode(record["approvalMode"]);
      return approval_mode === null ? null : { type: "approval_mode", approvalMode: approval_mode };
    }
    case "pending_write_approval": {
      const pending_write_approval = normalize_pending_write_approval(
        record["pendingWriteApproval"],
      );
      return pending_write_approval === undefined
        ? null
        : { type: "pending_write_approval", pendingWriteApproval: pending_write_approval };
    }
    case "input_queue": {
      const input_queue = normalize_input_queue(record["inputQueue"]);
      return input_queue === null ? null : { type: "input_queue", inputQueue: input_queue };
    }
    case "task_progress": {
      const task_progress = normalize_task_progress(record["taskProgress"]);
      return task_progress === null ? null : { type: "task_progress", taskProgress: task_progress };
    }
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

/** 待办标签必须完整可信；空数组表示固定展示位隐藏。 */
function normalize_task_progress(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string" && item.trim() !== "") ? [...value] : null;
}

/** 队列快照整体替换；任何非法项都会拒绝该快照，避免局部重排破坏身份。 */
function normalize_input_queue(value: unknown): AgentInputQueueSnapshot | null {
  if (
    !is_json_record(value) ||
    typeof value["paused"] !== "boolean" ||
    typeof value["canSendNow"] !== "boolean" ||
    !Array.isArray(value["items"])
  ) {
    return null;
  }
  const items: AgentQueuedInput[] = [];
  for (const candidate of value["items"]) {
    if (
      !is_json_record(candidate) ||
      typeof candidate["id"] !== "string" ||
      (candidate["status"] !== "queued" && candidate["status"] !== "sending") ||
      typeof candidate["createdAt"] !== "number" ||
      !Number.isInteger(candidate["createdAt"])
    ) {
      return null;
    }
    const message = normalize_agent_message_input(candidate);
    if (message === null) return null;
    items.push({
      ...message,
      id: candidate["id"],
      status: candidate["status"],
      createdAt: candidate["createdAt"],
    });
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) return null;
  return { paused: value["paused"], canSendNow: value["canSendNow"], items };
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
    const message = normalize_agent_message_input(value);
    if (status === null || message === null) return [];
    const base = {
      kind: "user_message" as const,
      id: value["id"],
      text: message.text,
      attachments: message.attachments,
      createdAt: value["createdAt"],
    };
    if (value["delivery"] === "steer") {
      if (status !== "success" || typeof ended_at !== "number" || !Number.isInteger(ended_at)) {
        return [];
      }
      return [{ ...base, delivery: "steer", status: "success", endedAt: ended_at }];
    }
    if (
      value["delivery"] !== "round" ||
      (ended_at !== null && (typeof ended_at !== "number" || !Number.isInteger(ended_at))) ||
      (status === "running") !== (ended_at === null)
    ) {
      return [];
    }
    return [{ ...base, delivery: "round", status, endedAt: ended_at }];
  }
  if (value["kind"] === "assistant_message") {
    const status = normalize_entry_status(value["status"]);
    const parts = normalize_agent_assistant_message_parts(value["parts"]);
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
  throw new TypeError("Agent snapshot state is invalid.");
}

/** 审批模式是公开协议窄枚举，快照与增量使用同一严格值域。 */
function normalize_approval_mode(value: unknown): AgentApprovalMode | null {
  return value === "manual" || value === "auto" ? value : null;
}

/** 待审批状态只接纳控制面 ID、阶段与后端生成的变更摘要，不进入时间线。 */
function normalize_pending_write_approval(
  value: unknown,
): AgentPendingWriteApproval | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!is_json_record(value)) return undefined;
  const id = value["id"];
  const status = value["status"];
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    (status !== "waiting" && status !== "processing")
  ) {
    return undefined;
  }
  const raw_summary = value["summary"];
  if (!is_json_record(raw_summary)) return undefined;
  const items = raw_summary["items"];
  const glossary = raw_summary["glossary"];
  const text_preserve = raw_summary["textPreserve"];
  const pre_replacement = raw_summary["preReplacement"];
  const post_replacement = raw_summary["postReplacement"];
  const prompts = raw_summary["prompts"];
  if (
    ![items, glossary, text_preserve, pre_replacement, post_replacement, prompts].every(
      (count) => typeof count === "number" && Number.isInteger(count) && count >= 0,
    ) ||
    (items as number) +
      (glossary as number) +
      (text_preserve as number) +
      (pre_replacement as number) +
      (post_replacement as number) +
      (prompts as number) ===
      0
  ) {
    return undefined;
  }
  const summary: AgentPendingWriteSummary = {
    items: items as number,
    glossary: glossary as number,
    textPreserve: text_preserve as number,
    preReplacement: pre_replacement as number,
    postReplacement: post_replacement as number,
    prompts: prompts as number,
  };
  return { id, status, summary };
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
