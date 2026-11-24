import { scheduler } from "node:timers/promises";
import type { JsonValue } from "@earendil-works/chord/json";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
  createRegistry,
  defineExtension,
  GenerationTask,
  CompactionTask,
  Harness,
  type Storage,
  type Cursor,
  type Page,
  type ReportInfo,
  hook,
  section,
  AssistantEntry,
  LiveDoc,
  UsageDoc,
  type CommitPublication,
  type Conversation,
  type ConversationId,
  type ConversationRecord,
  type CommitChange,
  type EntryId,
  type Submission,
  type Tx,
  type SubmissionId,
  type TaskId,
  type TaskRecord,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai/models";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";
import { isRecoverableLength } from "@earendil-works/pi-ai/utils/overflow";
import {
  uuidv7,
  type MutableModels,
  type Model,
  type Api,
  type ModelThinkingLevel,
  type AssistantMessageEvent,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type {
  AgentContextSnapshot,
  AgentEntry,
  AgentMessageInput,
  AgentUsageSnapshot,
  AgentEntryStatus,
} from "../../shared/agent";
import type { RuntimeLease } from "../runtime-operation-gate";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import { AppError } from "../../shared/error";
import type { PreparedAgentMessage } from "./agent-message-input";
import { AgentInputQueue } from "./agent-input-queue";
import {
  AgentChatDoc,
  AGENT_INPUT_ENTRY_KIND,
  type AgentChatData,
  type AgentInputRecord,
} from "./agent-chat-data";
import { read_agent_compaction_result, type AgentCompactionResult } from "./agent-compaction";
import { AgentChatView, assistant_entry_id } from "./agent-chat-view";
import { AGENT_KEEP_RECENT_TOKENS, read_agent_chat_context } from "./agent-chat-context";
import { append_agent_chat_seed, type AgentChatSeed } from "./agent-chat-seed";
import { AgentRuntimeLog, type AgentStopReason } from "./agent-runtime-log";
import { read_agent_tool_calls } from "./agent-message";
import {
  agent_tool_result,
  normalize_agent_tool_error,
  is_agent_cancellation,
} from "./tool-definition";

const RETRY_SETTINGS = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 };
const RESTORE_SCAN_PAGE_SIZE = 500;

export type AgentSubmitOptions = {
  queuedId?: string | null | undefined;
  conversation?: Conversation | undefined;
  change?: ((state: AgentChatData) => void) | undefined;
};

/** 轮次分叉与用户修订共用事务内更新，避免旧意图进入新分支。 */
function switch_branch(state: AgentChatData, conversationId: ConversationId): void {
  state.activeConversationId = conversationId;
  state.queue = { items: [], paused: false };
  state.doing = null;
}

/** SDK 受理与命令结果一起提交，用户修订同时激活候选分支。 */
function accept_input_command(
  state: AgentChatData,
  commandId: string,
  conversationId: ConversationId,
): void {
  const command = state.commands[commandId]!;
  command.status = "accepted";
  // 助手修订直接提交历史，只有用户修订经过 SDK 输入受理。
  if (command.kind === "revise") switch_branch(state, conversationId);
}

/** 工具开始帧先发布，再执行副作用。SDK 停靠结果直接沿原契约返回。 */
function wrap_agent_tool(chat: AgentChat, tool: ToolRegistration): ToolRegistration {
  return {
    ...tool,
    execute: async (params, api, context) => {
      const execution = chat.execution;
      try {
        await chat.flush();
        await scheduler.yield();
        return await tool.execute(params, api, context);
      } catch (error) {
        if (is_agent_cancellation(error, context.abortSignal)) {
          chat.log.record_tool_diagnostic(api.taskId, {
            toolCallId: api.callId,
            toolName: tool.name,
            ...(execution?.stop_reason == null ? {} : { stop_reason: execution.stop_reason }),
          });
          throw error;
        }
        const failure = normalize_agent_tool_error(error);
        const expected = failure.severity === "expected";
        chat.log.record_tool_diagnostic(api.taskId, {
          toolCallId: api.callId,
          toolName: tool.name,
          ...(expected ? {} : { error }),
          level: expected ? "info" : failure.severity === "warning" ? "warning" : "error",
        });
        return { ...agent_tool_result(failure.details), isError: true };
      }
    },
  };
}

/** 一个轮次的取消与恢复共用执行身份，连续轮次借用同一个运行租约。 */
export type AgentExecution = {
  readonly controller: AbortController;
  readonly lease: RuntimeLease;
  stop_reason: AgentStopReason | null; // 执行拥有者在取消前固定来源，迟到收尾沿用该执行
  commandId?: string; // 只关联本次产品命令的首次 SDK 输入，后续自动轮次独立
  roundId: string | null;
  phase: "preparing" | "running" | "compacting" | "settling";
  acceptance: Promise<unknown> | null;
  cancellation?: Promise<void>; // 重复停止与生命周期关闭等待同一次 SDK 取消
  recoveryUsed: boolean;
  recoveryTask: TaskId | null;
  batchStopped: boolean; // 用户停止任一批量工具后，本轮拒绝从两个入口再次启动。
};

export type ChatOptions = {
  chatId: string;
  documentKey: string;
  rootConversationId: ConversationId | null;
  cwd: string;
  models: MutableModels;
  seed: AgentChatSeed;
  tools: ToolRegistration[];
  systemPrompt: () => string;
  workspacePrompt: string;
  skillsPrompt: () => string;
  continueText: () => string;
  log: AgentRuntimeLog;
  onChange: () => void;
  onModelEvent: (event: AssistantMessageEvent) => void;
  onClosing?: (chat: AgentChat) => void;
};

