import type {
  AgentApprovalMode,
  AgentCommandAck,
  AgentContextSnapshot,
  AgentEntry,
  AgentEntryStatus,
  AgentInputQueueSnapshot,
  AgentMessageInput,
  AgentPendingDecision,
  AgentPendingWriteSummary,
  AgentQuestion,
  AgentQuestionResponse,
  AgentQueuedInput,
  AgentSessionEvent,
  AgentSessionSnapshot,
  AgentSessionState,
  AgentSkillDisplayDescriptions,
  AgentSkillSnapshot,
  AgentToolEntry,
  AgentWriteApprovalDecision,
} from "@shared/agent";
import {
  AGENT_QUESTION_DESCRIPTION_LIMIT,
  AGENT_QUESTION_LABEL_LIMIT,
  AGENT_QUESTION_OPTION_MAX,
  AGENT_QUESTION_OPTION_MIN,
  AGENT_QUESTION_PROMPT_LIMIT,
  AGENT_SESSION_EVENT_TOPIC,
  normalize_agent_assistant_message_parts,
  normalize_agent_message_input,
} from "@shared/agent";
import { normalize_agent_todos } from "@shared/agent-todo";
import { is_json_record, read_json_record, type JsonRecord } from "@domain/json";
import { LOCALES } from "@shared/i18n/types";
import { api_fetch, api_get, open_event_stream } from "@frontend/app/desktop/desktop-api";
import {
  read_agent_input_history,
  replace_agent_input_history,
  update_agent_input_history,
} from "./agent-input-history";
import {
  AgentDecisionCountdown,
  type AgentDecisionCountdownSnapshot,
  AGENT_QUESTION_DEFAULT_OPTION_INDEX,
  AGENT_WRITE_APPROVAL_DEFAULT,
} from "./agent-decision-countdown";

export type AgentCommand =
  | "send"
  | "revise"
  | "continue"
  | "compact"
  | "stop"
  | "reset"
  | "queue_update"
  | "queue_delete"
  | "queue_reorder"
  | "queue_send"
  | "approval_mode"
  | "decision"
  | null;

export type AgentTransportState = "restoring" | "ready" | "restore_failed" | "disconnected";

export type AgentTimelineSlice = Readonly<{ entries: readonly AgentEntry[] }>;

export type AgentControlsSlice = Readonly<{
  state: AgentSessionState;
  approvalMode: AgentApprovalMode;
  pendingDecision: AgentPendingDecision | null;
  context: AgentContextSnapshot;
  transport: AgentTransportState;
  command: AgentCommand;
}>;

export type AgentQueueSlice = Readonly<{ inputQueue: AgentInputQueueSnapshot }>;
export type AgentTodoSlice = Readonly<{ todos: readonly string[] }>;
export type AgentSkillsSlice = Readonly<{ skills: readonly AgentSkillSnapshot[] }>;

export type AgentInputSession = {
  revision: number;
  read_draft: () => AgentMessageInput;
  write_draft: (draft: AgentMessageInput) => void;
  read_history: () => readonly string[];
  replace_history: (previous_text: string, next_text: string) => void;
};

export type AgentSessionActions = Readonly<{
  send: (message: AgentMessageInput) => Promise<void>;
  reviseLatestRound: (entryId: string, message: AgentMessageInput) => Promise<void>;
  updateQueuedMessage: (id: string, message: AgentMessageInput) => Promise<void>;
  deleteQueuedMessage: (id: string) => Promise<void>;
  reorderQueuedMessages: (ids: readonly string[]) => Promise<void>;
  sendQueuedMessage: (id: string) => Promise<void>;
  continue: (message?: AgentMessageInput) => Promise<void>;
  compactContext: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  setApprovalMode: (approval_mode: AgentApprovalMode) => Promise<void>;
  resolveQuestion: (response: AgentQuestionResponse) => Promise<void>;
  resolveWriteApproval: (decision: AgentWriteApprovalDecision) => Promise<void>;
  setQuestionFocused: (id: string, focused: boolean) => void;
  reconnect: () => void;
}>;

type StoreSlice = "timeline" | "controls" | "queue" | "todo" | "skills" | "input" | "countdown";
type Listener = () => void;
type CommandEventQueue = { base_revision: number; events: AgentSessionEvent[] };

