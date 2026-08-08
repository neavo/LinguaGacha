import {
  estimateContextTokens,
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
} from "@earendil-works/pi-agent-core";
import {
  contentText,
  InMemoryCredentialStore,
  type AssistantMessage,
  type AssistantMessageEvent,
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
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  AGENT_SESSION_EVENT_TOPIC,
  format_agent_skill_reference,
  normalize_agent_user_message_text,
  type AgentAssistantMessagePart,
  type AgentEntry,
  type AgentEntryStatus,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleAnalysisCache } from "../cache/quality-rule-analysis-cache";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import type { ProjectSessionState } from "../project/project-session-state";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import { create_agent_item_tools, type AgentProofreading } from "./agent-item-tools";
import { register_agent_model } from "./agent-model";
import { create_agent_project_tools } from "./agent-project-tools";
import { create_agent_quality_tools } from "./agent-quality-tools";
import {
  append_agent_session_seed,
  load_agent_session_seed,
  type AgentSessionSeed,
} from "./agent-session-seed";
import { create_agent_skill_tools } from "./agent-skill-tools";
import { create_agent_web_tools, type AgentWebFetchPort } from "./agent-web-tools";
import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";
import { load_agent_skills, type AgentSkillDefinition } from "./agent-skills";
import { load_agent_system_prompt } from "./agent-system-prompt";
import { log_agent_tool_event, wrap_agent_tool_execution } from "./agent-tool";

const AGENT_KEEP_RECENT_TOKENS = 32_000; // 产品固定保留的最近模型可见历史
const AGENT_STREAM_PUBLISH_INTERVAL_MS = 100; // assistant 完整公开条目最多 10Hz；工具与终态不等待
const AGENT_CONTINUE_TEXT = "继续"; // 内部续跑与用户触发的恢复使用同一模型语义

/** 产品会话使用固定压缩预算，不读取 coding-agent 用户设置。 */
function build_agent_session_settings() {
  return {
    enableInstallTelemetry: false,
    enableSkillCommands: false,
    compaction: {
      enabled: true,
      reserveTokens: AGENT_COMPACTION_RESERVE_TOKENS,
      keepRecentTokens: AGENT_KEEP_RECENT_TOKENS,
    },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 2_000 },
  };
}