/** 产品会话直接使用 durable 公共接口，拥有输入、历史、恢复与压缩的提交边界。 */
export class AgentChat {
  public readonly models: MutableModels;
  public model: Model<Api> | null = null; // 打开历史不解析模型，请求前由 `configure` 采用当前配置
  public readonly log: AgentRuntimeLog;
  public execution: AgentExecution | null = null;
  public readonly view = new AgentChatView();
  /** 按需取得公开历史，日常增量由投影直接发布。 */
  public get entries(): AgentEntry[] {
    return this.view.entries;
  }
  public context: AgentContextSnapshot = { tokens: null, compactable: false, limits: null };
  /** 读取全部分支累计消耗，修订历史仍保留已发生用量。 */
  public get usage(): AgentUsageSnapshot {
    return this.view.usage;
  }
  public state: Readonly<AgentChatData> = AgentChatDoc.definition.initial(null); // 只读提交快照，写入由 `Harness` 事务生成
  private readonly taskExecutions = new Map<TaskId, AgentExecution>(); // 仅跟踪在途任务，Hook 沿用创建任务时的执行身份
  private readonly pendingCompactionLogs = new Map<number, string>(); // 开始时固定原因，摘要写入后结算日志
  public rootConversationId!: ConversationId;
  private get harness(): Harness {
    return this.host.harness;
  }

  private conversation!: Conversation; // 已受理的活动分支
  private compactionReason: "manual" | "length" = "manual"; // 产品主动压缩补充触发原因，SDK 自动压缩沿用原原因
  private contextRevision = 0; // 正文进度和队列变化不能使在途上下文查询失效
  private contextDirty = true; // 模型历史或配置变化使上下文查询失效
  private refreshWork: Promise<void> | null = null; // 合并提交后的刷新，命令回执等待同一次处理
  private refreshFailure: unknown; // 投影失败时命令不能用旧修订号确认成功
  private dirty = false; // 提交后仍有投影工作，与上下文查询独立
  private closed = false;
  public sealed = false; // SDK 开始关闭即封闭受理，终止回执到达后才确认故障原因
  public failure: unknown;
  private failedRound: string | null = null;
  private failedAt = 0;
  private closing: Promise<void> | null = null; // 关闭只执行一次，所有调用者等待同一收尾
  private liveObservation?: { id: ConversationId; detach(): void }; // 分支切换时解除旧订阅
  /** 正文流驱动对话日志和测速，摘要由 Harness 的独立入口结算。 */
  private constructor(
    private readonly options: ChatOptions,
    private readonly host: ProjectAgentHost,
  ) {
    this.models = options.models;
    this.log = options.log;
    const stream = this.models.streamSimple.bind(this.models);
    // 摘要使用 completeSimple，其默认实现会回到 streamSimple。直接调用原始流，避免摘要被计为正文。
    this.models.completeSimple = (model, context, request) =>
      lazyStream(model, async () => {
        await this.wait_for_acceptance();
        return stream(model, context, request);
      }).result();
    this.models.streamSimple = (model, context, request) =>
      lazyStream(model, async () => {
        const execution = await this.wait_for_acceptance();
        const source = stream(model, context, request);
        const observe = (event: AssistantMessageEvent): void => {
          const message =
            event.type === "done"
              ? event.message
              : event.type === "error"
                ? event.error
                : event.partial;
          if (event.type === "start") this.log.handle_event({ type: "message_start", message });
          else if (event.type === "done" || event.type === "error")
            this.log.handle_event({
              type: "message_end",
              message,
              ...(execution?.stop_reason == null ? {} : { stop_reason: execution.stop_reason }),
            });
          else this.log.handle_event({ type: "message_update", message });
          if (execution === this.execution && !execution?.controller.signal.aborted) {
            this.options.onModelEvent(event);
          }
        };
        return (async function* () {
          for await (const event of source) {
            observe(event);
            yield event;
          }
        })();
      });
  }

  /** 模型请求等待候选分支受理，并沿用发起时的执行身份。 */
  private async wait_for_acceptance(): Promise<AgentExecution | null> {
    const execution = this.execution;
    await execution?.acceptance;
    execution?.controller.signal.throwIfAborted();
    return execution;
  }