const EMPTY_TIMELINE: AgentTimelineSlice = { entries: [] };
const EMPTY_CONTROLS: AgentControlsSlice = {
  state: "idle",
  approvalMode: "manual",
  pendingDecision: null,
  context: { tokens: null, compactable: false, limits: null },
  transport: "restoring",
  command: null,
};
const EMPTY_QUEUE: AgentQueueSlice = {
  inputQueue: { paused: false, canSendNow: false, items: [] },
};
const EMPTY_TODO: AgentTodoSlice = { todos: [] };
const EMPTY_SKILLS: AgentSkillsSlice = { skills: [] };

/** renderer 侧唯一 Agent 会话镜像；后端事实经 revision 校验进入切片，本地决策时钟独立发布。 */
export class AgentSessionStore {
  private timeline = EMPTY_TIMELINE;
  private controls = EMPTY_CONTROLS;
  private queue = EMPTY_QUEUE;
  private todo = EMPTY_TODO;
  private skills = EMPTY_SKILLS;
  private input: AgentInputSession;
  private revision = 0;
  private loaded_once = false;
  private connection_generation = 0; // 每次连接或断开都推进，隔离迟到的 SSE / snapshot 异步结果
  private event_source: EventSource | null = null;
  private restoring_generation: number | null = null; // 同一连接世代只允许一个 snapshot 恢复请求
  private pending_events: AgentSessionEvent[] = []; // snapshot 期间暂存，成功后按 revision 重放
  private command_events: CommandEventQueue | null = null;
  private draft: AgentMessageInput = { text: "", attachments: [] };
  private input_history: string[];
  private readonly listeners: Record<StoreSlice, Set<Listener>> = {
    timeline: new Set(),
    controls: new Set(),
    queue: new Set(),
    todo: new Set(),
    skills: new Set(),
    input: new Set(),
    countdown: new Set(),
  };
  private readonly countdown: AgentDecisionCountdown;
  private readonly on_decision_error: (error: unknown) => void;
  private readonly storage: Storage;

  public readonly actions: AgentSessionActions;

  /** 建立稳定的命令入口与草稿会话，连接由生命周期入口启动。 */
  public constructor(storage: Storage, on_decision_error: (error: unknown) => void) {
    this.storage = storage;
    this.on_decision_error = on_decision_error;
    this.countdown = new AgentDecisionCountdown(
      () => this.emit("countdown"),
      (decision) => {
        // 到期回调绑定原问题，复用手动提交的命令槽和错误反馈。
        const current = this.controls.pendingDecision;
        if (current?.id !== decision.id || current.kind !== decision.kind) return;
        if (decision.kind === "question") {
          void this.resolve_question({
            kind: "option",
            optionId: decision.question.options[AGENT_QUESTION_DEFAULT_OPTION_INDEX].id,
          });
        } else {
          void this.resolve_write_approval(AGENT_WRITE_APPROVAL_DEFAULT);
        }
      },
    );
    this.input_history = read_agent_input_history(storage);
    this.input = this.create_input_session(0);
    this.actions = {
      send: this.send,
      reviseLatestRound: this.revise_latest_round,
      updateQueuedMessage: this.update_queued_message,
      deleteQueuedMessage: this.delete_queued_message,
      reorderQueuedMessages: this.reorder_queued_messages,
      sendQueuedMessage: this.send_queued_message,
      continue: this.continue_session,
      compactContext: this.compact_context,
      stop: this.stop,
      reset: this.reset,
      setApprovalMode: this.set_approval_mode,
      resolveQuestion: this.resolve_question,
      resolveWriteApproval: this.resolve_write_approval,
      setQuestionFocused: (id, focused) => this.countdown.set_focused(id, focused),
      reconnect: this.reconnect,
    };
  }

  /** 返回时间线缓存，供独立消息区订阅。 */
  public readonly get_timeline = (): AgentTimelineSlice => this.timeline;
  /** 返回后端控制事实与前端命令占用。 */
  public readonly get_controls = (): AgentControlsSlice => this.controls;
  /** 返回后端拥有的输入队列快照。 */
  public readonly get_queue = (): AgentQueueSlice => this.queue;
  /** 返回当前会话任务步骤。 */
  public readonly get_todo = (): AgentTodoSlice => this.todo;
  /** 返回当前可用技能集合。 */
  public readonly get_skills = (): AgentSkillsSlice => this.skills;
  /** 返回跨路由稳定的草稿与历史入口。 */
  public readonly get_input = (): AgentInputSession => this.input;
  /** 返回前端时钟缓存，隔离每秒更新。 */
  public readonly get_countdown = (): AgentDecisionCountdownSnapshot => this.countdown.read();
  /** 只通知决策区域的时钟变化。 */
  public readonly subscribe_countdown = (listener: Listener): (() => void) =>
    this.subscribe("countdown", listener);