/** 普通发送与压缩恢复按同一 marker 规则重建模型提示。 */
function select_agent_skills(
  skills: readonly AgentSkillDefinition[],
  text: string,
): AgentSkillDefinition[] {
  return skills
    .map((skill) => ({ skill, index: text.indexOf(format_agent_skill_reference(skill.name)) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.skill);
}

type AgentRuntime = {
  session: AgentSession;
  unsubscribe: () => void;
  checkpoint_requested: boolean; // 工具批次结束后是否因容量主动停在安全边界
};

type AgentAssistantStreamBlock = {
  content_index: number;
  kind: "text" | "thinking";
  chunks: string[];
};

type AgentAssistantStream = {
  created_at: number;
  blocks: AgentAssistantStreamBlock[];
};

type AgentAssistantStreamDelta = Extract<
  AssistantMessageEvent,
  { type: "text_delta" | "thinking_delta" }
>;

type AgentServiceCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems" | "readItem">;
};

type AgentServicePaths = Pick<
  AppPathService,
  | "get_app_root"
  | "get_agent_builtin_skill_dir"
  | "get_agent_user_skill_dir"
  | "get_agent_system_prompt_path"
  | "get_agent_session_seed_path"
>;

type AgentServiceOptions = {
  paths: AgentServicePaths;
  settings: Pick<AppSettingService, "read_setting">;
  userAgent: string;
  sessionState: ProjectSessionState;
  cache: AgentServiceCache;
  qualityAnalysis: Pick<QualityRuleAnalysisCache, "read">;
  qualityRules: Pick<QualityRuleService, "query" | "update_from_agent">;
  proofreading: AgentProofreading;
  runtimeGate: RuntimeOperationGate;
  webFetch: AgentWebFetchPort | undefined;
  workspace?: AgentWorkspacePort;
  logManager: Pick<LogManager, "append" | "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

type LoadedAgentResources = Readonly<{
  systemPrompt: string;
  sessionSeed: AgentSessionSeed;
  skills: readonly AgentSkillDefinition[];
}>;

/**
 * 单个后端 Agent 产品会话的状态拥有者；通用模型生命周期交给 AgentSession。
 */
export class AgentService {
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly user_agent: string;
  private readonly session_state: ProjectSessionState;
  private readonly cache: AgentServiceOptions["cache"];
  private readonly quality_analysis: AgentServiceOptions["qualityAnalysis"];
  private readonly quality_rules: AgentServiceOptions["qualityRules"];
  private readonly proofreading: AgentServiceOptions["proofreading"];
  private readonly runtime_gate: RuntimeOperationGate; // task / Agent 互斥与 Agent 写工具授权来源
  private readonly web_fetch: AgentWebFetchPort | undefined; // 缺失即不向模型注册 GUI 专属联网工具
  private readonly workspace: AgentWorkspacePort | undefined; // 缺失即不注册 Electron 专属磁盘工作区
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型历史只存活于当前工程会话世代
  private session_reset: Promise<void> | null = null; // 清理完成前禁止新消息跨会话进入
  private operation_acceptance: Promise<AgentSessionSnapshot> | null = null; // 串行覆盖建会话、换模与压缩重试
  private runtime_settlement: Promise<void> | null = null; // SDK idle 未覆盖 preflight，统一纳入关闭屏障
  private runtime_lease: RuntimeLease | null = null; // 从消息受理覆盖到 SDK 最终 settle
  private runtime_generation = 0; // stop/reset/dispose 统一令迟到异步阶段失效
  private state: AgentSessionState = "idle"; // 只表达当前回合是否运行，结果归各条目
  private entries: AgentEntry[] = []; // 本次 reset 以来唯一的公开时间线事实
  private context_tokens: number | null = null; // 压缩终态优先采用 SDK 新历史估算，避免复用旧 usage
  private assistant_stream: AgentAssistantStream | null = null; // 当前生成消息的窄字符串增量
  private assistant_stream_publish_timer: ReturnType<typeof setTimeout> | null = null;
  private resources: LoadedAgentResources | null = null; // 启动期一次性加载的原子资源集，null 表示未完成加载
  private disposed = false;

  /** 会话订阅返回 reset Promise，保证工程生命周期等待旧 Agent 完整退出。 */
  public constructor(options: AgentServiceOptions) {
    this.paths = options.paths;
    this.settings = options.settings;
    this.user_agent = options.userAgent;
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.quality_analysis = options.qualityAnalysis;
    this.quality_rules = options.qualityRules;
    this.proofreading = options.proofreading;
    this.runtime_gate = options.runtimeGate;
    this.web_fetch = options.webFetch;
    this.workspace = options.workspace;
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.unsubscribe_project_session = this.session_state.subscribe_change(() =>
      this.reset_session(),
    );
  }

  /** 返回仅含不可变投影的公开快照，避免 API 调用方持有会话内部引用。 */
  public get_snapshot(): AgentSessionSnapshot {
    return {
      state: this.state,
      entries: structuredClone(this.entries),
      skills: (this.resources?.skills ?? [])
        .filter(({ visible }) => visible)
        .map(({ name, displayDescriptions }) => ({
          name,
          displayDescriptions: { ...displayDescriptions },
        })),
      contextTokens: this.context_tokens,
    };
  }

  /** 启动期原子加载必需的基础 Prompt、会话种子和可降级的 skill 清单。 */
  public async load_resources(): Promise<void> {
    await this.workspace?.initialize();
    const system_prompt = load_agent_system_prompt(this.paths);
    const session_seed = load_agent_session_seed(this.paths);
    const skills = await load_agent_skills(this.paths, this.log_manager);
    const skills_prompt = formatSkillsForSystemPrompt(skills);
    this.resources = {
      systemPrompt: skills_prompt === "" ? system_prompt : `${system_prompt}\n\n${skills_prompt}`,
      sessionSeed: session_seed,
      skills,
    };
  }

  /** 同步校验消息，以单一 Promise 串行完成建会话或刷新模型请求快照。 */
  public async send_message(request: JsonRecord): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.RuntimeBusyError();
    }
    const resources = this.require_resources();
    this.session_state.require_loaded_project_path();
    const text = normalize_agent_user_message_text(request["text"]);
    if (text === null) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_agent_message" },
      });
    }
    if (this.find_latest_compaction_entry()?.status === "error") {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_compaction_recovery_required" },
      });
    }
    const selected_skills = select_agent_skills(resources.skills, text);
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    const acceptance = this.accept_message(resources, text, selected_skills, runtime_lease);
    this.operation_acceptance = acceptance;
    const clear_acceptance = () => {
      if (this.operation_acceptance === acceptance) this.operation_acceptance = null;
    };
    void acceptance.then(clear_acceptance, clear_acceptance);
    return await acceptance;
  }

  /** 重试最近一次失败压缩；未完成轮次恢复后以普通“继续”消息重新进入模型。 */
  public async retry_compaction(): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle") {
      throw new AppErrors.RuntimeBusyError();
    }
    this.session_state.require_loaded_project_path();
    const runtime = this.runtime;
    const failed_entry = this.find_latest_compaction_entry();
    if (
      runtime === null ||
      failed_entry?.kind !== "context_compaction" ||
      failed_entry.status !== "error"
    ) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_compaction_retry_unavailable" },
      });
    }
    // 只有被中途压缩打断的失败轮次需要续跑；已完成回答只恢复模型历史。
    const resume_failed_round =
      this.entries.findLast((entry) => entry.kind === "user_message")?.status === "error";
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    const acceptance = this.accept_compaction_retry(
      runtime,
      failed_entry,
      resume_failed_round,
      runtime_lease,
    );
    this.operation_acceptance = acceptance;
    const clear_acceptance = () => {
      if (this.operation_acceptance === acceptance) this.operation_acceptance = null;
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

  /** 立即封口公开轮次并保留历史；压缩是不可停止的原子阶段。 */
  public stop(): AgentSessionSnapshot {
    this.assert_not_disposed();
    if (
      this.find_open_compaction_entry() !== undefined ||
      this.runtime?.session.isCompacting === true
    ) {
      throw new AppErrors.RuntimeBusyError();
    }
    this.flush_assistant_stream();
    this.runtime_generation += 1;
    this.finish_current_round("stopped");
    this.set_state("idle");
    const runtime = this.runtime;
    if (runtime !== null) {
      try {
        runtime.session.abortCompaction();
      } catch (error) {
        this.warn_cleanup_failure(error);
      }
      void runtime.session.abort().catch((error: unknown) => this.warn_cleanup_failure(error));
    }
    return this.get_snapshot();
  }

  /** dispose 不再发布事件，但会等待 reset、消息受理与所有运行时清理。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clear_assistant_stream();
    this.runtime_generation += 1;
    this.unsubscribe_project_session();
    const runtime = this.runtime;
    const reset = this.session_reset;
    const acceptance = this.operation_acceptance;
    const settlement = this.runtime_settlement;
    this.runtime = null;
    await Promise.all([
      reset,
      acceptance?.catch(() => undefined),
      settlement?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
    ]);
    await this.workspace?.reset();
  }

  /** 在当前运行世代内准备唯一候选运行时。 */
  private async accept_message(
    resources: LoadedAgentResources,
    text: string,
    selected_skills: AgentSkillDefinition[],
    runtime_lease: RuntimeLease,
  ): Promise<AgentSessionSnapshot> {
    let prompt_started = false;
    try {
      const generation = this.runtime_generation;
      const model_settings = this.settings.read_setting();
      let runtime = this.runtime;
      const created = runtime === null;
      let candidate_closed = false;

      try {
        if (runtime === null) {
          runtime = await this.create_runtime(resources, model_settings);
        } else {
          await this.update_runtime_model(runtime, model_settings);
        }

        if (this.disposed || generation !== this.runtime_generation) {
          if (created || this.runtime === runtime) {
            if (this.runtime === runtime) this.runtime = null;
            await this.close_runtime(runtime);
            candidate_closed = true;
          }
          throw new AppErrors.RequestValidationError({
            diagnostic_context: { reason: "agent_message_invalidated" },
          });
        }
        if (created) {
          this.runtime = runtime;
          this.context_tokens = estimateContextTokens(runtime.session.messages).tokens;
        }
      } catch (error) {
        if (created && runtime !== null && this.runtime !== runtime && !candidate_closed) {
          await this.close_runtime(runtime);
        }
        throw error;
      }

      const prompt = this.start_round(runtime, generation, text, selected_skills, runtime_lease);
      this.runtime_settlement = prompt;
      prompt_started = true;
      const clear_prompt = () => {
        if (this.runtime_settlement === prompt) this.runtime_settlement = null;
      };
      void prompt.then(clear_prompt, clear_prompt);
      return this.get_snapshot();
    } finally {
      if (!prompt_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 重试受理只更新现有运行时模型并原位推进失败条目，不建立第二套压缩状态。 */
  private async accept_compaction_retry(
    runtime: AgentRuntime,
    failed_entry: Extract<AgentEntry, { kind: "context_compaction" }>,
    resume_failed_round: boolean,
    runtime_lease: RuntimeLease,
  ): Promise<AgentSessionSnapshot> {
    let compaction_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (this.disposed || generation !== this.runtime_generation || this.runtime !== runtime) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "agent_compaction_retry_invalidated" },
        });
      }
      this.upsert_entry({ ...failed_entry, status: "running" });
      const compaction = this.run_compaction(
        runtime,
        generation,
        resume_failed_round,
        runtime_lease,
      );
      this.runtime_settlement = compaction;
      compaction_started = true;
      const clear_compaction = () => {
        if (this.runtime_settlement === compaction) this.runtime_settlement = null;
      };
      void compaction.then(clear_compaction, clear_compaction);
      return this.get_snapshot();
    } finally {
      if (!compaction_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 所有新尝试都追加独立 user 轮次，失败历史保持可追踪。 */
  private start_round(
    runtime: AgentRuntime,
    generation: number,
    text: string,
    selected_skills: AgentSkillDefinition[],
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    this.upsert_entry({
      kind: "user_message",
      id: uuidv7(),
      text,
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
    });
    this.set_state("running");
    return this.run_prompt(
      runtime,
      generation,
      build_agent_prompt(text, selected_skills),
      runtime_lease,
    );
  }

  /** 同一请求快照同时更新模型身份、容量、压缩预留与思考等级。 */
  private async update_runtime_model(
    runtime: AgentRuntime,
    model_settings: JsonRecord,
  ): Promise<void> {
    const resolved_model = register_agent_model(
      runtime.session.modelRuntime,
      model_settings,
      this.user_agent,
    );
    await runtime.session.setModel(resolved_model.model);
    runtime.session.settingsManager.applyOverrides(build_agent_session_settings());
    runtime.session.setThinkingLevel(resolved_model.thinkingLevel);
  }

  /** 创建完全内存化的 SDK 会话，并关闭默认工具与运行期资源发现。 */
  private async create_runtime(
    resources: LoadedAgentResources,
    model_settings: JsonRecord,
  ): Promise<AgentRuntime> {
    const app_root = this.paths.get_app_root();
    const model_runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const resolved_model = register_agent_model(model_runtime, model_settings, this.user_agent);
    const settings_manager = SettingsManager.inMemory(build_agent_session_settings(), {
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
      systemPrompt: resources.systemPrompt,
      appendSystemPrompt: [],
    });
    await resource_loader.reload();
    const session_manager = SessionManager.inMemory(app_root);
    append_agent_session_seed(session_manager, resources.sessionSeed, resolved_model.model);
    const { session } = await createAgentSession({
      cwd: app_root,
      agentDir: app_root,
      modelRuntime: model_runtime,
      model: resolved_model.model,
      thinkingLevel: resolved_model.thinkingLevel,
      noTools: "builtin",
      customTools: [
        ...create_agent_project_tools({
          settings: this.settings,
          sessionState: this.session_state,
        }),
        ...create_agent_quality_tools({
          qualityRules: this.quality_rules,
          qualityAnalysis: this.quality_analysis,
        }),
        ...create_agent_item_tools({
          cache: this.cache,
          proofreading: this.proofreading,
        }),
        ...(this.workspace === undefined ? [] : create_agent_workspace_tools(this.workspace)),
        ...create_agent_skill_tools(resources.skills),
        ...(this.web_fetch === undefined ? [] : create_agent_web_tools(this.web_fetch)),
      ].map((tool) => wrap_agent_tool_execution(tool, this.log_manager)),
      resourceLoader: resource_loader,
      sessionManager: session_manager,
      settingsManager: settings_manager,
    });
    const runtime: AgentRuntime = {
      session,
      unsubscribe: () => undefined,
      checkpoint_requested: false,
    };
    session.agent.shouldStopAfterTurn = ({ toolResults, context }) => {
      const context_window = session.model?.contextWindow;
      const should_stop =
        toolResults.length > 0 &&
        context_window !== undefined &&
        estimateContextTokens(context.messages).tokens >=
          context_window - AGENT_COMPACTION_RESERVE_TOKENS;
      runtime.checkpoint_requested = should_stop;
      return should_stop;
    };
    runtime.unsubscribe = session.subscribe((event) => {
      log_agent_tool_event(this.log_manager, event);
      if (this.runtime?.session === session) this.handle_agent_event(event);
    });
    return runtime;
  }

  /** 每个安全检查点都先完成压缩再隐藏续跑；只有整个用户任务 settle 才决定公开终态。 */
  private async run_prompt(
    runtime: AgentRuntime,
    generation: number,
    text: string,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    let outcome: Extract<AgentEntryStatus, "success" | "error"> = "success";
    try {
      runtime.checkpoint_requested = false;
      let previous_compaction_id = this.find_latest_compaction_entry()?.id;
      await runtime.session.prompt(text, {
        expandPromptTemplates: false,
        // SDK 在异步 preflight 完成前仍处于 idle；失效后必须在真正启动模型前截断。
        preflightResult: (accepted) => {
          if (accepted && !this.prompt_is_current(runtime, generation)) {
            throw new AppErrors.RuntimeCancelledError({
              diagnostic_context: {
                resource: "agent_prompt",
                reason: "agent_message_invalidated",
              },
            });
          }
        },
      });
      while (this.prompt_is_current(runtime, generation) && runtime.checkpoint_requested) {
        const compaction = this.find_latest_compaction_entry();
        // SDK 可能已在 prompt settle 前自动压缩；只有未观察到新条目时才手动补足。
        const compacted =
          compaction?.id !== previous_compaction_id
            ? compaction?.status === "success"
            : await this.compact_checkpoint(runtime, generation);
        if (!compacted) {
          outcome = "error";
          break;
        }
        runtime.checkpoint_requested = false;
        previous_compaction_id = this.find_latest_compaction_entry()?.id;
        await runtime.session.sendCustomMessage(
          {
            customType: "linguagacha_continue",
            content: [{ type: "text", text: AGENT_CONTINUE_TEXT }],
            display: false,
          },
          { triggerTurn: true },
        );
      }
      if (this.prompt_is_current(runtime, generation)) {
        const final_assistant = runtime.session.messages.findLast(
          (message): message is AssistantMessage => message.role === "assistant",
        );
        if (final_assistant?.stopReason === "error") {
          outcome = "error";
          this.log_request_failure(new Error(final_assistant.errorMessage ?? "Agent 模型回合失败"));
        }
      }
    } catch (error) {
      if (this.prompt_is_current(runtime, generation)) {
        outcome = "error";
        this.log_request_failure(error);
      }
    } finally {
      if (this.prompt_is_current(runtime, generation)) {
        this.flush_assistant_stream();
        this.finish_current_round(outcome);
        this.set_state("idle");
      }
      this.finish_runtime(runtime_lease);
    }
  }

  /** AgentSession 完全 settle 后才手动压缩，避免拆开工具调用与结果。 */
  private async compact_checkpoint(runtime: AgentRuntime, generation: number): Promise<boolean> {
    try {
      await runtime.session.compact();
      return this.prompt_is_current(runtime, generation);
    } catch {
      // SDK compaction_end 已发布权威失败条目和诊断；失败后不得发起下一次模型请求。
      return false;
    }
  }

  /** 压缩与固定“继续”轮次共用运行 lease，避免 renderer 监听终态后补偿。 */
  private async run_compaction(
    runtime: AgentRuntime,
    generation: number,
    resume_failed_round: boolean,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    let prompt_started = false;
    try {
      await runtime.session.compact();
      if (resume_failed_round && this.runtime_is_current(runtime, generation)) {
        const prompt = this.start_round(
          runtime,
          generation,
          AGENT_CONTINUE_TEXT,
          [],
          runtime_lease,
        );
        prompt_started = true;
        await prompt;
      }
    } catch {
      // SDK compaction_end 已发布权威失败条目和诊断，命令 Promise 不建立第二套错误通道。
    } finally {
      if (!prompt_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 将 SDK 事件收窄为按真实顺序追加的公开时间线；中间失败不冒充最终失败。 */
  private handle_agent_event(event: PiAgentSessionEvent): void {
    if (event.type === "compaction_start") {
      const retry_entry = this.find_latest_compaction_entry();
      if (retry_entry?.status === "running") return;
      this.upsert_entry(
        retry_entry?.status === "error"
          ? { ...retry_entry, status: "running" }
          : {
              kind: "context_compaction",
              id: uuidv7(),
              status: "running",
              createdAt: Date.now(),
            },
      );
      return;
    }
    if (event.type === "compaction_end") {
      const result = event.result;
      const entry = this.find_open_compaction_entry() ?? {
        kind: "context_compaction" as const,
        id: uuidv7(),
        status: "running" as const,
        createdAt: Date.now(),
      };
      const success = result !== undefined && !event.aborted && event.errorMessage === undefined;
      this.upsert_entry({ ...entry, status: success ? "success" : "error" });
      if (event.errorMessage !== undefined) {
        this.log_manager.warning(t_main_log("app.diagnostic.agent.context_compaction_failed"), {
          source: "agent",
          context: { reason: event.reason, error: event.errorMessage },
        });
      }
      if (success) this.publish_context_tokens(result.estimatedTokensAfter);
      return;
    }
    // stop 会先切 idle 再取消 SDK，因此取消过程中到达的事件天然失效。
    if (this.state !== "running") return;
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent.type === "text_delta" ||
        event.assistantMessageEvent.type === "thinking_delta")
    ) {
      this.append_assistant_stream_delta(event.assistantMessageEvent);
      return;
    }
    if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        this.clear_assistant_stream();
        this.upsert_assistant_message(
          event.message,
          event.message.stopReason === "error" ? "error" : "success",
        );
      }
      this.publish_context_tokens();
      return;
    }
    if (event.type === "tool_execution_start") {
      // SDK 参数先序列化为不可变公开值，后续执行不得通过原对象引用改写时间线输入。
      this.upsert_entry({
        kind: "tool_call",
        id: event.toolCallId,
        toolName: event.toolName,
        input: JsonTool.stringifyStrict(event.args),
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
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: {
            reason: "agent_tool_start_missing",
            tool_call_id: event.toolCallId,
          },
        });
      }
      this.upsert_entry({
        ...running_entry,
        status: event.isError ? "error" : "success",
        output: contentText(event.result.content, ""),
      });
    }
  }

  /** Pi 以最终 assistant 承载模型错误；公开状态由轮次终态统一表达。 */
  private log_request_failure(error: unknown): void {
    this.log_manager.error(t_main_log("app.diagnostic.agent.model_round_failed"), {
      source: "agent",
      error,
    });
  }

  /** 以 Pi 的完整 partial / final 消息校正公开 parts，同一模型消息始终原位覆盖。 */
  private upsert_assistant_message(message: AssistantMessage, status: AgentEntryStatus): void {
    this.upsert_assistant_parts(
      project_assistant_message_parts(message),
      message.timestamp,
      status,
    );
  }

  /** running 与 canonical final 复用同一条目身份和覆盖规则。 */
  private upsert_assistant_parts(
    parts: AgentAssistantMessagePart[],
    created_at: number,
    status: AgentEntryStatus,
  ): void {
    const existing = this.find_open_assistant_entry();
    if (existing === undefined) {
      if (parts.length === 0) return;
      this.upsert_entry({
        kind: "assistant_message",
        id: uuidv7(),
        parts,
        status,
        createdAt: created_at,
      });
    } else {
      this.upsert_entry({ ...existing, parts, status });
    }
  }

  /** 单个 SDK delta 只保存窄字符串，完整投影延迟到固定发布窗口。 */
  private append_assistant_stream_delta(event: AgentAssistantStreamDelta): void {
    if (event.delta === "") return;
    const kind = event.type === "text_delta" ? "text" : "thinking";
    const content = event.partial.content[event.contentIndex];
    if (content?.type !== kind || (content.type === "thinking" && content.redacted === true)) {
      return;
    }
    const stream = (this.assistant_stream ??= {
      created_at: event.partial.timestamp,
      blocks: [],
    });
    const last = stream.blocks.at(-1);
    if (last?.content_index === event.contentIndex) last.chunks.push(event.delta);
    else stream.blocks.push({ content_index: event.contentIndex, kind, chunks: [event.delta] });
    if (this.assistant_stream_publish_timer !== null) return;
    this.assistant_stream_publish_timer = setTimeout(() => {
      this.assistant_stream_publish_timer = null;
      this.publish_assistant_stream();
    }, AGENT_STREAM_PUBLISH_INTERVAL_MS);
  }

  /** 发布当前完整累积内容，但保留增量供下一窗口继续追加。 */
  private publish_assistant_stream(): void {
    const stream = this.assistant_stream;
    if (stream === null) return;
    const parts: AgentAssistantMessagePart[] = [];
    for (const block of stream.blocks) {
      append_assistant_message_part(parts, block.kind, block.chunks.join(""));
    }
    this.upsert_assistant_parts(parts, stream.created_at, "running");
  }

  /** stop 与异常收尾公开窗口内最新正文后销毁流。 */
  private flush_assistant_stream(): void {
    if (this.assistant_stream_publish_timer !== null) {
      clearTimeout(this.assistant_stream_publish_timer);
      this.assistant_stream_publish_timer = null;
    }
    try {
      this.publish_assistant_stream();
    } finally {
      this.assistant_stream = null;
    }
  }

  /** final、reset 与 dispose 丢弃非权威增量，阻止迟到 timer 回流。 */
  private clear_assistant_stream(): void {
    if (this.assistant_stream_publish_timer !== null) {
      clearTimeout(this.assistant_stream_publish_timer);
      this.assistant_stream_publish_timer = null;
    }
    this.assistant_stream = null;
  }

  /** 同 id 只替换原位置，确保工具终帧不会改变后端确认的时间线顺序。 */
  private upsert_entry(entry: AgentEntry): void {
    const next = structuredClone(entry);
    const index = this.entries.findIndex((item) => item.id === entry.id);
    if (index < 0) this.entries.push(next);
    else this.entries[index] = next;
    this.publish_event({ type: "entry_upsert", entry: next });
  }

  /** 流式增量只归入最后一个尚未终结的 assistant 条目。 */
  private find_open_assistant_entry():
    | Extract<AgentEntry, { kind: "assistant_message" }>
    | undefined {
    return this.entries.findLast(
      (entry): entry is Extract<AgentEntry, { kind: "assistant_message" }> =>
        entry.kind === "assistant_message" && entry.status === "running",
    );
  }

  /** 未解决压缩跨自动重试与手动重试保持单一条目身份。 */
  private find_latest_compaction_entry():
    | Extract<AgentEntry, { kind: "context_compaction" }>
    | undefined {
    return this.entries.findLast(
      (entry): entry is Extract<AgentEntry, { kind: "context_compaction" }> =>
        entry.kind === "context_compaction",
    );
  }

  /** 压缩终态只覆盖当前 running 条目。 */
  private find_open_compaction_entry():
    | Extract<AgentEntry, { kind: "context_compaction" }>
    | undefined {
    const entry = this.find_latest_compaction_entry();
    return entry?.status === "running" ? entry : undefined;
  }

  /** 先封口本轮开放的子条目，再冻结轮次结果；终态只在后端写一次。 */
  private finish_current_round(
    outcome: Extract<AgentEntryStatus, "success" | "error" | "stopped">,
  ): void {
    const user_index = this.entries.findLastIndex(
      (entry) => entry.kind === "user_message" && entry.status === "running",
    );
    if (user_index < 0) return;
    for (const entry of this.entries.slice(user_index + 1)) {
      if (entry.status !== "running") continue;
      // 压缩终态只由 SDK compaction_end 确认，轮次收尾不代写结果。
      if (entry.kind === "context_compaction") continue;
      if (entry.kind === "tool_call") {
        this.upsert_entry({ ...entry, status: "stopped", output: null });
        continue;
      }
      this.upsert_entry({ ...entry, status: outcome });
    }
    const user = this.entries[user_index];
    if (user?.kind === "user_message") {
      this.upsert_entry({ ...user, status: outcome, endedAt: Date.now() });
    }
  }

  /** 普通模型消息使用最新 usage；压缩成功则由事件直接提供新历史估算。 */
  private read_context_tokens(): number | null {
    const session = this.runtime?.session;
    return session === undefined ? null : estimateContextTokens(session.messages).tokens;
  }

  /** 每次模型历史变化后发布与 snapshot 同形的 token 估算。 */
  private publish_context_tokens(tokens?: number): void {
    const context_tokens = tokens ?? this.read_context_tokens();
    if (context_tokens !== null) {
      this.context_tokens = context_tokens;
      this.publish_event({ type: "context_tokens", contextTokens: context_tokens });
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
    this.clear_assistant_stream();
    const runtime = this.runtime;
    const acceptance = this.operation_acceptance;
    const settlement = this.runtime_settlement;
    this.runtime = null;
    this.state = "idle";
    this.entries = [];
    this.context_tokens = null;
    if (!this.disposed) {
      this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
    }
    const reset = Promise.all([
      acceptance?.catch(() => undefined),
      settlement?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
    ])
      .then(async () => await this.workspace?.reset())
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
    this.log_manager.warning(t_main_log("app.diagnostic.agent.session_cleanup_failed"), {
      source: "agent",
      error,
    });
  }

  /** 同时清除本地引用和共享 owner；迟到 lease 由 gate 身份校验忽略。 */
  private finish_runtime(lease: RuntimeLease): void {
    if (this.runtime_lease === lease) this.runtime_lease = null;
    this.runtime_gate.finish_runtime(lease);
  }

  /** 运行时世代守卫供压缩与 prompt 共用，不把 idle 压缩误判为失效。 */
  private runtime_is_current(runtime: AgentRuntime, generation: number): boolean {
    return this.runtime === runtime && generation === this.runtime_generation;
  }

  /** prompt 只有仍绑定当前运行时、未被终止且处于公开回合时才能发布最终状态。 */
  private prompt_is_current(runtime: AgentRuntime, generation: number): boolean {
    return this.runtime_is_current(runtime, generation) && this.state === "running";
  }

  /** 资源加载是发送消息的硬前置，不能用部分资源降级启动。 */
  private require_resources(): LoadedAgentResources {
    if (this.resources === null) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "agent_resources_not_loaded" },
      });
    }
    return this.resources;
  }

  /** dispose 后的命令必须失败，避免重新创建已脱离订阅的运行时。 */
  private assert_not_disposed(): void {
    if (this.disposed) throw new AppErrors.RuntimeDisposedError();
  }
}

