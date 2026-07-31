import {
  estimateContextTokens,
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
} from "@earendil-works/pi-agent-core";
import {
  contentText,
  InMemoryCredentialStore,
  type AssistantMessage,
  uuidv7,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent as PiAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import {
  AGENT_SESSION_EVENT_TOPIC,
  format_agent_user_message_text,
  normalize_agent_user_message_parts,
  type AgentAssistantMessagePart,
  type AgentContextUsage,
  type AgentEntry,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
  type AgentUserMessagePart,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import type { ProjectChangeEvent, ProjectDataSection } from "../../shared/project-event";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { LogManager } from "../log/log-manager";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProofreadingService } from "../proofreading/proofreading-service";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import { AGENT_PROOFREADING_UPDATE_SOURCE, create_agent_item_tools } from "./agent-item-tools";
import { register_agent_model, type AgentModelLimits } from "./agent-model";
import {
  AGENT_QUALITY_RULE_UPDATE_SOURCE,
  create_agent_quality_tools,
} from "./agent-quality-tools";
import { create_agent_skill_tools } from "./agent-skill-tools";
import { load_agent_skills, type AgentSkillDefinition } from "./agent-skills";
import { load_agent_system_prompt } from "./agent-system-prompt";

/** 任一工具事实 section 变化都会令旧模型上下文失效。 */
const AGENT_PROJECT_SECTIONS = [
  "quality",
  "items",
  "proofreading",
] as const satisfies readonly ProjectDataSection[];

const AGENT_KEEP_RECENT_TOKENS = 32_000; // 产品固定保留的最近模型可见历史

/** 产品会话只从冻结的模型容量派生压缩预算，不读取 coding-agent 用户设置。 */
function build_agent_session_settings(limits: AgentModelLimits) {
  return {
    enableInstallTelemetry: false,
    enableSkillCommands: false,
    compaction: {
      enabled: true,
      reserveTokens: limits.maxTokens,
      keepRecentTokens: AGENT_KEEP_RECENT_TOKENS,
    },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 2_000 },
  };
}

type AgentBinding = {
  projectPath: string; // loaded 工程身份
  epoch: number; // 同路径重新加载也必须失效旧会话
  sectionRevisions: Record<(typeof AGENT_PROJECT_SECTIONS)[number], number>; // 工具事实依赖的 revision
};

type AgentRuntime = {
  session: AgentSession;
  binding: AgentBinding;
  limits: AgentModelLimits; // 换模时继续传回 Provider，维持当前对话容量
  unsubscribe: () => void;
};

type AgentServiceCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems">;
};

type AgentServicePaths = Pick<
  AppPathService,
  | "get_app_root"
  | "get_agent_builtin_skill_dir"
  | "get_agent_user_skill_dir"
  | "get_agent_system_prompt_path"
>;