  /** 只通知消息与工具条目变化。 */
  public readonly subscribe_timeline = (listener: Listener): (() => void) =>
    this.subscribe("timeline", listener);
  /** 只通知运行、连接和命令控制变化。 */
  public readonly subscribe_controls = (listener: Listener): (() => void) =>
    this.subscribe("controls", listener);
  /** 只通知队列顺序与能力变化。 */
  public readonly subscribe_queue = (listener: Listener): (() => void) =>
    this.subscribe("queue", listener);
  /** 只通知任务步骤变化。 */
  public readonly subscribe_todo = (listener: Listener): (() => void) =>
    this.subscribe("todo", listener);
  /** 只通知技能集合变化。 */
  public readonly subscribe_skills = (listener: Listener): (() => void) =>
    this.subscribe("skills", listener);
  /** 只通知输入会话版本变化。 */
  public readonly subscribe_input = (listener: Listener): (() => void) =>
    this.subscribe("input", listener);

  /** Provider 挂载后先建立并订阅 SSE，再读取 snapshot；重复连接会令旧异步结果失效。 */
  public connect(): void {
    const generation = ++this.connection_generation;
    this.event_source?.close();
    this.event_source = null;
    this.restoring_generation = null;
    this.pending_events = [];
    this.set_controls({ transport: "restoring" });
    void this.connect_event_stream(generation);
  }

  /** effect cleanup 只断开当前连接，Store 可被 StrictMode 的下一次 effect 重新连接。 */
  public disconnect(): void {
    this.connection_generation += 1;
    this.restoring_generation = null;
    this.pending_events = [];
    this.event_source?.close();
    this.event_source = null;
    this.sync_countdown();
  }

  /** 连接世代阻止断开或重连前的迟到响应覆盖当前会话。 */
  private is_current(generation: number): boolean {
    return generation === this.connection_generation;
  }

  /** 拿到 EventSource 后立即挂载事件监听，再读取 snapshot，避免恢复窗口丢失增量。 */
  private async connect_event_stream(generation: number): Promise<void> {
    try {
      const source = open_event_stream();
      if (!this.is_current(generation)) {
        source.close();
        return;
      }
      this.event_source = source;
      let opened_once = false;
      source.addEventListener(AGENT_SESSION_EVENT_TOPIC, ((message: MessageEvent<string>) =>
        this.receive_message(message, generation)) as EventListener);
      source.onopen = () => {
        if (!this.is_current(generation)) return;
        if (opened_once) void this.restore_snapshot(generation);
        opened_once = true;
      };
      source.onerror = () => {
        if (this.is_current(generation)) this.set_transport_failure();
      };
      await this.restore_snapshot(generation);
    } catch {
      if (this.is_current(generation)) this.set_transport_failure();
    }
  }

  /** 按消费切片订阅，并返回同一监听器的清理入口。 */
  private subscribe(slice: StoreSlice, listener: Listener): () => void {
    this.listeners[slice].add(listener);
    return () => this.listeners[slice].delete(listener);
  }

  /** 只通知受影响的切片订阅者。 */
  private emit(slice: StoreSlice): void {
    for (const listener of this.listeners[slice]) listener();
  }

  /** 控制事实发生变化时才发布新切片，保留无变化引用。 */
  private set_controls(patch: Partial<AgentControlsSlice>): void {
    const next = { ...this.controls, ...patch };
    if (
      next.state === this.controls.state &&
      next.approvalMode === this.controls.approvalMode &&
      next.pendingDecision === this.controls.pendingDecision &&
      next.context.tokens === this.controls.context.tokens &&
      next.context.compactable === this.controls.context.compactable &&
      next.context.limits?.context_window === this.controls.context.limits?.context_window &&
      next.context.limits?.max_output_tokens === this.controls.context.limits?.max_output_tokens &&
      next.transport === this.controls.transport &&
      next.command === this.controls.command
    ) {
      return;
    }
    this.controls = next;
    this.sync_countdown();
    this.emit("controls");
  }

  /** 后端决定与连接、命令状态在此汇合，逐秒展示只通知 countdown 消费者。 */
  private sync_countdown(): void {
    this.countdown.sync(
      this.controls.pendingDecision,
      this.event_source !== null &&
        this.restoring_generation === null &&
        this.controls.transport === "ready" &&
        this.controls.command === null,
    );
  }

