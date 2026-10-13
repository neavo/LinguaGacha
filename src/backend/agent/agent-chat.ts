import { scheduler } from "node:timers/promises";
import type { JsonValue } from "@earendil-works/chord";
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
  hook,
  section,
  AssistantEntry,
  LiveDoc,
  UsageDoc,
  type Conversation,
  type EntryId,
  type Submission,
  type TaskId,
  type TaskRecord,
} from "@earendil-works/pi-durable";
import type { ToolRegistration, ToolExecutionResult } from "@earendil-works/pi-durable";
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
import type { BatchTranslationResult } from "../../domain/batch-translation";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import { AppError } from "../../shared/error";
import type { PreparedAgentMessage } from "./agent-message-input";
import { AgentInputQueue } from "./agent-input-queue";
import {
  AgentChatDoc,
  AGENT_INPUT_ENTRY_KIND,
  read_agent_input,
  type AgentChatData,
  type AgentInputRecord,
} from "./agent-chat-data";
import { read_agent_compaction_result, type AgentCompactionResult } from "./agent-compaction";
import { AgentChatView, assistant_entry_id } from "./agent-chat-view";
import { AgentContextBudget, read_agent_chat_context } from "./agent-chat-context";
import { append_agent_chat_seed, type AgentChatSeed } from "./agent-chat-seed";
import { AgentRuntimeLog, type AgentStopReason } from "./agent-runtime-log";
import {
  agent_tool_result,
  normalize_agent_tool_error,
  is_agent_cancellation,
} from "./tool-definition";

const RETRY_SETTINGS = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 };

type SubmittedInput = {
  submission: Submission;
  input: AgentInputRecord;
  prepared: PreparedAgentMessage;
};
/** 唯一执行对象同时承担迟到身份校验和资源所有权，恢复时沿用同一租约。 */
export type AgentExecution = {
  readonly controller: AbortController;
  readonly lease: RuntimeLease;
  stop_reason: AgentStopReason | null; // 执行拥有者在取消前固定来源，迟到收尾沿用该执行
  commandId?: string; // 只关联本次产品命令的首次 SDK 输入，后续自动轮次独立
  roundId: string | null;
  phase: "preparing" | "running" | "recovering" | "compacting" | "settling";
  acceptance: Promise<void> | null;
  settlement: Promise<void> | null;
  cancellation?: Promise<void>; // 重复停止与生命周期关闭等待同一次 SDK 取消
  recoveryUsed: boolean;
  recoveryTask: TaskId | null;
  steer: SubmittedInput | null;
  retrySteer: SubmittedInput | null;
  translationPaused: BatchTranslationResult | null;
};