/** skill 指令块按 marker 首次出现顺序置前，原始用户正文始终随后进入历史。 */
function build_agent_prompt(text: string, skills: readonly AgentSkillDefinition[]): string {
  if (skills.length === 0) return text;
  const blocks = skills.map((skill) => formatSkillInvocation(skill));
  blocks.push(text);
  return blocks.join("\n\n");
}

/** 将 Pi 内容投影成唯一公开形状；相邻同类块合并，脱敏思考和连续性元数据不外泄。 */
function project_assistant_message_parts(message: AssistantMessage): AgentAssistantMessagePart[] {
  const parts: AgentAssistantMessagePart[] = [];
  for (const content of message.content) {
    if (content.type === "text") append_assistant_message_part(parts, "text", content.text);
    else if (content.type === "thinking" && !content.redacted) {
      append_assistant_message_part(parts, "thinking", content.thinking);
    }
  }
  return parts;
}

/** 过滤不可见内容后合并相邻同类块，确保流帧与最终消息使用同一公开规则。 */
function append_assistant_message_part(
  parts: AgentAssistantMessagePart[],
  kind: AgentAssistantMessagePart["kind"],
  text: string,
): void {
  if (text === "" || (kind === "thinking" && text.trim() === "")) return;
  const previous = parts.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else parts.push({ kind, text });
}