  /** 按连接世代接收事件，命令与恢复期间暂存，缺口触发快照恢复。 */
  private receive_message(message: MessageEvent<string>, generation: number): void {
    if (!this.is_current(generation)) return;
    try {
      const event = normalize_agent_event(JSON.parse(message.data) as unknown);
      if (event === null) return;
      if (this.command_events !== null) {
        this.command_events.events.push(event);
      } else if (this.restoring_generation === generation) {
        this.pending_events.push(event);
      } else if (!this.apply_event(event)) {
        this.pending_events.push(event);
        void this.restore_snapshot(generation);
      }
    } catch {
      this.set_transport_failure();
      void this.restore_snapshot(generation);
    }
  }

  /** 首次恢复失败与已连接后的断线具有不同的页面恢复语义。 */
  private readonly set_transport_failure = (): void => {
    this.set_controls({ transport: this.loaded_once ? "disconnected" : "restore_failed" });
  };

  /** 完整 snapshot 在 SSE 监听就绪后读取；恢复期间事件暂存，成功后按 revision 重放。 */
  private async restore_snapshot(generation: number): Promise<void> {
    if (!this.is_current(generation) || this.restoring_generation === generation) return;
    this.restoring_generation = generation;
    this.sync_countdown();
    try {
      const snapshot = normalize_snapshot(
        await api_get<AgentSessionSnapshot>("/api/agent/snapshot"),
      );
      if (!this.is_current(generation)) return;
      this.apply_snapshot(snapshot);
      const events = this.pending_events
        .splice(0)
        .sort((left, right) => left.revision - right.revision);
      if (!this.apply_events(events)) {
        throw new TypeError("Agent session event revision gap remains after snapshot recovery.");
      }
      this.loaded_once = true;
      this.set_controls({ transport: "ready" });
    } catch {
      if (this.is_current(generation)) this.set_transport_failure();
    } finally {
      if (this.restoring_generation === generation) this.restoring_generation = null;
      this.sync_countdown();
    }
  }

  /** 旧快照不得覆盖已确认的新投影；合法恢复一次性替换完整业务切片。 */
  private apply_snapshot(snapshot: AgentSessionSnapshot): void {
    if (snapshot.revision < this.revision) return;
    this.revision = snapshot.revision;
    this.timeline = { entries: snapshot.entries };
    this.queue = { inputQueue: snapshot.inputQueue };
    this.todo = { todos: snapshot.todos };
    this.skills = { skills: snapshot.skills };
    this.controls = {
      ...this.controls,
      state: snapshot.state,
      approvalMode: snapshot.approvalMode,
      pendingDecision: snapshot.pendingDecision,
      context: snapshot.context,
    };
    this.sync_countdown();
    this.emit("timeline");
    this.emit("queue");
    this.emit("todo");
    this.emit("skills");
    this.emit("controls");
  }

  /** 顺序重放事件，遇到首个修订缺口交由快照恢复。 */
  private apply_events(events: readonly AgentSessionEvent[]): boolean {
    for (const event of events) {
      if (!this.apply_event(event)) return false;
    }
    return true;
  }

  /** 返回 false 表示发现 revision 缺口，调用方必须转入完整快照恢复。 */
  private apply_event(event: AgentSessionEvent): boolean {
    if (event.revision <= this.revision) return true;
    if (event.revision !== this.revision + 1) return false;
    if (event.type === "snapshot_seed") {
      this.apply_snapshot(event.snapshot);
      return true;
    }

    this.revision = event.revision;
    switch (event.type) {
      case "session_state":
        this.set_controls({ state: event.state });
        break;
      case "approval_mode":
        this.set_controls({ approvalMode: event.approvalMode });
        break;
      case "pending_decision":
        this.set_controls({ pendingDecision: event.pendingDecision });
        break;
      case "context":
        this.set_controls({ context: event.context });
        break;
      case "input_queue":
        this.queue = { inputQueue: event.inputQueue };
        this.emit("queue");
        break;
      case "todo":
        this.todo = { todos: event.todos };
        this.emit("todo");
        break;
      case "entry_upsert": {
        const entries = [...this.timeline.entries];
        const index = entries.findIndex((entry) => entry.id === event.entry.id);
        if (index < 0) entries.push(event.entry);
        else entries[index] = event.entry;
        this.timeline = { entries };
        this.emit("timeline");
        break;
      }
    }
    return true;
  }