  /** 所有产品对话共享此注册表，运行上下文由 SDK 会话身份选取。 */
  public static async open_harness(
    host: ProjectAgentHost,
    tools: ToolRegistration[],
  ): Promise<Harness> {
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "linguagacha",
        tools: tools.map((tool) => ({
          ...tool,
          execute: (params, api, context) => {
            const chat = host.require_conversation(api.conversationId);
            const registration = chat.options.tools.find(({ name }) => name === tool.name)!;
            return wrap_agent_tool(chat, registration).execute(params, api, context);
          },
        })),
        sections: [
          section(
            "preamble",
            async (input, context) => {
              const chat = host.require_conversation(input.conversationId);
              await chat.models.getAuth(
                chat.require_model(),
                context.abortSignal ? { signal: context.abortSignal } : {},
              );
              return chat.options.systemPrompt();
            },
            { tag: false },
          ),
          section("cwd", (input) => host.require_conversation(input.conversationId).options.cwd),
          section(
            "workspace_contract",
            (input) => host.require_conversation(input.conversationId).options.workspacePrompt,
            { tag: false },
          ),
          section(
            "available_skills",
            (input) =>
              host.require_conversation(input.conversationId).options.skillsPrompt() || undefined,
            { tag: false },
          ),
        ],
        hooks: [
          hook(GenerationTask, {
            onYield: (message, api) => {
              const chat = host.require_conversation(api.conversationId);
              chat.register_recovery(chat.taskExecutions.get(api.taskId), message, api.taskId);
              return undefined;
            },
            afterResponse: (message, api) => {
              if (
                message.stopReason !== "length" &&
                message.stopReason !== "error" &&
                message.stopReason !== "aborted"
              ) {
                const chat = host.require_conversation(api.conversationId);
                chat.reset_recovery(chat.taskExecutions.get(api.taskId));
              }
            },
          }),
          hook(CompactionTask, {
            beforeCompact: async (compaction, api) => {
              const chat = host.require_conversation(api.conversationId);
              await host.harness.commit(async (tx) => {
                const state = await tx.doc(AgentChatDoc, chat.options.documentKey, null);
                state.compactionStartedAt[api.taskId] ??= Date.now();
              }, BACKGROUND_CONTEXT);
              if (compaction.reason === "overflow")
                chat.consume_recovery(chat.taskExecutions.get(api.taskId), "overflow");
            },
          }),
        ],
      }),
    );
    const models = createModels();
    models.getModel = (provider, ref) => {
      const chat = host.by_model_ref(ref);
      return chat?.model?.provider === provider ? chat.model : undefined;
    };
    models.streamSimple = (model, context, request) =>
      host.models_for(model).streamSimple(model, context, request);
    models.completeSimple = (model, context, request) =>
      host.models_for(model).completeSimple(model, context, request);
    models.fetchDeferred = (model, handle, request) =>
      host.models_for(model).fetchDeferred(model, handle, request);
    models.cancelDeferred = (model, handle, request) =>
      host.models_for(model).cancelDeferred(model, handle, request);
    return await Harness.open(
      host.storage,
      {
        models,
        registry,
        settings: {
          stream: { cacheRetention: "short" },
          compaction: {
            enabled: true,
            reserveTokens: AGENT_COMPACTION_RESERVE_TOKENS,
            backgroundTokens: 0,
            keepRecentTokens: AGENT_KEEP_RECENT_TOKENS,
          },
          retry: RETRY_SETTINGS,
        },
        identity: { attribution: null },
        onReport: ({ error, ...report }) => {
          const id =
            "task" in report
              ? report.task?.conversationId
              : "conversationId" in report
                ? report.conversationId
                : undefined;
          for (const chat of host.report_chats(id))
            chat.report_failure("sdk", new Error(report.kind, { cause: error }), report);
        },
      },
      BACKGROUND_CONTEXT,
    );
  }

  public static async open(host: ProjectAgentHost, options: ChatOptions): Promise<AgentChat> {
    const chat = new AgentChat(options, host);
    try {
      const previous = await chat.restore_records();
      chat.conversation =
        previous ??
        (await host.harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            init: async (tx, id) => {
              const state = await tx.doc(AgentChatDoc, options.documentKey, null);
              state.activeConversationId = id;
              await tx.appendEntry(id, { kind: "linguagacha.start" });
            },
          },
          BACKGROUND_CONTEXT,
        ));
      if (previous === undefined) {
        chat.rootConversationId = chat.conversation.id;
        await chat.restore_records();
      }
      host.attach(chat, options.chatId, options.documentKey);
      await chat.recover();
      return chat;
    } catch (error) {
      await chat.close();
      throw error;
    }
  }

  public seal(): void {
    this.sealed = true;
    this.failedRound = this.execution?.roundId ?? null;
    this.failedAt = Date.now();
    this.execution?.controller.abort();
    this.options.onClosing?.(this);
  }

  public end(error: unknown): void {
    this.failure ??= error;
    if (this.failure !== undefined) this.view.fail_round(this.failedRound, this.failedAt);
    this.options.onChange();
  }

  /** 服务取得租约后交付执行身份，恢复状态只由当前会话初始化和修改。 */
  public begin_execution(lease: RuntimeLease, commandId?: string): AgentExecution {
    const execution: AgentExecution = {
      lease,
      controller: new AbortController(),
      stop_reason: null,
      ...(commandId === undefined ? {} : { commandId }),
      roundId: null,
      phase: "preparing",
      acceptance: null,
      recoveryUsed: false,
      recoveryTask: null,
      batchStopped: false,
    };
    this.execution = execution;
    return execution;
  }

  /** 模型仅在用户发起请求前配置，打开历史不要求凭据或供应商仍存在。 */
  private require_model(): Model<Api> {
    if (this.model === null) throw new AppError("runtime.internal_invariant");
    return this.model;
  }

  /** 只恢复指定根及其分支树的历史和累计用量。 */
  private async restore_records(): Promise<Conversation | undefined> {
    const storage = this.host.storage;
    const restore = async <T extends { id: number }>(
      records: Map<number, T>,
      read: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>,
    ): Promise<void> => {
      let cursor: Cursor | undefined;
      do {
        const page = await read(cursor);
        for (const record of page.items) records.set(record.id, record);
        cursor = page.next;
      } while (cursor !== undefined);
    };
    this.state =
      (await this.harness.snapshot(AgentChatDoc, this.options.documentKey, BACKGROUND_CONTEXT)) ??
      AgentChatDoc.definition.initial(null);
    const active = this.state.activeConversationId;
    if (active === null) return undefined;
    const conversation = await this.harness.conversation(active, BACKGROUND_CONTEXT);
    if (conversation === undefined) throw new AppError("file.invalid_structure");
    await this.host.read_batch(async () => {
      const candidates = new Map<ConversationId, ConversationRecord>();
      await restore(candidates, (cursor) =>
        storage.scanConversations({}, RESTORE_SCAN_PAGE_SIZE, cursor, BACKGROUND_CONTEXT),
      );
      let root = active;
      for (
        let parent = candidates.get(root)?.parent;
        parent !== undefined;
        parent = candidates.get(root)?.parent
      )
        root = parent.conversationId;
      if (this.options.rootConversationId !== null && this.options.rootConversationId !== root)
        throw new AppError("file.invalid_structure");
      this.rootConversationId = root;
      for (const record of candidates.values()) {
        if (
          record.id !== root &&
          (record.parent === undefined ||
            !this.view.conversations.has(record.parent.conversationId))
        )
          continue;
        this.view.conversations.set(record.id, record);
        await restore(this.view.submissions, (cursor) =>
          storage.scanSubmissions(
            { conversationId: record.id },
            RESTORE_SCAN_PAGE_SIZE,
            cursor,
            BACKGROUND_CONTEXT,
          ),
        );
        await restore(this.view.compactions, (cursor) =>
          storage.scanTasks(
            { kind: CompactionTask.definition.name, conversationId: record.id },
            RESTORE_SCAN_PAGE_SIZE,
            cursor,
            BACKGROUND_CONTEXT,
          ),
        );
      }
      await restore(this.view.records, (cursor) =>
        storage.scanEntries(
          { conversationId: active },
          RESTORE_SCAN_PAGE_SIZE,
          cursor,
          BACKGROUND_CONTEXT,
        ),
      );
    });
    for (const { id } of this.view.conversations.values()) {
      const usage = await this.harness.snapshot(UsageDoc, id, BACKGROUND_CONTEXT);
      if (usage !== undefined) this.view.pendingUsages.set(id, usage);
    }
    return conversation;
  }

  /** SDK 遗留任务由工程宿主结算，对话在此恢复产品队列和受理记录。 */
  private async recover(): Promise<void> {
    await this.harness.commit(async (tx) => {
      const state = await tx.doc(AgentChatDoc, this.options.documentKey, null);
      for (const round of Object.values(state.rounds)) {
        if (round.status !== "running") continue;
        round.status = "stopped";
        round.endedAt = Date.now();
      }
      const queue = new AgentInputQueue(state.queue);
      queue.cancel_send();
      if (state.queue.items.length > 0) queue.pause();
      for (const command of Object.values(state.commands))
        if (command.status === "pending") command.status = "cancelled";
    }, BACKGROUND_CONTEXT);
    this.schedule_refresh();
    await this.flush();
  }

  /** 工程写入的原子边界取自 SDK 当前工具轮次，避免依赖时间线刷新时机。 */
  public get can_stop(): boolean {
    return !this.view.live.tools?.some(
      (tool) => tool.name === "workspace_apply" && tool.status !== "done",
    );
  }
  /** 读取已提交队列，只有事务草稿提供写入口。 */
  public get queue(): Pick<AgentInputQueue, "is_paused" | "has_items" | "read_snapshot"> {
    return new AgentInputQueue(this.state.queue);
  }
  /** 产品事实只经 `Harness` 事务写入，返回前同步公开投影。 */
  public async change(change: (state: AgentChatData) => void): Promise<void> {
    this.assert_usable();
    await this.harness.commit(async (tx) => {
      change(await tx.doc(AgentChatDoc, this.options.documentKey, null));
    }, BACKGROUND_CONTEXT);
    await this.flush();
  }
  /** 仅撤销准备中的命令，保留已提交而回包失败的受理结果。 */
  public async cancel_pending_command(commandId: string): Promise<void> {
    if (this.state.commands[commandId]?.status !== "pending") return;
    await this.change((state) => {
      const command = state.commands[commandId]!;
      if (command.status === "pending") command.status = "cancelled";
    });
  }
  /** 队列规则直接操作事务草稿，失败时由 `Harness` 原子回滚。 */
  public async change_queue<T>(
    change: (queue: AgentInputQueue) => T,
    commandId?: string,
  ): Promise<T> {
    this.assert_usable();
    const result = await this.harness.commit(async (tx) => {
      const state = await tx.doc(AgentChatDoc, this.options.documentKey, null);
      const value = change(new AgentInputQueue(state.queue));
      if (commandId !== undefined) state.commands[commandId]!.status = "accepted";
      return value;
    }, BACKGROUND_CONTEXT);
    await this.flush();
    return result;
  }
  /** 后续请求采用新模型，当前历史和累计用量继续属于同一会话。 */
  public async configure(model: Model<Api>, thinkingLevel: ModelThinkingLevel): Promise<void> {
    this.assert_usable();
    this.model = model;
    this.host.bind_model(model, this.models);
    await this.conversation.configure(
      { model: { provider: model.provider, modelId: this.options.chatId }, thinkingLevel },
      BACKGROUND_CONTEXT,
    );
    this.contextRevision++;
    this.contextDirty = true;
    if (!this.state.seeded) {
      await this.harness.commit(async (tx) => {
        await append_agent_chat_seed(tx, this.conversation.id, this.options.seed, model);
        (await tx.doc(AgentChatDoc, this.options.documentKey, null)).seeded = true;
      }, BACKGROUND_CONTEXT);
    }
    this.schedule_refresh();
    await this.flush();
  }
  /** 同一提交记录 SDK 受理与产品事实；事务外才取得可等待的句柄。 */
  private async admit(
    conversation: Conversation,
    execution: AgentExecution,
    submit: (tx: Tx, state: AgentChatData) => Promise<SubmissionId>,
    change?: ((state: AgentChatData) => void) | undefined,
  ): Promise<Submission> {
    const { commandId } = execution;
    const context = withAbortSignal(execution.controller.signal, BACKGROUND_CONTEXT);
    const id = await this.harness.commit(async (tx) => {
      execution.controller.signal.throwIfAborted();
      const state = await tx.doc(AgentChatDoc, this.options.documentKey, null);
      // SDK 受理先读取回执与历史边界，必须在事务首次表写入之前调用。
      const id = await submit(tx, state);
      change?.(state);
      if (commandId !== undefined) accept_input_command(state, commandId, conversation.id);
      return id;
    }, context);
    this.conversation = conversation;
    delete execution.commandId;
    const submission = await this.harness.submission(id, BACKGROUND_CONTEXT);
    if (submission === undefined) throw new Error("Missing committed submission");
    return submission;
  }

  /** 普通输入建立轮次，隐藏输入延续已有轮次。 */
  public async submit(
    message: AgentMessageInput,
    prepared: PreparedAgentMessage,
    execution: AgentExecution,
    delivery: "round" | "hidden",
    { queuedId = null, conversation = this.conversation, change }: AgentSubmitOptions = {},
  ): Promise<Submission> {
    this.assert_usable();
    const requestId = uuidv7();
    if (delivery === "round") execution.roundId = requestId;
    if (execution.roundId === null) throw new Error("Agent execution has no round");
    const input: AgentInputRecord = { roundId: execution.roundId, message, delivery };
    const submission = await this.admit(
      conversation,
      execution,
      async (tx, state) => {
        if (delivery === "round") {
          // 新轮次从受理前的分支末尾修订，SDK 同时解析祖先切点。
          const checkpoint = (await tx.latestEntryId(conversation.id))!;
          state.rounds[requestId] = {
            status: "running",
            checkpoint,
            endedAt: null,
            averageTokensPerSecond: null,
          };
        }
        const id = await conversation.submit(tx, {
          type: "input",
          content: [{ type: "text", text: prepared.text }, ...prepared.images],
          requestId,
          entry: { kind: AGENT_INPUT_ENTRY_KIND, data: input },
          whenBusy: "reject",
        });
        if (queuedId !== null) new AgentInputQueue(state.queue).commit_send(queuedId);
        return id;
      },
      change,
    );
    if (delivery === "round")
      this.log.begin_run(requestId, queuedId === null ? "prompt" : "queued");
    this.log.handle_event({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: prepared.text }, ...prepared.images],
        timestamp: Date.now(),
      },
    });
    await this.flush();
    return submission;
  }

  /** 可答上下文直接继续；纯文本截断等情况需要明确的后续指令。 */
  public async continue_round(
    execution: AgentExecution,
    change: (state: AgentChatData) => void,
  ): Promise<Submission> {
    const conversation = this.conversation;
    const view = await conversation.context(BACKGROUND_CONTEXT);
    const last = view.messages.findLast((message) => message.role !== "system");
    if (last?.role !== "user" && last?.role !== "toolResult") {
      const text = this.options.continueText();
      return this.submit({ text, attachments: [] }, { text, images: [] }, execution, "hidden", {
        change,
      });
    }
    return this.admit(
      conversation,
      execution,
      (tx) => conversation.submit(tx, { type: "continue" }),
      change,
    );
  }

  /** 迟到 Hook 只携带原任务身份，恢复事件不能跨执行或在取消后生效。 */
  private owns_execution(execution: AgentExecution | undefined): execution is AgentExecution {
    return (
      execution !== undefined &&
      execution === this.execution &&
      !execution.controller.signal.aborted &&
      !this.sealed
    );
  }

  /** 有效模型进展、新轮次和首次入历史的即时输入重置连续失败额度。 */
  private reset_recovery(execution: AgentExecution | undefined): void {
    if (this.owns_execution(execution)) execution.recoveryUsed = false;
  }

  /** SDK 溢出压缩记入同一额度，产品截断恢复在已有消耗时终止。 */
  private consume_recovery(
    execution: AgentExecution | undefined,
    reason: "length" | "overflow",
  ): void {
    if (!this.owns_execution(execution)) return;
    if (reason === "length" && execution.recoveryUsed)
      throw new Error("Truncated response recovery failed after one compact-and-retry attempt.");
    execution.recoveryUsed = true;
  }

  /** Hook 只登记恢复，摘要与下一次输入等 SDK 当前任务收尾后处理。 */
  private register_recovery(
    execution: AgentExecution | undefined,
    message: AssistantMessage,
    task: TaskId,
  ): void {
    if (
      !this.owns_execution(execution) ||
      !isRecoverableLength(message, this.require_model().maxTokens)
    )
      return;
    execution.recoveryTask = task;
  }

  /** 等待当前全部 SDK 生成，只在异常截断时接管一次恢复。 */
  public async run(accepted: Submission, execution: AgentExecution): Promise<void> {
    let current = accepted;
    const firstSubmission = accepted.id;
    try {
      for (;;) {
        const settled = await current.wait(BACKGROUND_CONTEXT);
        await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
        await this.flush();
        this.assert_usable();
        if (execution.controller.signal.aborted) return;
        const runFailure = this.view.live.runFailure;
        const unanswered =
          settled.status === "unanswered"
            ? settled
            : runFailure?.inputs.includes(current.id)
              ? runFailure
              : undefined;
        if (unanswered !== undefined) {
          const failure = this.view.live.compactionFailure;
          if (failure !== undefined && failure.taskId >= firstSubmission) {
            const task = this.view.compactions.get(failure.taskId);
            if (task !== undefined) {
              const result = read_agent_compaction_result(task, this.view.submissions);
              if (result.status === "error") throw result.error;
            }
          }
          throw new Error(
            typeof unanswered.detail === "string" ? unanswered.detail : unanswered.reason,
          );
        }
        const recovery = execution.recoveryTask;
        if (recovery === null) break;
        execution.recoveryTask = null; // 隐藏输入可登记下一次恢复。
        current = await this.recover_length(recovery, execution);
      }
    } finally {
      execution.phase = "settling";
    }
  }

  /** SDK 结算后排除截断贡献，压缩后用隐藏输入延续轮次。 */
  private async recover_length(recovery: TaskId, execution: AgentExecution): Promise<Submission> {
    const task = await this.harness.waitForTask(recovery, BACKGROUND_CONTEXT);
    const result = task.state.outcome;
    if (
      result.status !== "completed" ||
      typeof result.result !== "object" ||
      result.result === null ||
      !("entryId" in result.result) ||
      typeof result.result.entryId !== "number"
    )
      throw new Error("Truncated response has no committed entry");
    const entryId = result.result.entryId as EntryId;
    await this.harness.commit(
      (tx) =>
        tx.appendEntry(this.conversation.id, {
          kind: "linguagacha.context-edit",
          edits: [{ target: entryId, action: "omit" }],
        }),
      BACKGROUND_CONTEXT,
    );
    this.consume_recovery(execution, "length");
    execution.phase = "compacting";
    const compacted = await this.compact("length", execution);
    if (compacted.status === "error") throw compacted.error;
    if (compacted.status === "stopped") execution.controller.signal.throwIfAborted();
    if (compacted.status !== "success")
      throw new Error("Truncated response recovery could not compact history.");
    execution.controller.signal.throwIfAborted();
    execution.phase = "running";
    const text = this.options.continueText();
    return this.submit({ text, attachments: [] }, { text, images: [] }, execution, "hidden");
  }

  /** 摘要任务结束与摘要写入均完成后，才允许产品轮次继续。 */
  public async compact(
    reason: "manual" | "length",
    execution: AgentExecution,
  ): Promise<AgentCompactionResult> {
    this.assert_usable();
    execution.controller.signal.throwIfAborted();
    this.compactionReason = reason;
    this.options.onChange();
    try {
      const id = await this.conversation.compact(
        undefined,
        withAbortSignal(execution.controller.signal, BACKGROUND_CONTEXT),
      );
      await this.flush();
      const task = await this.harness.waitForTask(id, BACKGROUND_CONTEXT);
      const outcome = task.state.outcome;
      if (outcome.status === "completed" && outcome.result.submissionId !== undefined) {
        const submitted = await this.harness.submission(
          outcome.result.submissionId,
          BACKGROUND_CONTEXT,
        );
        await submitted?.wait(BACKGROUND_CONTEXT);
      }
      await this.flush();
      return read_agent_compaction_result(task, this.view.submissions);
    } finally {
      this.options.onChange();
    }
  }

  /** 只结算仍在运行的轮次，出队预检的取消不能改写上一轮结果。 */
  public async finish_round(
    execution: AgentExecution,
    status: Extract<AgentEntryStatus, "success" | "error" | "stopped">,
    average: number | null,
  ): Promise<void> {
    const roundId = execution.roundId;
    if (roundId === null) return;
    await this.change((state) => {
      const round = state.rounds[roundId];
      if (round !== undefined && round.status === "running") {
        round.status = status;
        round.endedAt = Date.now();
        round.averageTokensPerSecond = average;
      }
    });
  }
  /** 等待 SDK 取消回执与副作用退出，队列去向由运行拥有者决定。 */
  public async stop(): Promise<void> {
    if (this.sealed) return this.close();
    await this.conversation.abort(BACKGROUND_CONTEXT);
    await this.flush();
  }
  /** 下一轮的起点界定完整前缀，工具结果与隐藏恢复输入一起继承。 */
  public async fork_round(roundId: string, commandId?: string): Promise<void> {
    const entries = this.entries;
    const index = entries.findIndex(
      (entry) =>
        entry.kind === "user_message" && entry.delivery === "round" && entry.id === roundId,
    );
    const user = entries[index];
    const nextIndex = entries.findIndex(
      (entry, position) =>
        position > index && entry.kind === "user_message" && entry.delivery === "round",
    );
    const end = nextIndex < 0 ? entries.length : nextIndex;
    if (
      index < 0 ||
      user?.status === "running" ||
      !entries
        .slice(index + 1, end)
        .some(
          (entry) =>
            entry.kind === "assistant_message" &&
            entry.parts.some((part) => part.kind === "text" && part.text.trim() !== ""),
        )
    )
      throw new AppError("request.validation_failed");
    const checkpoint =
      nextIndex < 0
        ? (await this.harness.commit(
            (tx) => tx.latestEntryId(this.conversation.id),
            BACKGROUND_CONTEXT,
          ))!
        : this.state.rounds[entries[nextIndex]!.id]!.checkpoint;
    this.conversation = await this.conversation.fork(
      checkpoint,
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          const state = await tx.doc(AgentChatDoc, this.options.documentKey, null);
          switch_branch(state, id);
          if (commandId !== undefined) state.commands[commandId]!.status = "accepted";
        },
      },
      BACKGROUND_CONTEXT,
    );
    this.schedule_refresh();
    await this.flush();
  }

  /** 候选分支从目标轮次开始前分叉并固定本轮配置，输入受理后才替换活动历史。 */
  public async fork_user_revision(
    entry: AgentEntry,
    model: Model<Api>,
    thinkingLevel: ModelThinkingLevel,
  ): Promise<Conversation> {
    if (entry.kind !== "user_message" || entry.delivery !== "round")
      throw new AppError("request.validation_failed");
    this.model = model;
    this.host.bind_model(model, this.models);
    return this.conversation.fork(
      this.state.rounds[entry.id]!.checkpoint,
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: model.provider, modelId: this.options.chatId }, thinkingLevel },
      },
      BACKGROUND_CONTEXT,
    );
  }

  /** 预检后的修订通过分叉替换活动历史，产品队列和 `doing` 跨分叉保留。 */
  public async revise_assistant(
    entry: AgentEntry,
    text: string,
    commandId?: string,
  ): Promise<void> {
    const records = this.view.branch_records();
    // 人工修订定位不可变 SDK 正文，保留原始供应商元数据。
    const index = records.findLastIndex(
      (record) => assistant_entry_id(record.byTaskId, record.id) === entry.id,
    );
    if (entry.kind !== "assistant_message" || index < 1)
      throw new AppError("request.validation_failed");
    const original = records[index]!.model?.findLast((message) => message.role === "assistant");
    if (original === undefined) throw new AppError("request.validation_failed");
    const checkpoint = records[index - 1]!.id;
    this.conversation = await this.conversation.fork(
      checkpoint,
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          const state = await tx.doc(AgentChatDoc, this.options.documentKey, null);
          state.activeConversationId = id;
          if (commandId !== undefined) state.commands[commandId]!.status = "accepted";
          await tx.appendEntry(AssistantEntry, id, {
            model: [
              {
                role: "assistant",
                content: [{ type: "text", text }],
                // 人工修订沿用历史消息的来源元数据，重开后也无需解析当前模型或认证。
                api: original.api,
                provider: original.provider,
                model: original.model,
                stopReason: "stop",
                timestamp: Date.now(),
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              },
            ],
          });
        },
      },
      BACKGROUND_CONTEXT,
    );
    this.schedule_refresh();
    await this.flush();
  }
  /** 关闭即使取消提交失败也会封闭并 join 原生任务。调用者保留原始失败。 */
  public close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closing = (async () => {
      const errors: unknown[] = [];
      try {
        if (this.host.ending) await this.harness.closed;
        else if (this.conversation !== undefined) {
          await this.conversation.abort(BACKGROUND_CONTEXT, { background: true });
          if (!this.sealed) await this.flush();
        }
      } catch (error) {
        errors.push(error);
      } finally {
        this.closed = true;
        this.liveObservation?.detach();
        this.host.detach(this);
        this.taskExecutions.clear();
        this.log.finish_tools();
        this.log.flush();
      }
      if (errors.length > 0) {
        if (this.failure !== undefined && !errors.includes(this.failure))
          errors.unshift(this.failure);
        throw new AggregateError(errors, "Agent session cleanup failed", { cause: errors[0] });
      }
    })();
    return this.closing;
  }

  /** 只消费已落盘的条目与回执，观察回调内不进入 SDK 会话队列。 */
  public observe_commit(publication: CommitPublication): void {
    // 整批文档先接收，后续状态判断不依赖提交内各类 change 的排列顺序。
    for (const change of publication.changes) {
      if (change.type === "document" && change.kind === "change") {
        // kind 对应固定 token 的 JSON 契约，值为 SDK 提供的不可变提交快照。
        if (
          change.record.kind === AgentChatDoc.definition.kind &&
          change.record.key === this.options.documentKey
        )
          this.state = change.value as AgentChatData;
      }
    }
    for (const change of publication.changes) {
      if (
        change.type !== "task" ||
        (change.value.kind !== GenerationTask.definition.name &&
          change.value.kind !== CompactionTask.definition.name)
      )
        continue;
      if (change.value.state.status === "terminal") this.taskExecutions.delete(change.value.id);
      else if (this.execution !== null && !this.taskExecutions.has(change.value.id))
        this.taskExecutions.set(change.value.id, this.execution);
      // 投影接收本批任务前识别首次出现的压缩，无需复制全部历史任务身份。
      if (
        change.value.kind === CompactionTask.definition.name &&
        !this.view.compactions.has(change.value.id)
      )
        this.observe_compaction(change.value);
    }
    this.view.observe(publication);
    for (const change of publication.changes) {
      if (change.type === "entry") {
        for (const message of change.value.model ?? []) {
          if (message.role === "assistant")
            for (const call of read_agent_tool_calls(message)) {
              this.log.handle_event({
                type: "tool_execution_start",
                toolCallId: call.id,
                toolName: call.name,
                args: call.arguments,
              });
            }
          // 工具结果是日志终态的唯一入口，校验失败和取消也由 SDK 回执封口。
          if (message.role === "toolResult")
            this.log.record_tool_result(
              change.value,
              message,
              this.execution?.stop_reason ?? undefined,
            );
        }
      }
    }
    if (
      publication.changes.some(
        (change) => change.type === "entry" || change.type === "conversation",
      )
    ) {
      this.contextRevision++;
      this.contextDirty = true;
    }
    this.schedule_refresh();
  }

  /** 只有活动分支的 LiveDoc 驱动运行状态；订阅初值与后续内存提交属于同一条观察线。 */
  private async observe_live(id: ConversationId): Promise<void> {
    this.liveObservation?.detach();
    const observation = await this.harness.observeDoc(
      LiveDoc,
      id,
      {
        advance: (call) => {
          if (call.kind === "value" && this.state.activeConversationId === id && !this.closed) {
            this.view.update_live(call.value);
            this.schedule_refresh();
          }
        },
        end: (end) => {
          if (end.kind === "listener_error") this.fail_projection(end.error);
        },
      },
      BACKGROUND_CONTEXT,
    );
    // Harness 创建和分叉会话时均建立此文档。
    if (!observation) throw new AppError("file.invalid_structure");
    this.liveObservation = { id, detach: observation.detach };
    if (this.state.activeConversationId === id) this.view.update_live(observation.value);
  }

  /** 合并提交后的工作，仅历史或模型配置变化触发上下文查询。 */
  private schedule_refresh(): void {
    this.dirty = true;
    if (
      this.refreshWork !== null ||
      this.closed ||
      this.sealed ||
      this.refreshFailure !== undefined
    )
      return;
    this.refreshWork = Promise.resolve()
      .then(async () => {
        while (this.dirty && !this.closed && !this.sealed) {
          this.dirty = false;
          this.log.flush();
          if (this.conversation === undefined) continue;
          const conversation =
            this.state.activeConversationId === this.conversation.id
              ? this.conversation
              : (await this.harness.conversation(
                  this.state.activeConversationId!,
                  BACKGROUND_CONTEXT,
                ))!;
          if (this.liveObservation?.id !== conversation.id)
            await this.observe_live(conversation.id);
          if (this.contextDirty) {
            const revision = this.contextRevision;
            const view = await conversation.context(BACKGROUND_CONTEXT);
            if (
              revision !== this.contextRevision ||
              conversation.id !== this.state.activeConversationId
            ) {
              this.dirty = true;
              continue;
            }
            this.context = this.state.seeded
              ? read_agent_chat_context(view, this.model)
              : { tokens: null, compactable: false, limits: null };
            this.contextDirty = false;
          }
          this.view.refresh(conversation.id, this.state, this.execution?.controller.signal.aborted);
          for (const [id, reason] of this.pendingCompactionLogs)
            this.finish_compaction_log(this.view.compactions.get(id)!, reason);
          this.options.onChange();
        }
      })
      .catch((error) => {
        if (!this.sealed) this.fail_projection(error);
        else this.refreshFailure ??= error;
      })
      .finally(() => {
        this.refreshWork = null;
        if (this.dirty && !this.closed && !this.sealed && this.refreshFailure === undefined)
          this.schedule_refresh();
      });
  }
  /** 命令回执等待公开投影追上全部已观察提交。 */
  public async flush(): Promise<void> {
    while (this.refreshWork !== null) await this.refreshWork;
    if (this.refreshFailure !== undefined) throw this.refreshFailure;
    this.log.flush();
  }
  /** 故障实例只允许等待退出，已有提交由重开后的回执核对。 */
  public assert_usable(): void {
    if (this.sealed || this.closing !== null)
      throw new Error("Agent session closed", { cause: this.failure });
    if (this.refreshFailure !== undefined) throw this.refreshFailure;
  }

  /** SDK 回调和异步投影失败均可能发生在常规日志刷新之外。 */
  private report_failure(operation: "sdk" | "cleanup", error: unknown, report?: ReportInfo): void {
    this.log.report_failure(operation, error, report);
    this.log.flush();
  }

  /** 投影失去可信修订时停止实例，异步关闭避开 SDK 的同步提交回调。 */
  private fail_projection(error: unknown): void {
    this.refreshFailure ??= error;
    this.failure ??= error;
    this.seal();
    this.end(error);
    this.report_failure("cleanup", error);
    void Promise.resolve()
      .then(() => this.close())
      .catch((cleanup) =>
        this.report_failure(
          "cleanup",
          new AggregateError([error, cleanup], "Agent projection and cleanup failed", {
            cause: error,
          }),
        ),
      );
  }
  /** 每个原生压缩任务只记录一次起止，手动任务附带产品触发原因。 */
  private observe_compaction(task: TaskRecord<JsonValue, JsonValue, JsonValue>): void {
    const input = task.input;
    const nativeReason =
      typeof input === "object" && input !== null && "reason" in input
        ? String(input.reason)
        : "manual";
    const reason = nativeReason === "manual" ? this.compactionReason : nativeReason;
    // 日志包含切点选择尝试，公开条目的起点由 `beforeCompact` 单独记录。
    this.log.handle_event({ type: "compaction_start", reason, task_id: task.id });
    this.pendingCompactionLogs.set(task.id, reason);
  }

  /** SDK 任务可先于摘要写入结束，提交回执到达后才发布日志终态。 */
  private finish_compaction_log(
    task: TaskRecord<JsonValue, JsonValue, JsonValue>,
    reason: string,
  ): void {
    const result = read_agent_compaction_result(task, this.view.submissions);
    const { status } = result;
    if (status === "running" || task.state.status !== "terminal") return;
    this.pendingCompactionLogs.delete(task.id);
    const outcome = task.state.outcome;
    const error = result.status === "error" ? result.error : undefined;
    this.log.handle_event({
      type: "compaction_end",
      reason,
      task_id: task.id,
      status,
      ...(outcome.status === "aborted" && this.execution?.stop_reason != null
        ? { stop_reason: this.execution.stop_reason }
        : {}),
      ...(error === undefined
        ? {}
        : {
            error,
            level: outcome.status === "orphaned" ? ("error" as const) : ("warning" as const),
          }),
    });
  }
}