type ChatOptions = {
  chatId: string;
  storage: Storage;
  readBatch?: <T>(callback: () => Promise<T>) => Promise<T>;
  cwd: string;
  models: MutableModels;
  seed: AgentChatSeed;
  tools: ToolRegistration[];
  systemPrompt: () => string;
  skillsPrompt: () => string;
  continueText: () => string;
  log: AgentRuntimeLog;
  onChange: () => void;
  onModelEvent: (event: AssistantMessageEvent) => void;
  onReport: (error: unknown) => void;
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
  private readonly contextBudget = new AgentContextBudget(); // 每个会话独立校准近期保留预算
  private readonly taskExecutions = new Map<TaskId, AgentExecution>(); // 仅跟踪在途任务，Hook 沿用创建任务时的执行身份
  private readonly pendingCompactionLogs = new Map<number, string>(); // 开始时固定原因，摘要写入后结算日志
  private harness!: Harness;
  private conversation!: Conversation; // 执行目标可暂为候选分支，公开历史始终读取 activeConversationId
  private compactionReason: "manual" | "length" = "manual"; // 产品主动压缩补充触发原因，SDK 自动压缩沿用原原因
  private contextRevision = 0; // 正文进度和队列变化不能使在途上下文查询失效
  private contextDirty = true; // 模型历史或配置变化使上下文查询失效
  private readonly consumedInputs = new Set<string>(); // 已入历史、等待在提交线外消费的草稿
  private refreshWork: Promise<void> | null = null; // 合并提交后的刷新，命令回执等待同一次处理
  private refreshFailure: unknown; // 投影失败时命令不能用旧修订号确认成功
  private dirty = false; // 提交后仍有投影工作，与上下文查询独立
  private closed = false;
  public sealed = false; // SDK 开始关闭即封闭受理，终止回执到达后才确认故障原因
  public failure: unknown;
  private failedRound: string | null = null;
  private failedAt = 0;
  private closing: Promise<void> | null = null; // 关闭只执行一次，所有调用者等待同一收尾
  private unsubscribe = () => {};
  /** 生成与摘要共用诊断和测速观察，取消信号及供应商身份由 SDK 拥有。 */
  private constructor(private readonly options: ChatOptions) {
    this.models = options.models;
    this.log = options.log;
    const stream = this.models.streamSimple.bind(this.models);
    this.models.streamSimple = (model, context, request) =>
      lazyStream(model, async () => {
        const execution = this.execution; // 流式终帧沿用原执行的停止来源
        // 候选输入受理与活动分支发布完成后，才允许模型请求产生回复和工具调用。
        await execution?.acceptance;
        execution?.controller.signal.throwIfAborted();
        const source = stream(model, context, request);
        const isSummary = this.is_compacting;
        const observe = (event: AssistantMessageEvent): void => {
          if (!isSummary) {
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

  /** 装配 `Harness`、产品工具与提交订阅，遗留任务收尾后才交付会话。 */
  public static async open(options: ChatOptions): Promise<AgentChat> {
    const chat = new AgentChat(options);
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "linguagacha",
        tools: options.tools.map((tool) => ({
          ...tool,
          execute: async (params, api, context) => {
            // 工具开始帧先获得发布机会，随后执行副作用。
            await scheduler.yield();
            const execution = chat.execution;
            let result: ToolExecutionResult;
            try {
              result = await tool.execute(params, api, context);
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
              result = { ...agent_tool_result(failure.details), isError: true };
              const expected = failure.severity === "expected";
              chat.log.record_tool_diagnostic(api.taskId, {
                toolCallId: api.callId,
                toolName: tool.name,
                ...(expected ? {} : { error }),
                level: expected ? "info" : failure.severity === "warning" ? "warning" : "error",
              });
            }
            return result;
          },
        })),
        sections: [
          section(
            "preamble",
            async (_input, context) => {
              // 认证的异步准备先结束，随后各 section 才冻结本次请求的最新人格与技能目录。
              await chat.models.getAuth(
                chat.require_model(),
                context.abortSignal === undefined ? {} : { signal: context.abortSignal },
              );
              return options.systemPrompt();
            },
            { tag: false },
          ),
          section("cwd", () => options.cwd),
          section("available_skills", () => options.skillsPrompt() || undefined),
        ],
        hooks: [
          hook(GenerationTask, {
            beforeRequest: (request, api) => {
              chat.contextBudget.before_request(api.taskId, request.messages);
            },
            onYield: async (message, api) => {
              await chat.register_recovery(
                chat.taskExecutions.get(api.taskId),
                message,
                api.taskId,
              );
              return undefined;
            },
            afterResponse: async (message, api) => {
              chat.contextBudget.after_response(api.taskId, message);
              if (
                message.stopReason !== "length" &&
                message.stopReason !== "error" &&
                message.stopReason !== "aborted"
              )
                chat.reset_recovery(chat.taskExecutions.get(api.taskId));
            },
          }),
          hook(CompactionTask, {
            beforeCompact: async (compaction, api) => {
              const execution = chat.taskExecutions.get(api.taskId);
              // `beforeCompact` 已确认摘要范围，此时持久化公开起点，恢复后沿用同一时间。
              await chat.harness.commit(async (tx) => {
                const state = await tx.doc(AgentChatDoc, options.chatId, null);
                state.compactionStartedAt[api.taskId] ??= Date.now();
              }, BACKGROUND_CONTEXT);
              if (compaction.reason === "overflow") chat.consume_recovery(execution, "overflow");
            },
          }),
        ],
      }),
    );
    chat.harness = await Harness.open(
      options.storage,
      {
        models: chat.models,
        registry,
        settings: {
          stream: { cacheRetention: "short" },
          compaction: {
            enabled: true,
            reserveTokens: AGENT_COMPACTION_RESERVE_TOKENS,
            backgroundTokens: 0,
            get keepRecentTokens() {
              return chat.contextBudget.keepRecentTokens;
            },
          },
          retry: RETRY_SETTINGS,
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
        },
        onReport: options.onReport,
      },
      BACKGROUND_CONTEXT,
    );
    chat.harness.subscribeClose(() => {
      chat.sealed = true;
      chat.failedRound = chat.execution?.roundId ?? null;
      chat.failedAt = Date.now();
      chat.execution?.controller.abort();
      options.onClosing?.(chat); // 只通知外层取消交互，不在 SDK 回调内等待关闭。
    });
    void chat.harness.closed.then((end) => {
      if (end.reason === "failed") chat.failure ??= end.error;
      if (chat.failure !== undefined) {
        chat.view.fail_round(chat.failedRound, chat.failedAt);
      }
      options.onChange();
    });
    chat.unsubscribe = chat.harness.subscribeCommits((publication) => {
      try {
        // 整批文档先接收，后续状态判断不依赖提交内各类 change 的排列顺序。
        for (const change of publication.changes) {
          if (change.type === "document" && change.value !== null) {
            // kind 对应固定 token 的 JSON 契约，值为 SDK 提供的不可变提交快照。
            if (
              change.record.kind === AgentChatDoc.definition.kind &&
              change.record.key === options.chatId
            )
              chat.state = change.value as AgentChatData;
          }
        }
        const placed = new Set(
          publication.changes.flatMap((change) =>
            change.type === "submission" &&
            chat.view.submissions.get(change.value.id)?.entry !== undefined
              ? [change.value.id]
              : [],
          ),
        );
        for (const change of publication.changes) {
          if (
            change.type !== "task" ||
            (change.value.kind !== GenerationTask.definition.name &&
              change.value.kind !== CompactionTask.definition.name)
          )
            continue;
          if (change.value.state.status === "terminal") chat.taskExecutions.delete(change.value.id);
          else if (chat.execution !== null && !chat.taskExecutions.has(change.value.id))
            chat.taskExecutions.set(change.value.id, chat.execution);
          // 投影接收本批任务前识别首次出现的压缩，无需复制全部历史任务身份。
          if (
            change.value.kind === CompactionTask.definition.name &&
            !chat.view.compactions.has(change.value.id)
          )
            chat.observe_compaction(change.value);
        }
        chat.view.observe(publication);
        for (const change of publication.changes) {
          if (change.type === "entry") {
            for (const message of change.value.model ?? []) {
              if (message.role === "assistant")
                for (const call of message.content) {
                  if (call.type === "toolCall")
                    chat.log.handle_event({
                      type: "tool_execution_start",
                      toolCallId: call.id,
                      toolName: call.name,
                      args: call.arguments,
                    });
                }
              // 工具结果是日志终态的唯一入口，校验失败和取消也由 SDK 回执封口。
              if (message.role === "toolResult")
                chat.log.record_tool_result(
                  change.value,
                  message,
                  chat.execution?.stop_reason ?? undefined,
                );
            }
          } else if (change.type === "submission") {
            const record = change.value;
            if (
              !placed.has(record.id) &&
              record.entry !== undefined &&
              record.requestId !== undefined
            ) {
              const input = read_agent_input(
                chat.view.records.get(record.entry),
                record,
                chat.state,
              );
              if (input?.queuedId != null) chat.consumedInputs.add(input.queuedId);
              if (input?.delivery === "steer" && input.roundId === chat.execution?.roundId)
                chat.reset_recovery(chat.execution);
            }
          }
        }
        if (
          publication.changes.some(
            (change) => change.type === "entry" || change.type === "conversation",
          )
        ) {
          chat.contextRevision++;
          chat.contextDirty = true;
        }
        chat.schedule_refresh();
      } catch (error) {
        chat.fail_projection(error);
      }
    });
    try {
      await chat.restore_records();
      const active = chat.state.activeConversationId;
      if (active === null) {
        chat.conversation = await chat.harness.root(BACKGROUND_CONTEXT, {
          init: async (tx, id) => {
            const state = await tx.doc(AgentChatDoc, options.chatId, null);
            state.activeConversationId = id;
            await tx.appendEntry(id, { kind: "linguagacha.start" });
          },
        });
      } else {
        const conversation = await chat.harness.conversation(active, BACKGROUND_CONTEXT);
        if (conversation === undefined) throw new AppError("file.invalid_structure");
        chat.conversation = conversation;
      }
      await chat.recover();
    } catch (error) {
      chat.closed = true;
      chat.unsubscribe();
      try {
        await chat.harness.close(BACKGROUND_CONTEXT);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Agent open and cleanup failed", {
          cause: error,
        });
      } finally {
        chat.log.flush();
      }
      throw error;
    }
    return chat;
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
      settlement: null,
      recoveryUsed: false,
      recoveryTask: null,
      steer: null,
      retrySteer: null,
      translationPaused: null,
    };
    this.execution = execution;
    return execution;
  }

  /** 模型仅在用户发起请求前配置，打开历史不要求凭据或供应商仍存在。 */
  private require_model(): Model<Api> {
    if (this.model === null) throw new AppError("runtime.internal_invariant");
    return this.model;
  }

  /** 存储适配器提供批次边界，内存存储可直接读取。 */
  private read_batch<T>(callback: () => Promise<T>): Promise<T> {
    return this.options.readBatch ? this.options.readBatch(callback) : callback();
  }

  /** 历史读取和实时提交使用同一缓存及投影。订阅本身不会回放旧记录。 */
  private async restore_records(): Promise<void> {
    const storage = this.options.storage;
    const scan = async <T>(
      read: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>,
    ): Promise<T[]> =>
      this.read_batch(async () => {
        const result: T[] = [];
        let cursor: Cursor | undefined;
        do {
          const page = await read(cursor);
          result.push(...page.items);
          cursor = page.next;
        } while (cursor !== undefined);
        return result;
      });
    this.state =
      (await this.harness.snapshot(AgentChatDoc, this.options.chatId, BACKGROUND_CONTEXT)) ??
      AgentChatDoc.definition.initial(null);
    for (const conversation of await scan((cursor) =>
      storage.scanConversations({}, 100, cursor, BACKGROUND_CONTEXT),
    )) {
      this.view.conversations.set(conversation.id, conversation);
      this.view.live.set(
        conversation.id,
        (await this.harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT)) ?? {},
      );
      this.view.pendingUsages.set(
        conversation.id,
        (await this.harness.snapshot(UsageDoc, conversation.id, BACKGROUND_CONTEXT)) ?? {
          models: {},
          tools: {},
        },
      );
    }
    const active = this.state.activeConversationId;
    if (active !== null) {
      const conversation = await this.harness.conversation(active, BACKGROUND_CONTEXT);
      if (conversation === undefined) throw new AppError("file.invalid_structure");
      for (const entry of await scan((cursor) =>
        storage.scanEntries({ conversationId: conversation.id }, 100, cursor, BACKGROUND_CONTEXT),
      ))
        this.view.records.set(entry.id, entry);
    }
    for (const record of await scan((cursor) =>
      storage.scanSubmissions({}, 100, cursor, BACKGROUND_CONTEXT),
    )) {
      this.view.submissions.set(record.id, record);
      if (record.entry !== undefined) {
        const input = read_agent_input(this.view.records.get(record.entry), record, this.state);
        if (input?.queuedId != null) this.consumedInputs.add(input.queuedId);
      }
    }
    for (const record of await scan((cursor) =>
      storage.scanTasks({ kind: CompactionTask.definition.name }, 100, cursor, BACKGROUND_CONTEXT),
    ))
      this.view.compactions.set(record.id, record);
  }

  /** 先全部标记取消，再启动 SDK 收尾，防止打开历史时重新运行工具或模型。 */
  private async recover(): Promise<void> {
    const previousConversationId = this.state.activeConversationId;
    this.schedule_refresh();
    await this.flush();
    const inspection = await this.harness.inspect(BACKGROUND_CONTEXT);
    for (const submission of inspection.submissions)
      if (submission.status === "queued")
        await this.harness.abortSubmission(submission.id, BACKGROUND_CONTEXT);
    for (const task of inspection.tasks)
      await this.harness.abortTask(task.record.id, BACKGROUND_CONTEXT);
    if (inspection.tasks.length > 0) {
      this.harness.resume();
      await Promise.all(
        inspection.tasks.map(({ record }) =>
          this.harness.waitForTask(record.id, BACKGROUND_CONTEXT),
        ),
      );
    }
    await this.change((state) => {
      for (const round of Object.values(state.rounds)) {
        if (round.status !== "running") continue;
        round.status = "stopped";
        round.endedAt = Date.now();
      }
      const queue = new AgentInputQueue(state.queue);
      queue.cancel_send();
      if (state.queue.items.length > 0) queue.pause();
    });
    for (const [id, command] of Object.entries(this.state.commands))
      if (command.status === "pending") await this.settle_input_command(id);
    if (this.state.activeConversationId !== previousConversationId) {
      // 候选分支未在首次读取范围内，切换后补读并重建投影。
      await this.restore_records();
      this.view.refresh(this.state.activeConversationId!, this.state, true);
      this.schedule_refresh();
      await this.flush();
    }
  }

  /** 原生自动压缩与产品主动压缩共用互斥判据。 */
  public get is_compacting(): boolean {
    return (
      (this.view.live.get(this.conversation?.id)?.compactions?.length ?? 0) > 0 ||
      this.execution?.phase === "compacting"
    );
  }
  /** 工程写入的原子边界取自 SDK 当前工具轮次，避免依赖时间线刷新时机。 */
  public get can_stop(): boolean {
    return !this.view.live
      .get(this.conversation?.id)
      ?.tools?.some((tool) => tool.name === "workspace_apply" && tool.status !== "done");
  }
  /** 恢复、压缩和停止期间关闭即时输入受理。 */
  public get can_steer(): boolean {
    return (
      this.execution?.phase === "running" &&
      !this.execution.controller.signal.aborted &&
      !this.is_compacting
    );
  }
  /** 只读命令取得队列副本，写操作经 `change_queue` 提交。 */
  public get queue(): AgentInputQueue {
    return new AgentInputQueue(structuredClone(this.state.queue));
  }
  /** 分叉切点使用完整可见历史，保留已被压缩排除的公开事实。 */
  public get tail(): EntryId {
    const records = this.view.branch_records();
    return records.at(-1)!.id;
  }

  /** 产品事实只经 `Harness` 事务写入，返回前同步公开投影。 */
  public async change(change: (state: AgentChatData) => void): Promise<void> {
    this.assert_usable();
    await this.harness.commit(async (tx) => {
      change(await tx.doc(AgentChatDoc, this.options.chatId, null));
    }, BACKGROUND_CONTEXT);
    await this.flush();
  }
  /** 受理异常时查询 SDK 的持久化回执，避免把已接收的输入误判为未发送。 */
  public async settle_input_command(commandId: string): Promise<void> {
    this.assert_usable();
    if (this.state.commands[commandId]!.status !== "pending") return;
    await this.harness.commit(async (tx) => {
      const saved = this.state.commands[commandId]!;
      const submission =
        saved.requestId === null || saved.conversationId === null
          ? undefined
          : await tx.submissionByRequest(saved.conversationId, saved.requestId);
      const state = await tx.doc(AgentChatDoc, this.options.chatId, null);
      const command = state.commands[commandId]!;
      if (command.status === "pending") {
        command.status = submission === undefined ? "cancelled" : "accepted";
        if (submission !== undefined && command.kind === "revise")
          state.activeConversationId = submission.conversationId;
      }
    }, BACKGROUND_CONTEXT);
    // 未受理的候选分支退出后，后续请求重新使用已提交的活动身份。
    this.conversation = (await this.harness.conversation(
      this.state.activeConversationId!,
      BACKGROUND_CONTEXT,
    ))!;
    this.schedule_refresh();
    await this.flush();
  }
  /** 队列规则直接操作事务草稿，失败时由 `Harness` 原子回滚。 */
  public async change_queue<T>(
    change: (queue: AgentInputQueue) => T,
    commandId?: string,
  ): Promise<T> {
    this.assert_usable();
    const result = await this.harness.commit(async (tx) => {
      const state = await tx.doc(AgentChatDoc, this.options.chatId, null);
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
    await this.conversation.configure(
      { model: { provider: model.provider, modelId: model.id }, thinkingLevel },
      BACKGROUND_CONTEXT,
    );
    this.model = model;
    this.contextRevision++;
    this.contextDirty = true;
    if (!this.state.seeded) {
      await this.harness.commit(async (tx) => {
        await append_agent_chat_seed(tx, this.conversation.id, this.options.seed, model);
        (await tx.doc(AgentChatDoc, this.options.chatId, null)).seeded = true;
      }, BACKGROUND_CONTEXT);
    }
    this.schedule_refresh();
    await this.flush();
  }
  /** 先登记产品输入，再受理 SDK 提交，草稿消费等待真实入历史回执。 */
  public async submit(
    message: AgentMessageInput,
    prepared: PreparedAgentMessage,
    execution: AgentExecution,
    delivery: "round" | "steer" | "hidden",
    queuedId: string | null = null,
    commandId: string | undefined = execution.commandId,
  ): Promise<SubmittedInput> {
    this.assert_usable();
    execution.controller.signal.throwIfAborted();
    const requestId = uuidv7();
    const conversation = this.conversation; // 提交意图与 SDK 调用使用同一分支
    if (delivery === "round") {
      execution.roundId = requestId;
      this.reset_recovery(execution);
    }
    if (execution.roundId === null) throw new Error("Agent execution has no round");
    const input: AgentInputRecord = { roundId: execution.roundId, message, delivery, queuedId };
    const checkpoint =
      this.state.activeConversationId === conversation.id
        ? this.tail
        : this.view.conversations.get(conversation.id)!.parent!.at;
    await this.change((state) => {
      if (commandId !== undefined) {
        const command = state.commands[commandId]!;
        command.requestId = requestId;
        command.conversationId = conversation.id;
      }
      if (delivery === "round")
        state.rounds[requestId] = {
          status: "running",
          checkpoint,
          endedAt: null,
          averageTokensPerSecond: null,
        };
    });
    execution.controller.signal.throwIfAborted();
    if (delivery === "round")
      this.log.begin_run(execution.roundId, queuedId === null ? "prompt" : "queued");
    const submission = await conversation.submit(
      {
        type: "input",
        content: [{ type: "text", text: prepared.text }, ...prepared.images],
        requestId,
        entry: { kind: AGENT_INPUT_ENTRY_KIND, data: input },
        whenBusy: delivery === "steer" ? "steer" : "reject",
      },
      withAbortSignal(execution.controller.signal, BACKGROUND_CONTEXT),
    );
    if (commandId !== undefined) {
      await this.change((state) => {
        state.commands[commandId]!.status = "accepted";
        state.activeConversationId = conversation.id;
      });
      delete execution.commandId;
    }
    const accepted = { submission, input, prepared };
    if (delivery === "steer") execution.steer = accepted;
    this.log.handle_event({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text: prepared.text }, ...prepared.images],
        timestamp: Date.now(),
      },
    });
    await this.flush();
    return accepted;
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

  /** Hook 只登记恢复并接管未消费输入，草稿持续由原执行占用。 */
  private async register_recovery(
    execution: AgentExecution | undefined,
    message: AssistantMessage,
    task: TaskId,
  ): Promise<void> {
    if (
      !this.owns_execution(execution) ||
      !isRecoverableLength(message, this.require_model().maxTokens)
    )
      return;
    execution.phase = "recovering";
    execution.recoveryTask = task;
    await execution.acceptance?.catch(() => undefined); // 受理错误由原命令回传，这里只等待其退出。
    if (!this.owns_execution(execution)) return;
    const steer = execution.steer;
    if (
      steer !== null &&
      (await steer.submission.abort(BACKGROUND_CONTEXT)) === "aborted" &&
      this.owns_execution(execution)
    ) {
      execution.retrySteer = steer;
      execution.steer = null;
    }
  }

  /** 交接冻结输入或结束恢复时释放临时引用，摘要成功本身不重置额度。 */
  private finish_recovery(execution: AgentExecution): SubmittedInput | null {
    const steer = execution.retrySteer;
    execution.retrySteer = null;
    execution.recoveryTask = null;
    return steer;
  }

  /** 等待当前全部 SDK 生成，只在异常截断时接管一次恢复。 */
  public async run(accepted: SubmittedInput, execution: AgentExecution): Promise<void> {
    let current = accepted;
    const firstSubmission = accepted.submission.id;
    try {
      for (;;) {
        const settled = await current.submission.wait(BACKGROUND_CONTEXT);
        await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
        await execution.acceptance?.catch(() => undefined); // 受理错误由原命令回传，这里只等待其退出。
        await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
        await this.flush();
        this.assert_usable();
        if (execution.controller.signal.aborted) return;
        const failed = [...this.view.submissions.values()].find(
          (record) =>
            record.id >= firstSubmission &&
            record.type === "input" &&
            record.entry !== undefined &&
            record.status === "unanswered" &&
            record.requestId !== undefined &&
            read_agent_input(this.view.records.get(record.entry), record, this.state)?.roundId ===
              execution.roundId,
        );
        const unanswered = failed ?? settled;
        if (unanswered.status === "unanswered") {
          const failure = this.view.live.get(this.conversation.id)?.compactionFailure;
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
        current = await this.recover_length(recovery, execution);
      }
      execution.phase = "settling";
    } finally {
      this.finish_recovery(execution);
    }
  }

  /** SDK 结算后串行排除截断贡献、消耗额度，并用冻结输入创建新的尝试。 */
  private async recover_length(
    recovery: TaskId,
    execution: AgentExecution,
  ): Promise<SubmittedInput> {
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
    const steer = this.finish_recovery(execution);
    if (steer !== null) {
      return this.submit(
        steer.input.message,
        steer.prepared,
        execution,
        "steer",
        steer.input.queuedId,
      );
    } else {
      const text = this.options.continueText();
      return this.submit({ text, attachments: [] }, { text, images: [] }, execution, "hidden");
    }
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
  /** 撤回未消费的即时输入并恢复草稿，已入历史的输入由提交回执消费。 */
  public async cancel_inputs(execution: AgentExecution): Promise<void> {
    const steer = execution.steer;
    if (steer !== null) {
      await steer.submission.abort(BACKGROUND_CONTEXT);
      execution.steer = null;
    }
    await this.flush();
    await this.change_queue((queue) => queue.cancel_send());
  }
  /** SDK 取消回执决定工具与正文终态，产品结算轮次并暂停草稿。 */
  public async stop(execution: AgentExecution, average: number | null): Promise<void> {
    if (this.sealed) return this.close();
    await this.conversation.abort(BACKGROUND_CONTEXT);
    await this.flush();
    await this.change_queue((queue) => {
      queue.cancel_send();
      queue.pause();
    });
    await this.finish_round(execution, "stopped", average);
    this.finish_recovery(execution);
    execution.steer = null;
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
      nextIndex < 0 ? this.tail : this.state.rounds[entries[nextIndex]!.id]!.checkpoint;
    this.conversation = await this.conversation.fork(
      checkpoint,
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          const state = await tx.doc(AgentChatDoc, this.options.chatId, null);
          state.activeConversationId = id;
          state.queue = { items: [], paused: false };
          state.doing = null;
          if (commandId !== undefined) state.commands[commandId]!.status = "accepted";
        },
      },
      BACKGROUND_CONTEXT,
    );
    this.schedule_refresh();
    await this.flush();
  }

  /** 候选分支固定本轮配置，输入受理后才替换活动历史。 */
  public async revise_user(
    entry: AgentEntry,
    model: Model<Api>,
    thinkingLevel: ModelThinkingLevel,
    commandId: string,
  ): Promise<void> {
    if (entry.kind !== "user_message" || entry.delivery !== "round")
      throw new AppError("request.validation_failed");
    this.model = model;
    this.conversation = await this.conversation.fork(
      this.state.rounds[entry.id]!.checkpoint,
      {
        ownership: { kind: "ownerless" },
        agent: { model: { provider: model.provider, modelId: model.id }, thinkingLevel },
        init: async (tx, id) => {
          (await tx.doc(AgentChatDoc, this.options.chatId, null)).commands[
            commandId
          ]!.conversationId = id;
        },
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
          const state = await tx.doc(AgentChatDoc, this.options.chatId, null);
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
        if (!this.sealed) {
          await this.conversation.abort(BACKGROUND_CONTEXT, { background: true });
          await this.flush();
        }
      } catch (error) {
        errors.push(error);
      } finally {
        this.closed = true;
        this.unsubscribe();
        try {
          await this.harness.close(BACKGROUND_CONTEXT);
        } catch (error) {
          errors.push(error);
        } finally {
          if (this.execution !== null) {
            this.finish_recovery(this.execution);
            this.execution.steer = null;
          }
          this.taskExecutions.clear();
          this.log.finish_tools();
          this.log.flush();
        }
      }
      if (errors.length > 0) {
        if (this.failure !== undefined && !errors.includes(this.failure))
          errors.unshift(this.failure);
        throw new AggregateError(errors, "Agent session cleanup failed", { cause: errors[0] });
      }
    })();
    return this.closing;
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
            this.contextBudget.restore(view, this.model, conversation.id);
            this.context = this.state.seeded
              ? read_agent_chat_context(view, this.model, this.contextBudget.keepRecentTokens)
              : { tokens: null, compactable: false, limits: null };
            this.contextDirty = false;
          }
          if (this.consumedInputs.size > 0) {
            const consumed = [...this.consumedInputs];
            await this.harness.commit(async (tx) => {
              const queue = new AgentInputQueue(
                (await tx.doc(AgentChatDoc, this.options.chatId, null)).queue,
              );
              for (const id of consumed) queue.commit_send(id);
            }, BACKGROUND_CONTEXT);
            for (const id of consumed) this.consumedInputs.delete(id);
          }
          this.view.refresh(conversation.id, this.state);
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
  /** 投影失去可信修订时停止实例，异步关闭避开 SDK 的同步提交回调。 */
  private fail_projection(error: unknown): void {
    this.refreshFailure ??= error;
    this.failure ??= error;
    this.sealed = true;
    this.options.onReport(error);
    void Promise.resolve()
      .then(() => this.close())
      .catch((cleanup) =>
        this.options.onReport(
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