type AgentServiceOptions = {
  paths: AgentServicePaths;
  settings: Pick<AppSettingService, "read_setting">;
  userAgent: string;
  sessionState: ProjectSessionState;
  cache: AgentServiceCache;
  qualityRules: Pick<QualityRuleService, "query" | "update_from_agent">;
  proofreading: Pick<ProofreadingService, "update_items_from_agent">;
  runtimeGate: RuntimeOperationGate;
  logManager: Pick<LogManager, "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

/**
 * 单个后端 Agent 产品会话的状态拥有者；通用模型生命周期交给 AgentSession。
 */
export class AgentService {
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly user_agent: string;
  private readonly session_state: ProjectSessionState;
  private readonly cache: AgentServiceOptions["cache"];
  private readonly quality_rules: AgentServiceOptions["qualityRules"];
  private readonly proofreading: AgentServiceOptions["proofreading"];
  private readonly runtime_gate: RuntimeOperationGate; // task / Agent 互斥与 Agent 写工具授权来源
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型历史只绑定当前工程世代
  private session_reset: Promise<void> | null = null; // 清理完成前禁止新消息跨会话进入
  private message_acceptance: Promise<AgentSessionSnapshot> | null = null; // 串行覆盖异步建会话与换模
  private prompt_settlement: Promise<void> | null = null; // SDK idle 尚未覆盖异步 preflight，单独纳入关闭屏障
  private runtime_lease: RuntimeLease | null = null; // 从消息受理覆盖到 SDK 最终 settle
  private runtime_generation = 0; // stop/reset/dispose 统一令迟到异步阶段失效
  private state: AgentSessionState = "idle";
  private entries: AgentEntry[] = [];
  private skills: AgentSkillDefinition[] = [];
  private system_prompt: string | null = null;
  private disposed = false;

  /** 捕获组合根依赖，并让工程会话切换直接失效当前 Agent 运行时。 */
  public constructor(options: AgentServiceOptions) {
    this.paths = options.paths;
    this.settings = options.settings;
    this.user_agent = options.userAgent;
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.quality_rules = options.qualityRules;
    this.proofreading = options.proofreading;
    this.runtime_gate = options.runtimeGate;
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.unsubscribe_project_session = this.session_state.subscribe_change(() => {
      void this.reset_session();
    });
  }

  /** 返回仅含不可变投影的公开快照，避免 API 调用方持有会话内部引用。 */
  public get_snapshot(): AgentSessionSnapshot {
    return {
      state: this.state,
      entries: structuredClone(this.entries),
      skills: this.skills.map(({ name, description }) => ({ name, description })),
      contextUsage: this.read_context_usage(),
    };
  }

  /** 启动期原子加载必需的基础 Prompt 和可降级的 skill 清单。 */
  public async load_resources(): Promise<void> {
    const system_prompt = load_agent_system_prompt(this.paths);
    const skills = await load_agent_skills(this.paths, this.log_manager);
    const skills_prompt = formatSkillsForSystemPrompt(skills);
    this.system_prompt =
      skills_prompt === "" ? system_prompt : `${system_prompt}\n\n${skills_prompt}`;
    this.skills = skills;
  }

  /**
   * 同步校验消息，以单一 Promise 串行完成建会话或换模后再公开受理结果。
   */
  public async send_message(request: JsonRecord): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.RuntimeBusyError();
    }
    const system_prompt = this.require_system_prompt();
    this.session_state.require_loaded_project_path();
    const parts = normalize_agent_user_message_parts(request["parts"]);
    if (parts === null || !parts.some((part) => part.kind === "skill" || part.text.trim() !== "")) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_agent_message" },
      });
    }
    const selected_skills: AgentSkillDefinition[] = [];
    const selected_skill_names = new Set<string>();
    for (const part of parts) {
      if (part.kind !== "skill") continue;
      if (selected_skill_names.has(part.name)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "duplicate_agent_skill", skill: part.name },
        });
      }
      const skill = this.skills.find((candidate) => candidate.name === part.name);
      if (skill === undefined) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "invalid_agent_skill", skill: part.name },
        });
      }
      selected_skill_names.add(part.name);
      selected_skills.push(skill);
    }
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    const acceptance = this.accept_message(system_prompt, parts, selected_skills, runtime_lease);
    this.message_acceptance = acceptance;
    const clear_acceptance = () => {
      if (this.message_acceptance === acceptance) this.message_acceptance = null;
    };
    void acceptance.then(clear_acceptance, clear_acceptance);
    return await acceptance;
  }

  /** 清空当前对话，并在消息受理与旧运行时完全退出后返回最终空快照。 */
  public async reset(): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    const existing_lease = this.runtime_lease;
    const reset_lease = existing_lease ?? this.runtime_gate.begin_runtime("agent");
    if (existing_lease === null) this.runtime_lease = reset_lease;
    try {
      await this.reset_session();
      return this.get_snapshot();
    } finally {
      if (existing_lease === null) this.finish_runtime(reset_lease);
    }
  }

  /** 立即封口公开轮次并保留历史，后台取消压缩、重试和当前模型回合。 */
  public stop(): AgentSessionSnapshot {
    this.assert_not_disposed();
    this.runtime_generation += 1;
    const runtime = this.runtime;
    if (runtime !== null) {
      try {
        runtime.session.abortCompaction();
      } catch (error) {
        this.warn_cleanup_failure(error);
      }
      void runtime.session.abort().catch((error: unknown) => this.warn_cleanup_failure(error));
    }
    this.end_current_round();
    this.set_state("idle");
    return this.get_snapshot();
  }

  /** 相关项目事实变化令旧上下文失效；Agent 自己的原子写入只推进 binding。 */
  public handle_project_change(event: ProjectChangeEvent): void {
    if (
      !event.updatedSections.some((section) =>
        (AGENT_PROJECT_SECTIONS as readonly ProjectDataSection[]).includes(section),
      )
    ) {
      return;
    }
    if (
      this.runtime !== null &&
      (event.source === AGENT_QUALITY_RULE_UPDATE_SOURCE ||
        event.source === AGENT_PROOFREADING_UPDATE_SOURCE)
    ) {
      this.runtime.binding = this.read_binding();
      return;
    }
    if (this.runtime !== null || this.message_acceptance !== null) {
      void this.reset_session();
    }
  }

  /** dispose 不再发布事件，但会等待 reset、消息受理与所有运行时清理。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime_generation += 1;
    this.unsubscribe_project_session();
    const runtime = this.runtime;
    const reset = this.session_reset;
    const acceptance = this.message_acceptance;
    const prompt = this.prompt_settlement;
    this.runtime = null;
    await Promise.all([
      reset,
      acceptance?.catch(() => undefined),
      prompt?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
    ]);
  }

  /** 失效绑定先完整重置，再在受理世代内准备唯一候选运行时。 */
  private async accept_message(
    system_prompt: string,
    parts: AgentUserMessagePart[],
    selected_skills: AgentSkillDefinition[],
    runtime_lease: RuntimeLease,
  ): Promise<AgentSessionSnapshot> {
    let prompt_started = false;
    try {
      let binding = this.read_binding();
      if (this.runtime !== null && !bindings_equal(this.runtime.binding, binding)) {
        await this.reset_session();
        binding = this.read_binding();
      }
      const generation = this.runtime_generation;
      const model_settings = this.settings.read_setting();
      let runtime = this.runtime;
      const created = runtime === null;
      let candidate_closed = false;

      try {
        if (runtime === null) {
          runtime = await this.create_runtime(binding, system_prompt, model_settings);
        } else {
          const resolved_model = register_agent_model(
            runtime.session.modelRuntime,
            model_settings,
            this.user_agent,
            runtime.limits,
          );
          await runtime.session.setModel(resolved_model.model);
          runtime.session.setThinkingLevel(resolved_model.thinkingLevel);
        }

        if (!this.acceptance_is_current(generation, binding)) {
          if (created || this.runtime === runtime) {
            if (this.runtime === runtime) this.runtime = null;
            await this.close_runtime(runtime);
            candidate_closed = true;
          }
          throw new AppErrors.RequestValidationError({
            diagnostic_context: { reason: "agent_message_invalidated" },
          });
        }
        if (created) this.runtime = runtime;
      } catch (error) {
        if (created && runtime !== null && this.runtime !== runtime && !candidate_closed) {
          await this.close_runtime(runtime);
        }
        throw error;
      }

      this.upsert_entry({
        kind: "user_message",
        id: uuidv7(),
        parts,
        createdAt: Date.now(),
        endedAt: null,
      });
      this.set_state("running");
      const prompt = this.run_prompt(
        runtime,
        generation,
        build_agent_prompt(parts, selected_skills),
        runtime_lease,
      );
      this.prompt_settlement = prompt;
      prompt_started = true;
      const clear_prompt = () => {
        if (this.prompt_settlement === prompt) this.prompt_settlement = null;
      };
      void prompt.then(clear_prompt, clear_prompt);
      return this.get_snapshot();
    } finally {
      if (!prompt_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 创建完全内存化的 SDK 会话，并只注册五个产品工具。 */
  private async create_runtime(
    binding: AgentBinding,
    system_prompt: string,
    model_settings: JsonRecord,
  ): Promise<AgentRuntime> {
    const app_root = this.paths.get_app_root();
    const model_runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const resolved_model = register_agent_model(model_runtime, model_settings, this.user_agent);
    const limits = Object.freeze({
      contextWindow: resolved_model.model.contextWindow,
      maxTokens: resolved_model.model.maxTokens,
    });
    const settings_manager = SettingsManager.inMemory(build_agent_session_settings(limits), {
      projectTrusted: false,
    });
    const resource_loader = new DefaultResourceLoader({
      cwd: app_root,
      agentDir: app_root,
      settingsManager: settings_manager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: system_prompt,
      appendSystemPrompt: [],
    });
    await resource_loader.reload();
    const { session } = await createAgentSession({
      cwd: app_root,
      agentDir: app_root,
      modelRuntime: model_runtime,
      model: resolved_model.model,
      thinkingLevel: resolved_model.thinkingLevel,
      noTools: "builtin",
      customTools: [
        ...create_agent_quality_tools({
          qualityRules: this.quality_rules,
          cache: this.cache,
        }),
        ...create_agent_item_tools({
          cache: this.cache,
          proofreading: this.proofreading,
        }),
        ...create_agent_skill_tools(this.skills, (name) => this.is_skill_explicitly_invoked(name)),
      ],
      resourceLoader: resource_loader,
      sessionManager: SessionManager.inMemory(app_root),
      settingsManager: settings_manager,
    });
    const unsubscribe = session.subscribe((event) => {
      if (this.runtime?.session === session) this.handle_agent_event(event);
    });
    return { session, binding, limits, unsubscribe };
  }

  /** prompt() 已覆盖自动重试与溢出恢复；只有最终 settle 才决定公开终态。 */
  private async run_prompt(
    runtime: AgentRuntime,
    generation: number,
    text: string,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    try {
      await runtime.session.prompt(text, {
        expandPromptTemplates: false,
        // SDK 在异步 preflight 完成前仍处于 idle；失效后必须在真正启动模型前截断。
        preflightResult: (accepted) => {
          if (accepted && !this.prompt_is_current(runtime, generation)) {
            throw new Error("Agent 消息在模型请求前已失效");
          }
        },
      });
      if (this.prompt_is_current(runtime, generation)) {
        const final_assistant = runtime.session.messages.findLast(
          (message): message is AssistantMessage => message.role === "assistant",
        );
        if (final_assistant?.stopReason === "error") {
          this.report_request_failure(
            new Error(final_assistant.errorMessage ?? "Agent 模型回合失败"),
          );
        }
      }
    } catch (error) {
      if (this.prompt_is_current(runtime, generation)) {
        this.report_request_failure(error);
      }
    } finally {
      if (this.prompt_is_current(runtime, generation)) {
        this.end_current_round();
        this.set_state("complete");
      }
      this.finish_runtime(runtime_lease);
    }
  }

  /** 将 SDK 事件收窄为按真实顺序追加的公开时间线；中间失败不冒充最终失败。 */
  private handle_agent_event(event: PiAgentSessionEvent): void {
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent.type === "text_delta" ||
        event.assistantMessageEvent.type === "thinking_delta")
    ) {
      this.upsert_assistant_message(event.assistantMessageEvent.partial, false);
      return;
    }
    if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        this.upsert_assistant_message(event.message, true);
      }
      this.publish_context_usage();
      return;
    }
    if (event.type === "compaction_end") {
      if (event.errorMessage !== undefined) {
        this.log_manager.warning("Agent 上下文压缩失败", {
          source: "agent",
          context: { reason: event.reason, error: event.errorMessage },
        });
      }
      this.publish_context_usage();
      return;
    }
    if (event.type === "tool_execution_start") {
      this.upsert_entry({
        kind: "tool_call",
        id: event.toolCallId,
        toolName: event.toolName,
        status: "running",
        output: null,
        createdAt: Date.now(),
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const running_entry = this.entries.find(
        (entry) => entry.kind === "tool_call" && entry.id === event.toolCallId,
      );
      if (running_entry?.kind !== "tool_call") {
        throw new Error(`工具调用缺少开始事件：${event.toolCallId}`);
      }
      this.upsert_entry({
        ...running_entry,
        status: event.isError ? "error" : "success",
        output: contentText(event.result.content, ""),
      });
    }
  }

  /** Pi 以最终 assistant 承载模型错误；公开层只发布一次稳定事件。 */
  private report_request_failure(error: unknown): void {
    this.log_manager.error("Agent 模型回合失败", { source: "agent", error });
    this.publish_event({ type: "request_failed" });
  }

  /** 以 Pi 的完整 partial / final 消息校正公开 parts，同一模型消息始终原位覆盖。 */
  private upsert_assistant_message(message: AssistantMessage, complete: boolean): void {
    const parts = project_assistant_message_parts(message);
    const existing = this.find_open_assistant_entry();
    if (existing === undefined) {
      if (parts.length === 0) return;
      this.upsert_entry({
        kind: "assistant_message",
        id: uuidv7(),
        parts,
        createdAt: message.timestamp,
        complete,
      });
    } else {
      this.upsert_entry({ ...existing, parts, complete });
    }
  }

  /** manual-only skill 的读取授权直接由当前公开会话中的显式 skill part 推导。 */
  private is_skill_explicitly_invoked(name: string): boolean {
    return this.entries.some(
      (entry) =>
        entry.kind === "user_message" &&
        entry.parts.some((part) => part.kind === "skill" && part.name === name),
    );
  }

  /** 同 id 只替换原位置，确保工具终帧不会改变后端确认的时间线顺序。 */
  private upsert_entry(entry: AgentEntry): void {
    const next = structuredClone(entry);
    const index = this.entries.findIndex((item) => item.id === entry.id);
    if (index < 0) this.entries.push(next);
    else this.entries[index] = next;
    this.publish_event({ type: "entry_upsert", entry: structuredClone(next) });
  }

  /** 流式增量只归入最后一个尚未终结的 assistant 条目。 */
  private find_open_assistant_entry():
    | Extract<AgentEntry, { kind: "assistant_message" }>
    | undefined {
    return this.entries.findLast(
      (entry): entry is Extract<AgentEntry, { kind: "assistant_message" }> =>
        entry.kind === "assistant_message" && !entry.complete,
    );
  }

  /** 轮次由 user 条目拥有；所有终止路径在状态切换前通过同一时间戳封口。 */
  private end_current_round(): void {
    const user = this.entries.findLast(
      (entry): entry is Extract<AgentEntry, { kind: "user_message" }> =>
        entry.kind === "user_message" && entry.endedAt === null,
    );
    if (user !== undefined) this.upsert_entry({ ...user, endedAt: Date.now() });
  }

  /** SDK 在压缩后会暂时返回未知值；公开仪表继续从模型可见历史生成稳定数值。 */
  private read_context_usage(): AgentContextUsage | null {
    const session = this.runtime?.session;
    const model = session?.model;
    if (session === undefined || model === undefined) return null;
    return {
      tokens: estimateContextTokens(session.messages).tokens,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    };
  }

  /** 每次模型历史变化后发布与 snapshot 同形的容量投影。 */
  private publish_context_usage(): void {
    const context_usage = this.read_context_usage();
    if (context_usage !== null) {
      this.publish_event({ type: "context_usage", contextUsage: context_usage });
    }
  }

  /** 状态未变化时不发布重复 SSE。 */
  private set_state(state: AgentSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.publish_event({ type: "session_state", state });
  }

  /** AgentService 的所有增量统一复用单一公开 topic。 */
  private publish_event(event: AgentSessionEvent): void {
    this.publish(AGENT_SESSION_EVENT_TOPIC, event);
  }

  /** 立即隔离并清空公开会话，再等待消息受理与旧 SDK 运行时关闭。 */
  private reset_session(): Promise<void> {
    if (this.session_reset !== null) return this.session_reset;
    this.runtime_generation += 1;
    const runtime = this.runtime;
    const acceptance = this.message_acceptance;
    const prompt = this.prompt_settlement;
    this.runtime = null;
    this.state = "idle";
    this.entries = [];
    if (!this.disposed) {
      this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
    }
    const reset = Promise.all([
      acceptance?.catch(() => undefined),
      prompt?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
    ])
      .then(() => undefined)
      .finally(() => {
        if (this.session_reset === reset) this.session_reset = null;
      });
    this.session_reset = reset;
    return reset;
  }

  /** SDK 运行时只有一个关闭入口，清理失败记录 warning 但仍继续 dispose。 */
  private async close_runtime(runtime: AgentRuntime): Promise<void> {
    try {
      runtime.unsubscribe();
    } catch (error) {
      this.warn_cleanup_failure(error);
    }
    try {
      runtime.session.abortCompaction();
    } catch (error) {
      this.warn_cleanup_failure(error);
    }
    try {
      await runtime.session.abort();
    } catch (error) {
      this.warn_cleanup_failure(error);
    } finally {
      try {
        runtime.session.dispose();
      } catch (error) {
        this.warn_cleanup_failure(error);
      }
    }
  }

  /** 清理失败不改变已完成的会话隔离，只保留诊断。 */
  private warn_cleanup_failure(error: unknown): void {
    this.log_manager.warning("Agent 会话清理失败", { source: "agent", error });
  }

  /** 同时清除本地引用和共享 owner；迟到 lease 由 gate 身份校验忽略。 */
  private finish_runtime(lease: RuntimeLease): void {
    if (this.runtime_lease === lease) this.runtime_lease = null;
    this.runtime_gate.finish_runtime(lease);
  }

  /** 受理结果只有在工程绑定、运行世代和服务生命周期均未变化时才能公开。 */
  private acceptance_is_current(generation: number, binding: AgentBinding): boolean {
    if (this.disposed || generation !== this.runtime_generation) return false;
    try {
      return bindings_equal(binding, this.read_binding());
    } catch {
      return false;
    }
  }

  /** prompt 只有仍绑定当前运行时且未被终止时才能发布最终状态。 */
  private prompt_is_current(runtime: AgentRuntime, generation: number): boolean {
    return (
      this.runtime === runtime && generation === this.runtime_generation && this.state !== "idle"
    );
  }

  /** 会话绑定同时读取工程世代与工具依赖 section revision，不能只比较路径。 */
  private read_binding(): AgentBinding {
    const project_path = this.session_state.require_loaded_project_path();
    const snapshot = this.cache.snapshot();
    return {
      projectPath: project_path,
      epoch: snapshot.epoch,
      sectionRevisions: {
        quality: snapshot.sectionRevisions.quality ?? 0,
        items: snapshot.sectionRevisions.items ?? 0,
        proofreading: snapshot.sectionRevisions.proofreading ?? 0,
      },
    };
  }

  /** 资源加载是发送消息的硬前置，不能用空 prompt 降级启动。 */
  private require_system_prompt(): string {
    if (this.system_prompt === null) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "agent_resources_not_loaded" },
      });
    }
    return this.system_prompt;
  }

  /** dispose 后的命令必须失败，避免重新创建已脱离订阅的运行时。 */
  private assert_not_disposed(): void {
    if (this.disposed) throw new AppErrors.RuntimeDisposedError();
  }
}