/** 一个打开周期只有一个 Harness。持久化 ID 分配和工具路由都由该宿主拥有。 */
export class ProjectAgentHost {
  public harness!: Harness;
  public ending = false;
  private readonly chats = new Map<string, AgentChat>();
  private readonly documents = new Map<string, AgentChat>(); // 文档变更可以只有文档键，没有 SDK 会话身份。
  private readonly conversations = new Map<number, AgentChat>(); // 根会话、分支和工具都归入产品对话。
  private readonly models = new WeakMap<Model<Api>, MutableModels>();

  private constructor(
    public readonly storage: Storage,
    public readonly read_batch: <T>(callback: () => Promise<T>) => Promise<T>,
  ) {}

  /** 恢复整库遗留任务后再接入各条对话。 */
  public static async open(
    storage: Storage,
    tools: ToolRegistration[],
    read_batch: <T>(callback: () => Promise<T>) => Promise<T>,
  ): Promise<ProjectAgentHost> {
    const host = new ProjectAgentHost(storage, read_batch);
    host.harness = await AgentChat.open_harness(host, tools);
    try {
      const inspection = await host.harness.inspect(BACKGROUND_CONTEXT);
      for (const submission of inspection.submissions)
        if (submission.status === "queued")
          await host.harness.abortSubmission(submission.id, BACKGROUND_CONTEXT);
      for (const task of inspection.tasks)
        await host.harness.abortTask(task.record.id, BACKGROUND_CONTEXT);
      if (inspection.tasks.length > 0) {
        host.harness.resume();
        await Promise.all(
          inspection.tasks.map(({ record }) =>
            host.harness.waitForTask(record.id, BACKGROUND_CONTEXT),
          ),
        );
      }
    } catch (error) {
      await host.close();
      throw error;
    }
    host.harness.observeCommits({
      advance: (publication) => host.observe(publication),
      end: (result) => {
        if (result.kind === "listener_error")
          for (const chat of host.chats.values()) {
            chat.seal();
            chat.end(result.error);
          }
      },
    });
    host.harness.subscribeClose(() => {
      host.ending = true;
      for (const chat of host.chats.values()) chat.seal();
    });
    void host.harness.closed.then((result) => {
      for (const chat of host.chats.values())
        chat.end(result.kind === "failed" ? result.error : undefined);
    });
    return host;
  }

