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
  AgentSessionDoc,
  type AgentSessionState,
  type AgentInputRecord,
} from "./agent-session-state";
import { AgentSessionView, assistant_entry_id } from "./agent-session-view";
import { AGENT_KEEP_RECENT_TOKENS, read_agent_session_context } from "./agent-session-context";
import { append_agent_session_seed, type AgentSessionSeed } from "./agent-session-seed";
import { AgentSessionLog } from "./agent-log";
import { project_assistant_message_parts } from "./agent-message";
import { AgentToolError, agent_tool_result } from "./tool-definition";

const COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: AGENT_COMPACTION_RESERVE_TOKENS,
  keepRecentTokens: AGENT_KEEP_RECENT_TOKENS,
  backgroundTokens: 0,
};
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
  roundId: string | null;
  phase: "preparing" | "running" | "recovering" | "compacting" | "settling" | "stopped";
  acceptance: Promise<unknown> | null;
  settlement: Promise<void> | null;
  recoveryUsed: boolean;
  recoveryTask: TaskId | null;
  steer: SubmittedInput | null;
  retrySteer: SubmittedInput | null;
  translationPaused: BatchTranslationResult | null;
};

type SessionOptions = {
  sessionId: string;
  storage: Storage;
  cwd: string;
  models: MutableModels;
  seed: AgentSessionSeed;
  tools: ToolRegistration[];
  systemPrompt: () => string;
  skillsPrompt: () => string;
  continueText: () => string;
  log: AgentSessionLog;
  onChange: () => void;
  onModelEvent: (event: AssistantMessageEvent) => void;
  onReport: (error: unknown) => void;
  onCompactionFailure: (reason: string, error: string) => void;
};

/** 产品会话直接使用 durable 公共接口，拥有输入、历史、恢复与压缩的提交边界。 */
export class AgentSession {
  public readonly models: MutableModels;
  public model: Model<Api> | null = null; // 打开历史不解析模型，请求前由 `configure` 采用当前配置
  public readonly log: AgentSessionLog;
  public execution: AgentExecution | null = null;
  public readonly view = new AgentSessionView();
  /** 按需取得公开历史，日常增量由投影直接发布。 */
  public get entries(): AgentEntry[] {
    return this.view.entries;
  }
  public context: AgentContextSnapshot = { tokens: null, compactable: false, limits: null };
  /** 读取全部分支累计消耗，修订历史仍保留已发生用量。 */
  public get usage(): AgentUsageSnapshot {
    return this.view.usage;
  }
  public state: Readonly<AgentSessionState> = AgentSessionDoc.definition.initial(null);
  private harness!: Harness;
  private conversation!: Conversation; // 当前分支唯一入口，只在创建与修订成功后切换
  private readonly compactionFailures: Array<{ reason: string; error: string }> = []; // 提交后刷新时交付宿主诊断
  private compactionReason: "manual" | "threshold" | "length" = "manual";
  private contextRevision = 0; // 正文进度和队列变化不能使在途上下文查询失效
  private contextDirty = true; // 模型历史或配置变化使上下文查询失效
  private readonly consumedInputs = new Set<string>(); // 已入历史、等待在提交线外消费的草稿
  private refreshWork: Promise<void> | null = null;
  private refreshFailure: unknown; // 投影失败时命令不能用旧修订号确认成功
  private dirty = false; // 提交后仍有投影工作，与上下文查询独立
  private closed = false;
  private closing: Promise<void> | null = null;
  private unsubscribe = () => {};
  private latestResponse: {
    parts: ReturnType<typeof project_assistant_message_parts>;
    createdAt: number;
    source: Pick<AssistantMessage, "api" | "provider" | "model">;
  } | null = null; // 只保存值副本，SDK 对流式消息的后续修改不能改写停止快照