/** skill 指令块按首次出现顺序置前，可见用户文本保持原 parts 顺序随后进入历史。 */
function build_agent_prompt(
  parts: readonly AgentUserMessagePart[],
  skills: readonly AgentSkillDefinition[],
): string {
  if (skills.length === 0) return format_agent_user_message_text(parts);
  const blocks = skills.map((skill) => formatSkillInvocation(skill));
  if (parts.some((part) => part.kind === "text" && part.text.trim() !== "")) {
    blocks.push(format_agent_user_message_text(parts));
  }
  return blocks.join("\n\n");
}

/** 将 Pi 内容投影成唯一公开形状；相邻同类块合并，脱敏思考和连续性元数据不外泄。 */
function project_assistant_message_parts(message: AssistantMessage): AgentAssistantMessagePart[] {
  const parts: AgentAssistantMessagePart[] = [];
  for (const content of message.content) {
    const part =
      content.type === "text" && content.text !== ""
        ? ({ kind: "text", text: content.text } as const)
        : content.type === "thinking" && !content.redacted && content.thinking.trim() !== ""
          ? ({ kind: "thinking", text: content.thinking } as const)
          : null;
    if (part === null) continue;
    const previous = parts.at(-1);
    if (previous?.kind === part.kind) previous.text += part.text;
    else parts.push(part);
  }
  return parts;
}

/** 工程路径、世代和任一工具依赖 revision 变化都会令旧上下文失效。 */
function bindings_equal(left: AgentBinding | null, right: AgentBinding): boolean {
  return (
    left !== null &&
    left.projectPath === right.projectPath &&
    left.epoch === right.epoch &&
    AGENT_PROJECT_SECTIONS.every(
      (section) => left.sectionRevisions[section] === right.sectionRevisions[section],
    )
  );
}