  /** 历史加载完成后登记工具路由和文档提交使用的身份。 */
  public attach(chat: AgentChat, chatId: string, documentKey: string): void {
    this.chats.set(chatId, chat);
    this.documents.set(documentKey, chat);
    for (const conversation of chat.view.conversations.keys())
      this.conversations.set(conversation, chat);
  }

  /** 释放投影索引，历史回收由产品登记在宿主关闭后处理。 */
  public detach(chat: AgentChat): void {
    for (const map of [this.chats, this.documents]) {
      for (const [id, owner] of map) if (owner === chat) map.delete(id);
    }
    for (const id of chat.view.conversations.keys()) this.conversations.delete(id);
  }

  public by_model_ref(ref: string): AgentChat | undefined {
    return this.chats.get(ref);
  }

  /** 同一个供应商模型标识可以同时使用多份对话配置。 */
  public bind_model(model: Model<Api>, models: MutableModels): void {
    this.models.set(model, models);
  }

  public models_for(model: Model<Api>): MutableModels {
    const models = this.models.get(model);
    if (models === undefined) throw new AppError("runtime.internal_invariant");
    return models;
  }

  /** SDK 工具回调根据会话树定位所属对话。 */
  public require_conversation(id: ConversationId): AgentChat {
    const chat = this.conversations.get(id);
    if (chat === undefined) throw new AppError("runtime.internal_invariant");
    return chat;
  }