  /** 生成与摘要共用请求派发入口，统一会话身份、取消信号和流式观察。 */
  private constructor(private readonly options: SessionOptions) {
    this.models = options.models;
    this.log = options.log;
    const stream = this.models.streamSimple.bind(this.models);
    this.models.streamSimple = (model, context, request) =>
      lazyStream(model, async () => {
        const execution = this.execution;
        const signal =
          execution === null
            ? request?.signal
            : request?.signal === undefined
              ? execution.controller.signal
              : AbortSignal.any([request.signal, execution.controller.signal]);
        const source = stream(model, context, {
          ...request,
          // 历史修订仍属同一产品对话，因此生成与压缩统一覆盖 SDK 分叉后新建的供应商身份。
          sessionId: this.options.sessionId,
          ...(signal === undefined ? {} : { signal }),
        });
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
              this.log.handle_event({ type: "message_end", message });
            else this.log.handle_event({ type: "message_update", message });
            if (execution === this.execution && execution?.phase !== "stopped") {
              this.latestResponse = {
                parts: project_assistant_message_parts(message),
                createdAt: message.timestamp,
                source: { api: message.api, provider: message.provider, model: message.model },
              };
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
  public static async open(options: SessionOptions): Promise<AgentSession> {
    const session = new AgentSession(options);
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: "linguagacha",
        tools: options.tools.map((tool) => ({
          ...tool,
          execute: async (params, api, context) => {
            const execution = session.execution;
            const callContext =
              execution === null ? context : withAbortSignal(execution.controller.signal, context);
            let result: ToolExecutionResult;
            try {
              result = await tool.execute(params, api, callContext);
            } catch (error) {
              result = {
                ...agent_tool_result(
                  error instanceof AgentToolError ? error.details : { code: "tool_failed" },
                ),
                isError: true,
              };
              if (callContext.abortSignal?.aborted) {
                session.log.handle_event({
                  type: "tool_execution_end",
                  toolCallId: api.callId,
                  toolName: tool.name,
                  result: { content: result.content ?? [], details: result.details },
                  isError: true,
                });
                throw error;
              }
            }
            session.log.handle_event({
              type: "tool_execution_end",
              toolCallId: api.callId,
              toolName: tool.name,
              result: { ...result, content: result.content ?? [] },
              isError: result.isError === true,
            });
            return result;
          },
        })),
        sections: [
          section(
            "preamble",
            async (_input, context) => {
              // 认证的异步准备先结束，随后各 section 才冻结本次请求的最新人格与技能目录。
              await session.models.getAuth(
                session.require_model(),
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
            onYield: async (message, api) => {
              await session.before_yield(message, api.taskId);
              return undefined;
            },
            afterResponse: async (message) => {
              if (
                message.stopReason !== "length" &&
                message.stopReason !== "error" &&
                session.execution !== null
              )
                session.execution.recoveryUsed = false;
            },
          }),
          hook(CompactionTask, {
            beforeCompact: async (compaction) => {
              if (compaction.reason === "overflow" && session.execution !== null)
                session.execution.recoveryUsed = true;
            },
          }),
        ],
      }),
    );
    session.harness = await Harness.open(
      options.storage,
      {
        models: session.models,
        registry,
        settings: {
          stream: { cacheRetention: "short" },
          compaction: COMPACTION_SETTINGS,
          retry: RETRY_SETTINGS,
          steeringMode: "one-at-a-time",
          followUpMode: "one-at-a-time",
        },
        onReport: options.onReport,
      },
      BACKGROUND_CONTEXT,
    );
    session.unsubscribe = session.harness.subscribeCommits((publication) => {
      // 整批文档先接收，后续状态判断不依赖提交内各类 change 的排列顺序。
      for (const change of publication.changes) {
        if (change.type === "document" && change.value !== null) {
          // kind 对应固定 token 的 JSON 契约，值为 SDK 提供的不可变提交快照。
          if (
            change.record.kind === AgentSessionDoc.definition.kind &&
            change.record.key === options.sessionId
          )
            session.state = change.value as AgentSessionState;
        }
      }
      for (const change of publication.changes) {
        if (change.type === "entry") {
          for (const message of change.value.model ?? []) {
            if (message.role === "assistant")
              for (const call of message.content) {
                if (call.type === "toolCall")
                  session.log.handle_event({
                    type: "tool_execution_start",
                    toolCallId: call.id,
                    toolName: call.name,
                    args: call.arguments,
                  });
              }
            // Schema 失败绕过工具执行体，仍需原生回执封口，日志按调用身份去重。
            if (message.role === "toolResult")
              session.log.handle_event({
                type: "tool_execution_end",
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                result: message,
                isError: message.isError === true,
              });
          }
        } else if (change.type === "submission") {
          const previous = session.view.submissions.get(change.value.id);
          const record = change.value;
          if (
            previous?.entry === undefined &&
            record.entry !== undefined &&
            record.requestId !== undefined
          ) {
            const queuedId = session.state.inputs[record.requestId]?.queuedId;
            if (queuedId != null) session.consumedInputs.add(queuedId);
          }
          if (
            previous?.entry === undefined &&
            record.entry !== undefined &&
            record.requestId !== undefined &&
            session.state.inputs[record.requestId]?.delivery === "steer" &&
            session.execution !== null
          )
            session.execution.recoveryUsed = false;
        } else if (change.type === "task" && change.value.kind === CompactionTask.definition.name) {
          const previous = session.view.compactions.get(change.value.id);
          session.observe_compaction(change.value, previous);
        }
      }
      session.view.observe(publication);
      if (
        publication.changes.some(
          (change) => change.type === "entry" || change.type === "conversation",
        )
      ) {
        session.contextRevision++;
        session.contextDirty = true;
      }
      session.schedule_refresh();
    });
    try {
      await session.restore_records();
      const active = session.state.activeConversationId;
      if (active === null) {
        session.conversation = await session.harness.root(BACKGROUND_CONTEXT, {
          init: async (tx, id) => {
            const state = await tx.doc(AgentSessionDoc, options.sessionId, null);
            state.activeConversationId = id;
            await tx.appendEntry(id, { kind: "linguagacha.start" });
          },
        });
      } else {
        const conversation = await session.harness.conversation(active, BACKGROUND_CONTEXT);
        if (conversation === undefined) throw new AppError("file.invalid_structure");
        session.conversation = conversation;
      }
      await session.recover();
    } catch (error) {
      session.closed = true;
      session.unsubscribe();
      await session.harness.close(BACKGROUND_CONTEXT);
      session.flush_diagnostics();
      throw error;
    }
    return session;
  }

  /** 模型仅在用户发起请求前配置，打开历史不要求凭据或供应商仍存在。 */
  private require_model(): Model<Api> {
    if (this.model === null) throw new AppError("runtime.internal_invariant");
    return this.model;
  }

  /** 历史读取和实时提交使用同一缓存及投影。订阅本身不会回放旧记录。 */
  private async restore_records(): Promise<void> {
    const storage = this.options.storage;
    const scan = async <T>(
      read: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>,
    ): Promise<T[]> => {
      const result: T[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await read(cursor);
        result.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
      return result;
    };
    this.state =
      (await this.harness.snapshot(AgentSessionDoc, this.options.sessionId, BACKGROUND_CONTEXT)) ??
      AgentSessionDoc.definition.initial(null);
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
        conversation.entries({}, 100, cursor, BACKGROUND_CONTEXT),
      ))
        this.view.records.set(entry.id, entry);
    }
    for (const record of await scan((cursor) =>
      storage.scanSubmissions({}, 100, cursor, BACKGROUND_CONTEXT),
    ))
      this.view.submissions.set(record.id, record);
    for (const record of await scan((cursor) =>
      storage.scanTasks({ kind: CompactionTask.definition.name }, 100, cursor, BACKGROUND_CONTEXT),
    ))
      this.view.compactions.set(record.id, record);
  }