  /** 同步占用唯一命令槽，并记录受理期间的事件基线。 */
  private begin_command(command: Exclude<AgentCommand, null>): CommandEventQueue | null {
    if (this.command_events !== null) return null;
    const queue = { base_revision: this.revision, events: [] };
    this.command_events = queue;
    this.set_controls({ command });
    return queue;
  }

  /** 先重放命令期事件，再用 ack 判断是否需要补取权威快照。 */
  private async finish_command(
    queue: CommandEventQueue,
    acknowledgement?: AgentCommandAck,
  ): Promise<void> {
    if (this.command_events !== queue) return;
    this.command_events = null;
    const events = queue.events.sort((left, right) => left.revision - right.revision);
    const continuous = this.apply_events(events);
    const acknowledgement_valid =
      acknowledgement === undefined || acknowledgement.revision >= queue.base_revision;
    const acknowledgement_reached =
      acknowledgement === undefined || acknowledgement.revision <= this.revision;
    if (!continuous || !acknowledgement_reached) {
      this.pending_events.push(...events.filter((event) => event.revision > this.revision));
      await this.restore_snapshot(this.connection_generation);
    }
    if (!acknowledgement_valid) throw new TypeError("Agent command acknowledgement is stale.");
  }

  /** 统一命令占用、ack 校验与失败收尾，成功后执行页面受理动作。 */
  private async execute_command(
    command: Exclude<AgentCommand, null>,
    request: () => Promise<AgentCommandAck>,
    on_accepted?: () => void,
  ): Promise<void> {
    const queue = this.begin_command(command);
    if (queue === null) return;
    try {
      const acknowledgement = normalize_acknowledgement(await request());
      await this.finish_command(queue, acknowledgement);
      on_accepted?.();
    } catch (error) {
      await this.finish_command(queue);
      throw error;
    } finally {
      this.set_controls({ command: null });
    }
  }

  /** 规范输入，命令受理成功后再清理草稿并记录历史。 */
  private readonly send = async (message: AgentMessageInput): Promise<void> => {
    if (this.controls.transport === "restoring" || !this.loaded_once) return;
    const normalized = normalize_agent_message_input(message);
    if (normalized === null) return;
    await this.execute_command(
      "send",
      () => api_fetch<AgentCommandAck>("/api/agent/message", normalized),
      () => this.accept_message(normalized),
    );
  };

  /** 规范替换内容，队列事实由后端事件更新。 */
  private readonly update_queued_message = async (
    id: string,
    message: AgentMessageInput,
  ): Promise<void> => {
    const normalized = normalize_agent_message_input(message);
    if (normalized === null) return;
    await this.execute_command("queue_update", () =>
      api_fetch<AgentCommandAck>("/api/agent/queue/update", { id, message: normalized }),
    );
  };

  /** 提交删除意图，等待后端发布新队列。 */
  private readonly delete_queued_message = async (id: string): Promise<void> => {
    await this.execute_command("queue_delete", () =>
      api_fetch<AgentCommandAck>("/api/agent/queue/delete", { id }),
    );
  };

  /** 复制顺序载荷，避免调用者后续修改影响请求。 */
  private readonly reorder_queued_messages = async (ids: readonly string[]): Promise<void> => {
    await this.execute_command("queue_reorder", () =>
      api_fetch<AgentCommandAck>("/api/agent/queue/reorder", { ids: [...ids] }),
    );
  };

  /** 请求立即发送队列项，发送状态由后端裁决。 */
  private readonly send_queued_message = async (id: string): Promise<void> => {
    await this.execute_command("queue_send", () =>
      api_fetch<AgentCommandAck>("/api/agent/queue/send", { id }),
    );
  };

  /** 仅在已恢复的空闲会话提交修订内容。 */
  private readonly revise_latest_round = async (
    entry_id: string,
    message: AgentMessageInput,
  ): Promise<void> => {
    if (
      this.controls.transport === "restoring" ||
      !this.loaded_once ||
      this.controls.state === "running"
    ) {
      return;
    }
    const normalized = normalize_agent_message_input(message);
    if (normalized === null) return;
    await this.execute_command("revise", () =>
      api_fetch<AgentCommandAck>("/api/agent/round/revise", {
        entryId: entry_id,
        message: normalized,
      }),
    );
  };