  public report_chats(id: ConversationId | undefined): Iterable<AgentChat> {
    const chat = id === undefined ? undefined : this.conversations.get(id);
    return id === undefined ? this.chats.values() : chat === undefined ? [] : [chat];
  }

  /** 先登记新分支的归属，再按对话拆分同一批提交。 */
  private observe({ seq, changes }: CommitPublication): void {
    for (const change of changes) {
      if (change.type !== "conversation" || change.value.parent === undefined) continue;
      const chat = this.conversations.get(change.value.parent.conversationId);
      if (chat !== undefined) this.conversations.set(change.value.id, chat);
    }
    const by_chat = new Map<AgentChat, CommitChange[]>();
    for (const change of changes) {
      let chat: AgentChat | undefined;
      if (change.type === "document" || change.type === "document.copy") {
        if (change.conversationId !== undefined)
          chat = this.conversations.get(change.conversationId);
        else if (
          change.record.kind === AgentChatDoc.definition.kind &&
          typeof change.record.key === "string"
        )
          chat = this.documents.get(change.record.key);
      } else {
        chat = this.conversations.get(
          change.type === "conversation" ? change.value.id : change.value.conversationId,
        );
      }
      if (chat === undefined) continue;
      const bucket = by_chat.get(chat);
      if (bucket) bucket.push(change);
      else by_chat.set(chat, [change]);
    }
    for (const [chat, scoped] of by_chat) chat.observe_commit({ seq, changes: scoped });
  }

  public async close(): Promise<void> {
    await this.harness.close(BACKGROUND_CONTEXT);
  }
}