  /** 先全部标记取消，再启动 SDK 收尾，防止打开历史时重新运行工具或模型。 */
  private async recover(): Promise<void> {
    this.schedule_refresh();
    await this.flush();
    const entries = this.entries;
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
      let roundId: string | null = null;
      for (const entry of entries) {
        if (entry.kind === "user_message" && entry.delivery === "round") roundId = entry.id;
        if (
          entry.kind !== "context_compaction" &&
          roundId !== null &&
          state.rounds[roundId]?.status === "running"
        )
          state.stoppedEntries[entry.id] = { roundId, entry: freeze_entry(entry) };
      }
      for (const [id, round] of Object.entries(state.rounds)) {
        if (round.status !== "running") continue;
        round.status = "stopped";
        round.endedAt = Date.now();
        delete state.stoppedEntries[id];
      }
      state.queue = { items: [], paused: false };
    });
  }

  /** 原生自动压缩与产品主动压缩共用互斥判据。 */
  public get is_compacting(): boolean {
    return (
      (this.view.live.get(this.conversation?.id)?.compactions?.length ?? 0) > 0 ||
      this.execution?.phase === "compacting"
    );
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
  public async change(change: (state: AgentSessionState) => void): Promise<void> {
    await this.harness.commit(async (tx) => {
      change(await tx.doc(AgentSessionDoc, this.options.sessionId, null));
    }, BACKGROUND_CONTEXT);
    await this.flush();
  }
  /** 队列规则直接操作事务草稿，失败时由 `Harness` 原子回滚。 */
  public async change_queue<T>(change: (queue: AgentInputQueue) => T): Promise<T> {
    const result = await this.harness.commit(
      async (tx) =>
        change(
          new AgentInputQueue((await tx.doc(AgentSessionDoc, this.options.sessionId, null)).queue),
        ),
      BACKGROUND_CONTEXT,
    );
    await this.flush();
    return result;
  }
  /** 后续请求采用新模型，当前历史和累计用量继续属于同一会话。 */
  public async configure(model: Model<Api>, thinkingLevel: ModelThinkingLevel): Promise<void> {
    await this.conversation.configure(
      { model: { provider: model.provider, modelId: model.id }, thinkingLevel },
      BACKGROUND_CONTEXT,
    );
    this.model = model;
    this.contextRevision++;
    this.contextDirty = true;
    if (!this.state.seeded) {
      await this.harness.commit(async (tx) => {
        await append_agent_session_seed(tx, this.conversation.id, this.options.seed, model);
        (await tx.doc(AgentSessionDoc, this.options.sessionId, null)).seeded = true;
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
  ): Promise<SubmittedInput> {
    execution.controller.signal.throwIfAborted();
    const requestId = uuidv7();
    if (delivery === "round") execution.roundId = requestId;
    if (execution.roundId === null) throw new Error("Agent execution has no round");
    const input: AgentInputRecord = { roundId: execution.roundId, message, delivery, queuedId };
    const checkpoint = this.tail;
    await this.change((state) => {
      state.inputs[requestId] = input;
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
    const submission = await this.conversation.submit(
      {
        type: "input",
        content: [{ type: "text", text: prepared.text }, ...prepared.images],
        requestId,
        whenBusy: delivery === "steer" ? "steer" : "reject",
      },
      withAbortSignal(execution.controller.signal, BACKGROUND_CONTEXT),
    );
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

  /** Hook 只收束受理和未消费输入。生成退出后的恢复由同一产品执行串行接管。 */
  private async before_yield(message: AssistantMessage, task: TaskId): Promise<void> {
    const execution = this.execution;
    if (
      execution === null ||
      execution.controller.signal.aborted ||
      !isRecoverableLength(message, this.require_model().maxTokens)
    )
      return;
    execution.phase = "recovering";
    execution.recoveryTask = task;
    await execution.acceptance?.catch(() => undefined); // 受理错误由原命令回传，这里只等待其退出。
    const steer = execution.steer;
    if (steer !== null && (await steer.submission.abort(BACKGROUND_CONTEXT)) === "aborted") {
      execution.retrySteer = steer;
      execution.steer = null;
      await this.change_queue((queue) => queue.cancel_send());
    }
  }

  /** 等待当前全部原生生成，再决定恢复、收尾压缩和产品终态。 */
  public async run(accepted: SubmittedInput, execution: AgentExecution): Promise<void> {
    let current = accepted;
    const firstSubmission = accepted.submission.id;
    for (;;) {
      const settled = await current.submission.wait(BACKGROUND_CONTEXT);
      await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
      await execution.acceptance?.catch(() => undefined); // 受理错误由原命令回传，这里只等待其退出。
      await this.conversation.waitForIdle(BACKGROUND_CONTEXT);
      await this.flush();
      if (execution.controller.signal.aborted) return;
      const failed = [...this.view.submissions.values()].find(
        (record) =>
          record.id >= firstSubmission &&
          record.type === "input" &&
          record.entry !== undefined &&
          record.status === "unanswered" &&
          record.requestId !== undefined &&
          this.state.inputs[record.requestId]?.roundId === execution.roundId,
      );
      if (failed?.status === "unanswered")
        throw new Error(typeof failed.detail === "string" ? failed.detail : failed.reason);
      if (settled.status === "unanswered")
        throw new Error(typeof settled.detail === "string" ? settled.detail : settled.reason);
      const recovery = execution.recoveryTask;
      if (recovery === null) break;
      execution.recoveryTask = null;
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
      if (execution.recoveryUsed)
        throw new Error("Truncated response recovery failed after one compact-and-retry attempt.");
      execution.recoveryUsed = true;
      if (!(await this.compact("length", execution)))
        throw new Error("Truncated response recovery could not compact history.");
      execution.controller.signal.throwIfAborted();
      execution.phase = "running";
      const steer = execution.retrySteer;
      execution.retrySteer = null;
      if (steer !== null) {
        if (steer.input.queuedId !== null)
          await this.change_queue((queue) => queue.begin_send(steer.input.queuedId!));
        current = await this.submit(
          steer.input.message,
          steer.prepared,
          execution,
          "steer",
          steer.input.queuedId,
        );
      } else {
        const text = this.options.continueText();
        current = await this.submit(
          { text, attachments: [] },
          { text, images: [] },
          execution,
          "hidden",
        );
      }
    }
    execution.phase = "settling";
    if (
      (this.context.tokens ?? 0) >
        this.require_model().contextWindow - AGENT_COMPACTION_RESERVE_TOKENS &&
      this.context.compactable
    ) {
      try {
        await this.compact("threshold", execution);
      } catch (error) {
        if (!execution.controller.signal.aborted)
          this.options.onCompactionFailure("threshold", String(error));
      }
    }
  }

  /** 摘要任务结束与摘要写入均完成后，才允许产品轮次继续。 */
  public async compact(
    reason: "manual" | "threshold" | "length",
    execution: AgentExecution,
  ): Promise<boolean> {
    execution.controller.signal.throwIfAborted();
    execution.phase = "compacting";
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
      if (outcome.status !== "completed")
        throw new Error(
          outcome.status === "failed" ? outcome.error.message : "Compaction cancelled",
        );
      const result = outcome.result;
      if (result.submissionId !== undefined) {
        const submitted = await this.harness.submission(result.submissionId, BACKGROUND_CONTEXT);
        if ((await submitted?.wait(BACKGROUND_CONTEXT))?.status !== "done")
          throw new Error("Compaction summary was not placed");
      }
      await this.flush();
      return result.entryId !== undefined || result.submissionId !== undefined;
    } finally {
      if (!execution.controller.signal.aborted) execution.phase = "settling";
      this.options.onChange();
    }
  }

  /** 成功与失败结算保留停止边界已经冻结的轮次终态。 */
  public async finish_round(
    execution: AgentExecution,
    status: Extract<AgentEntryStatus, "success" | "error" | "stopped">,
    average: number | null,
  ): Promise<void> {
    const roundId = execution.roundId;
    if (roundId === null) return;
    await this.change((state) => {
      const round = state.rounds[roundId];
      if (round !== undefined && round.status !== "stopped") {
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
  /** 先冻结公开终态，再等待底层退出，迟到工具结果仍进入诊断。 */
  public async stop(execution: AgentExecution, average: number | null): Promise<void> {
    const abort = this.conversation.abort(BACKGROUND_CONTEXT);
    void abort.catch(this.options.onReport);
    const entries = this.entries;
    const roundStart = entries.findIndex((entry) => entry.id === execution.roundId);
    const activeRound =
      execution.roundId !== null && this.state.rounds[execution.roundId]?.status === "running";
    const frozen = (activeRound && roundStart >= 0 ? entries.slice(roundStart) : []).map(
      freeze_entry,
    );
    const task = this.view.live.get(this.conversation.id)?.run?.taskId;
    const latest = this.latestResponse;
    if (
      task !== undefined &&
      execution.roundId !== null &&
      this.state.rounds[execution.roundId]?.status === "running" &&
      latest !== null &&
      latest.parts !== null
    ) {
      const entry: AgentEntry = {
        kind: "assistant_message",
        id: assistant_entry_id(task, 0),
        parts: latest.parts,
        status: "stopped",
        createdAt: latest.createdAt,
      };
      const index = frozen.findIndex((item) => item.id === entry.id);
      if (index < 0) frozen.push(entry);
      else frozen[index] = entry;
    }
    await this.change((state) => {
      for (const entry of frozen)
        state.stoppedEntries[entry.id] = {
          roundId: execution.roundId!,
          entry,
          ...(task !== undefined && entry.id === assistant_entry_id(task, 0) && latest !== null
            ? { source: latest.source }
            : {}),
        };
      const round = execution.roundId === null ? undefined : state.rounds[execution.roundId];
      if (round !== undefined && round.status === "running") {
        round.status = "stopped";
        round.endedAt = Date.now();
        round.averageTokensPerSecond = average;
        delete state.stoppedEntries[execution.roundId!];
      }
      const queue = new AgentInputQueue(state.queue);
      queue.cancel_send();
      queue.pause();
    });
  }
  /** 租约释放前等待原生任务退出，关闭过程共用已有的收尾 Promise。 */
  public async abort(): Promise<void> {
    if (this.closing !== null) return this.closing;
    await this.conversation.abort(BACKGROUND_CONTEXT, { background: true });
    await this.flush();
  }

  /** 预检后的修订通过分叉替换活动历史，产品队列和 `doing` 跨分叉保留。 */
  public async revise(entry: AgentEntry, text: string | null): Promise<void> {
    const records = this.view.branch_records();
    let checkpoint: EntryId;
    let original: Pick<AssistantMessage, "api" | "provider" | "model"> | undefined;
    if (entry.kind === "user_message" && entry.delivery === "round")
      checkpoint = this.state.rounds[entry.id]!.checkpoint;
    else {
      // 生成任务先提交系统条目，正文可能只存在于停止快照。按最后条目确定分叉切点。
      const index = records.findLastIndex(
        (record) => assistant_entry_id(record.byTaskId, record.id) === entry.id,
      );
      if (index < 1) throw new AppError("request.validation_failed");
      const message = records[index]!.model?.findLast((message) => message.role === "assistant");
      original = message ?? this.state.stoppedEntries[entry.id]?.source;
      if (original === undefined) throw new AppError("request.validation_failed");
      checkpoint = records[message === undefined ? index : index - 1]!.id;
    }
    this.conversation = await this.conversation.fork(
      checkpoint,
      {
        ownership: { kind: "ownerless" },
        init: async (tx, id) => {
          const state = await tx.doc(AgentSessionDoc, this.options.sessionId, null);
          state.activeConversationId = id;
          delete state.stoppedEntries[entry.id]; // 修订替代停止快照，投影不能再补回旧正文
          if (original !== undefined && text !== null)
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
      try {
        await this.conversation.abort(BACKGROUND_CONTEXT, { background: true });
        await this.flush();
      } finally {
        this.closed = true;
        this.unsubscribe();
        try {
          await this.harness.close(BACKGROUND_CONTEXT);
        } finally {
          this.flush_diagnostics();
        }
      }
    })();
    return this.closing;
  }

  /** 合并提交后的工作，仅历史或模型配置变化触发上下文查询。 */
  private schedule_refresh(): void {
    this.dirty = true;
    if (this.refreshWork !== null || this.closed) return;
    this.refreshWork = Promise.resolve()
      .then(async () => {
        while (this.dirty && !this.closed) {
          this.dirty = false;
          this.flush_diagnostics();
          if (this.conversation === undefined) continue;
          const conversation = this.conversation;
          if (this.contextDirty) {
            const revision = this.contextRevision;
            const view = await conversation.context(BACKGROUND_CONTEXT);
            if (revision !== this.contextRevision || conversation !== this.conversation) {
              this.dirty = true;
              continue;
            }
            this.context = this.state.seeded
              ? read_agent_session_context(view, this.model)
              : { tokens: null, compactable: false, limits: null };
            this.contextDirty = false;
          }
          if (this.consumedInputs.size > 0) {
            const consumed = [...this.consumedInputs];
            await this.harness.commit(async (tx) => {
              const queue = new AgentInputQueue(
                (await tx.doc(AgentSessionDoc, this.options.sessionId, null)).queue,
              );
              for (const id of consumed) queue.commit_send(id);
            }, BACKGROUND_CONTEXT);
            for (const id of consumed) this.consumedInputs.delete(id);
          }
          this.view.refresh(conversation.id, this.state);
          this.refreshFailure = undefined;
          this.options.onChange();
        }
      })
      .catch((error) => {
        this.refreshFailure = error;
        if (!this.closed) this.options.onReport(error);
      })
      .finally(() => {
        this.refreshWork = null;
        if (this.dirty && !this.closed) this.schedule_refresh();
      });
  }
  /** 命令回执等待公开投影追上全部已观察提交。 */
  public async flush(): Promise<void> {
    while (this.refreshWork !== null) await this.refreshWork;
    if (this.refreshFailure !== undefined) throw this.refreshFailure;
    this.flush_diagnostics();
  }
  /** 提交线外统一处理诊断，关闭与命令回执等待同一出口。 */
  private flush_diagnostics(): void {
    this.log.flush();
    for (const { reason, error } of this.compactionFailures.splice(0))
      this.options.onCompactionFailure(reason, error);
  }
  /** 每个原生压缩任务只记录一次起止，手动任务附带产品触发原因。 */
  private observe_compaction(
    task: TaskRecord<JsonValue, JsonValue, JsonValue>,
    previous: TaskRecord<JsonValue, JsonValue, JsonValue> | undefined,
  ): void {
    const input = task.input;
    const nativeReason =
      typeof input === "object" && input !== null && "reason" in input
        ? String(input.reason)
        : "manual";
    const reason = nativeReason === "manual" ? this.compactionReason : nativeReason;
    if (previous === undefined) this.log.handle_event({ type: "compaction_start", reason });
    if (task.state.status === "terminal" && previous?.state.status !== "terminal") {
      const outcome = task.state.outcome;
      const error = outcome.status === "failed" ? outcome.error.message : undefined;
      this.log.handle_event({
        type: "compaction_end",
        reason,
        aborted: outcome.status === "aborted",
        ...(outcome.status === "completed" ? { result: outcome.result } : {}),
        ...(error === undefined ? {} : { errorMessage: error }),
      });
      if (error !== undefined) this.compactionFailures.push({ reason, error });
    }
  }
}

/** 正常停止和恢复共用公开终态规则，避免遗留 running 条目。 */
function freeze_entry(entry: AgentEntry): AgentEntry {
  if (entry.status !== "running" || entry.kind === "context_compaction") return entry;
  return entry.kind === "tool_call"
    ? { ...entry, status: "stopped", output: null }
    : { ...entry, status: "stopped" };
}