  /** 继续空闲会话，可附带草稿并在受理后清理。 */
  private readonly continue_session = async (message?: AgentMessageInput): Promise<void> => {
    if (
      this.controls.transport === "restoring" ||
      !this.loaded_once ||
      this.controls.state === "running"
    ) {
      return;
    }
    let normalized: AgentMessageInput | undefined;
    if (message !== undefined) {
      const candidate = normalize_agent_message_input(message);
      if (candidate === null) return;
      normalized = candidate;
    }
    await this.execute_command(
      "continue",
      () =>
        api_fetch<AgentCommandAck>(
          "/api/agent/continue",
          normalized === undefined ? {} : { message: normalized },
        ),
      normalized === undefined ? undefined : () => this.accept_message(normalized),
    );
  };

  /** 只把已恢复且后端标记可压缩的空闲会话送入命令串行入口。 */
  private readonly compact_context = async (): Promise<void> => {
    if (
      this.controls.transport !== "ready" ||
      this.controls.state !== "idle" ||
      !this.controls.context.compactable
    ) {
      return;
    }
    await this.execute_command("compact", () =>
      api_fetch<AgentCommandAck>("/api/agent/context/compact"),
    );
  };

  /** 仅运行中的会话接受停止请求。 */
  private readonly stop = async (): Promise<void> => {
    if (this.controls.state !== "running") return;
    await this.execute_command("stop", () => api_fetch<AgentCommandAck>("/api/agent/stop"));
  };

  /** 请求后端重置，通过快照和事件清理前端会话。 */
  private readonly reset = async (): Promise<void> => {
    await this.execute_command("reset", () => api_fetch<AgentCommandAck>("/api/agent/reset"));
  };

  /** 提交审批模式，实际模式由后端事件同步。 */
  private readonly set_approval_mode = async (approval_mode: AgentApprovalMode): Promise<void> => {
    await this.execute_command("approval_mode", () =>
      api_fetch<AgentCommandAck>("/api/agent/approval-mode", { approvalMode: approval_mode }),
    );
  };

  /** 普通问题只向对应窄入口提交当前 pending 的身份与答案。 */
  private readonly resolve_question = async (response: AgentQuestionResponse): Promise<void> => {
    const pending = this.controls.pendingDecision;
    if (pending?.kind !== "question") return;
    await this.submit_decision(pending.id, () =>
      api_fetch<AgentCommandAck>("/api/agent/question/resolve", { id: pending.id, response }),
    );
  };

  /** 写入授权与普通回答分离，避免 renderer 拼装混合载荷。 */
  private readonly resolve_write_approval = async (
    decision: AgentWriteApprovalDecision,
  ): Promise<void> => {
    const pending = this.controls.pendingDecision;
    if (pending?.kind !== "write_approval") return;
    await this.submit_decision(pending.id, () =>
      api_fetch<AgentCommandAck>("/api/agent/write-approval/resolve", {
        id: pending.id,
        decision,
      }),
    );
  };

  /** 手动与自动决定共用受理入口；失败通知一次，保留问题供手动重试。 */
  private async submit_decision(
    id: string,
    request: () => Promise<AgentCommandAck>,
  ): Promise<void> {
    if (this.command_events !== null || this.controls.transport !== "ready") return;
    this.countdown.stop(id);
    try {
      await this.execute_command("decision", request);
    } catch (error) {
      this.on_decision_error(error);
    }
  }

  /** 复用连接世代与快照恢复入口。 */
  private readonly reconnect = (): void => {
    this.connect();
  };

  /** 草稿与输入历史由 Store 拥有，组件通过稳定端口读取和更新。 */
  private create_input_session(revision: number): AgentInputSession {
    return {
      revision,
      read_draft: () => this.draft,
      write_draft: (draft) => {
        this.draft = draft;
      },
      read_history: () => this.input_history,
      replace_history: (previous_text, next_text) => {
        this.input_history = replace_agent_input_history(
          this.storage,
          this.input_history,
          previous_text,
          next_text,
        );
      },
    };
  }

  /** 受理后更新纯文本历史并清空草稿，用输入 revision 通知编辑器。 */
  private accept_message(message: AgentMessageInput): void {
    if (message.text !== "") {
      this.input_history = update_agent_input_history(
        this.storage,
        this.input_history,
        message.text,
      );
    }
    this.draft = { text: "", attachments: [] };
    this.input = this.create_input_session(this.input.revision + 1);
    this.emit("input");
  }
}

/** 命令回包只提取合法修订号，完整事实由事件传播。 */
function normalize_acknowledgement(value: unknown): AgentCommandAck {
  const record = read_json_record(value);
  return { revision: normalize_revision(record["revision"], "acknowledgement") };
}

/** API 与 SSE 都是不可信 JSON 边界，完整快照必须一次通过全部公开字段。 */
function normalize_snapshot(value: unknown): AgentSessionSnapshot {
  const record = read_json_record(value);
  const revision = normalize_revision(record["revision"], "snapshot");
  const state = normalize_state(record["state"]);
  const approval_mode = normalize_approval_mode(record["approvalMode"]);
  const pending_decision = normalize_pending_decision(record["pendingDecision"]);
  const entries = Array.isArray(record["entries"])
    ? record["entries"].flatMap(normalize_entry)
    : [];
  const skills = Array.isArray(record["skills"]) ? record["skills"].flatMap(normalize_skill) : [];
  const input_queue = normalize_input_queue(record["inputQueue"]);
  const todos = normalize_todos(record["todos"]);
  const context = normalize_context(record["context"]);
  if (
    approval_mode === null ||
    pending_decision === undefined ||
    input_queue === null ||
    todos === null ||
    context === null
  ) {
    throw new TypeError("Agent snapshot is invalid.");
  }
  return {
    revision,
    state,
    approvalMode: approval_mode,
    pendingDecision: pending_decision,
    entries,
    skills,
    inputQueue: input_queue,
    todos,
    context,
  };
}

/** SSE 顶层判别失败时丢弃单帧；后续 revision 缺口会触发权威恢复。 */
function normalize_agent_event(value: unknown): AgentSessionEvent | null {
  const record = read_json_record(value);
  const revision = normalize_optional_revision(record["revision"]);
  if (revision === null) return null;
  switch (record["type"]) {
    case "snapshot_seed": {
      const snapshot = normalize_snapshot(record["snapshot"]);
      return snapshot.revision === revision ? { type: "snapshot_seed", revision, snapshot } : null;
    }
    case "session_state":
      return { type: "session_state", revision, state: normalize_state(record["state"]) };
    case "approval_mode": {
      const approval_mode = normalize_approval_mode(record["approvalMode"]);
      return approval_mode === null
        ? null
        : { type: "approval_mode", revision, approvalMode: approval_mode };
    }
    case "pending_decision": {
      const pending = normalize_pending_decision(record["pendingDecision"]);
      return pending === undefined
        ? null
        : { type: "pending_decision", revision, pendingDecision: pending };
    }
    case "input_queue": {
      const input_queue = normalize_input_queue(record["inputQueue"]);
      return input_queue === null
        ? null
        : { type: "input_queue", revision, inputQueue: input_queue };
    }
    case "todo": {
      const todos = normalize_todos(record["todos"]);
      return todos === null ? null : { type: "todo", revision, todos };
    }
    case "context": {
      const context = normalize_context(record["context"]);
      return context === null ? null : { type: "context", revision, context };
    }
    case "entry_upsert": {
      const entry = normalize_entry(record["entry"])[0];
      return entry === undefined ? null : { type: "entry_upsert", revision, entry };
    }
    default:
      return null;
  }
}

/** 必需修订号无效时抛错，使调用方进入恢复路径。 */
function normalize_revision(value: unknown, source: string): number {
  const revision = normalize_optional_revision(value);
  if (revision === null) throw new TypeError(`Agent ${source} revision is invalid.`);
  return revision;
}

/** 修订号必须是可安全比较的非负整数。 */
function normalize_optional_revision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Todo 与后端、Deno 共用边界规则；非法帧交给 revision 恢复权威快照。 */
function normalize_todos(value: unknown): string[] | null {
  try {
    return normalize_agent_todos(value);
  } catch {
    return null;
  }
}

/** 整份队列共同校验，避免部分接收破坏顺序和身份唯一性。 */
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

/** null 表示尚无估算，undefined 表示传输值无效。 */
function normalize_context_tokens(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** 同时验证上下文估算与能力位，避免 renderer 从部分载荷自行推断。 */
function normalize_context(value: unknown): AgentContextSnapshot | null {
  if (!is_json_record(value) || typeof value["compactable"] !== "boolean") return null;
  const tokens = normalize_context_tokens(value["tokens"]);
  if (tokens === undefined) return null;
  const limits = value["limits"];
  if (limits === null) return { tokens, compactable: value["compactable"], limits: null };
  if (!is_json_record(limits)) return null;
  const context_window = limits["context_window"];
  const max_output_tokens = limits["max_output_tokens"];
  if (
    typeof context_window !== "number" ||
    !Number.isSafeInteger(context_window) ||
    context_window <= 0 ||
    typeof max_output_tokens !== "number" ||
    !Number.isSafeInteger(max_output_tokens) ||
    max_output_tokens <= 0
  )
    return null;
  return {
    tokens,
    compactable: value["compactable"],
    limits: { context_window, max_output_tokens },
  };
}

/** 按条目种类收窄消息及生命周期字段，无效条目交由上层判定。 */
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

/** 工具输出仅在成功或失败终帧存在，运行与停止状态保留空值。 */
function normalize_tool_entry(value: JsonRecord): AgentToolEntry[] {
  const status = normalize_entry_status(value["status"]);
  if (
    status === null ||
    typeof value["toolName"] !== "string" ||
    typeof value["input"] !== "string"
  ) {
    return [];
  }
  const base = {
    kind: "tool_call" as const,
    id: value["id"] as string,
    toolName: value["toolName"],
    input: value["input"],
    createdAt: value["createdAt"] as number,
  };
  if (status === "running" || status === "stopped") {
    return value["output"] === null ? [{ ...base, status, output: null }] : [];
  }
  return typeof value["output"] === "string" ? [{ ...base, status, output: value["output"] }] : [];
}

/** 统一收窄时间线条目的运行结果值域。 */
function normalize_entry_status(value: unknown): AgentEntryStatus | null {
  return value === "running" || value === "success" || value === "error" || value === "stopped"
    ? value
    : null;
}

/** 会话只公开空闲或运行状态，非法值触发完整恢复。 */
function normalize_state(value: unknown): AgentSessionState {
  if (value === "idle" || value === "running") return value;
  throw new TypeError("Agent snapshot state is invalid.");
}

/** 审批模式只接受公开的手动与自动值域。 */
function normalize_approval_mode(value: unknown): AgentApprovalMode | null {
  return value === "manual" || value === "auto" ? value : null;
}

/** 在 snapshot / SSE 边界按种类收窄用户决定。 */
function normalize_pending_decision(value: unknown): AgentPendingDecision | null | undefined {
  if (value === null) return null;
  if (value === undefined || !is_json_record(value)) return undefined;
  const id = value["id"];
  if (typeof id !== "string" || id.trim() === "") {
    return undefined;
  }
  if (value["kind"] === "question") {
    const question = normalize_question(value["question"]);
    return question === null ? undefined : { kind: "question", id, question };
  }
  if (value["kind"] !== "write_approval") return undefined;
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
  return { kind: "write_approval", id, summary };
}

/** 问题投影复核选项数量、文本与身份唯一性。 */
function normalize_question(value: unknown): AgentQuestion | null {
  if (!is_json_record(value) || typeof value["prompt"] !== "string") return null;
  const prompt = value["prompt"].trim();
  if (prompt === "" || prompt.length > AGENT_QUESTION_PROMPT_LIMIT) return null;
  const description = value["description"];
  if (
    description !== undefined &&
    (typeof description !== "string" ||
      description.trim() === "" ||
      description.trim().length > AGENT_QUESTION_DESCRIPTION_LIMIT)
  ) {
    return null;
  }
  const raw_options = value["options"];
  if (
    !Array.isArray(raw_options) ||
    raw_options.length < AGENT_QUESTION_OPTION_MIN ||
    raw_options.length > AGENT_QUESTION_OPTION_MAX
  ) {
    return null;
  }
  const ids = new Set<string>();
  const options = raw_options.flatMap((candidate) => {
    if (
      !is_json_record(candidate) ||
      typeof candidate["id"] !== "string" ||
      typeof candidate["label"] !== "string"
    ) {
      return [];
    }
    const id = candidate["id"].trim();
    const label = candidate["label"].trim();
    if (id === "" || label === "" || label.length > AGENT_QUESTION_LABEL_LIMIT || ids.has(id)) {
      return [];
    }
    ids.add(id);
    return [{ id, label }];
  });
  const [first, second, third] = options;
  if (first === undefined || second === undefined || options.length !== raw_options.length) {
    return null;
  }
  const normalized_options: AgentQuestion["options"] =
    third === undefined ? [first, second] : [first, second, third];
  return description === undefined
    ? { prompt, options: normalized_options }
    : { prompt, description: description.trim(), options: normalized_options };
}

/** 公开技能必须带齐支持语言的展示描述，页面保留后端顺序。 */
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
