import { scheduler } from "node:timers/promises";

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
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import {
  AGENT_SESSION_EVENT_TOPIC,
  format_agent_user_message_text,
  normalize_agent_user_message_parts,
  type AgentAssistantMessagePart,
  type AgentContextUsage,
  type AgentEntry,
  type AgentEntryStatus,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
  type AgentUserMessagePart,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { LogManager } from "../log/log-manager";
import type { ProjectSessionState } from "../project/project-session-state";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { create_agent_item_tools, type AgentProofreading } from "./agent-item-tools";
import { register_agent_model, type AgentModelLimits } from "./agent-model";
import { create_agent_project_tools } from "./agent-project-tools";
import { create_agent_quality_tools } from "./agent-quality-tools";
import {
  append_agent_session_seed,
  load_agent_session_seed,
  type AgentSessionSeed,
} from "./agent-session-seed";
import { create_agent_skill_tools } from "./agent-skill-tools";
import { create_agent_web_tools, type AgentWebFetchPort } from "./agent-web-tools";
import { load_agent_skills, type AgentSkillDefinition } from "./agent-skills";
import { load_agent_system_prompt } from "./agent-system-prompt";

const AGENT_KEEP_RECENT_TOKENS = 32_000; // 产品固定保留的最近模型可见历史
const AGENT_STREAM_PUBLISH_INTERVAL_MS = 100; // assistant 完整公开条目最多 10Hz；工具与终态不等待

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

/** 统一保证 SSE 首帧时序，并让模型可见错误正文显式表达失败状态。 */
function wrap_agent_tool_execution(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    execute: async (...args: Parameters<ToolDefinition["execute"]>) => {
      await scheduler.yield();
      try {
        return await tool.execute(...args);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`工具调用失败：${message}`, { cause });
      }
    },
  };
}

type AgentRuntime = {
  session: AgentSession;
  limits: AgentModelLimits; // 换模时继续传回 Provider，维持当前对话容量
  unsubscribe: () => void;
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
  qualityRules: Pick<QualityRuleService, "query" | "update_from_agent">;
  proofreading: AgentProofreading;
  runtimeGate: RuntimeOperationGate;
  computeWorker: ComputeWorkerClient;
  webFetch: AgentWebFetchPort | undefined;
  logManager: Pick<LogManager, "error" | "warning">;
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
  private readonly quality_rules: AgentServiceOptions["qualityRules"];
  private readonly proofreading: AgentServiceOptions["proofreading"];
  private readonly runtime_gate: RuntimeOperationGate; // task / Agent 互斥与 Agent 写工具授权来源
  private readonly compute_worker: ComputeWorkerClient;
  private readonly web_fetch: AgentWebFetchPort | undefined; // 缺失即不向模型注册 GUI 专属联网工具
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型历史只存活于当前工程会话世代
  private session_reset: Promise<void> | null = null; // 清理完成前禁止新消息跨会话进入
  private message_acceptance: Promise<AgentSessionSnapshot> | null = null; // 串行覆盖异步建会话与换模
  private prompt_settlement: Promise<void> | null = null; // SDK idle 尚未覆盖异步 preflight，单独纳入关闭屏障
  private runtime_lease: RuntimeLease | null = null; // 从消息受理覆盖到 SDK 最终 settle
  private runtime_generation = 0; // stop/reset/dispose 统一令迟到异步阶段失效
  private state: AgentSessionState = "idle"; // 只表达当前回合是否运行，结果归各条目
  private entries: AgentEntry[] = []; // 本次 reset 以来唯一的公开时间线事实
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
    this.quality_rules = options.qualityRules;
    this.proofreading = options.proofreading;
    this.runtime_gate = options.runtimeGate;
    this.compute_worker = options.computeWorker;
    this.web_fetch = options.webFetch;
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
      skills: (this.resources?.skills ?? []).map(({ name, displayDescriptions }) => ({
        name,
        displayDescriptions: { ...displayDescriptions },
      })),
      contextUsage: this.read_context_usage(),
    };
  }

  /** 启动期原子加载必需的基础 Prompt、会话种子和可降级的 skill 清单。 */
  public async load_resources(): Promise<void> {
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

  /**
   * 同步校验消息，以单一 Promise 串行完成建会话或换模后再公开受理结果。
   */
  public async send_message(request: JsonRecord): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.RuntimeBusyError();
    }
    const resources = this.require_resources();
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
      const skill = resources.skills.find((candidate) => candidate.name === part.name);
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
    const acceptance = this.accept_message(resources, parts, selected_skills, runtime_lease);
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

  /** 在当前运行世代内准备唯一候选运行时。 */
  private async accept_message(
    resources: LoadedAgentResources,
    parts: AgentUserMessagePart[],
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
          const resolved_model = register_agent_model(
            runtime.session.modelRuntime,
            model_settings,
            this.user_agent,
            runtime.limits,
          );
          await runtime.session.setModel(resolved_model.model);
          runtime.session.setThinkingLevel(resolved_model.thinkingLevel);
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
        status: "running",
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
          cache: this.cache,
          computeWorker: this.compute_worker,
        }),
        ...create_agent_item_tools({
          cache: this.cache,
          proofreading: this.proofreading,
        }),
        ...create_agent_skill_tools(resources.skills, (name) =>
          this.is_skill_explicitly_invoked(name),
        ),
        ...(this.web_fetch === undefined ? [] : create_agent_web_tools(this.web_fetch)),
      ].map(wrap_agent_tool_execution),
      resourceLoader: resource_loader,
      sessionManager: session_manager,
      settingsManager: settings_manager,
    });
    const unsubscribe = session.subscribe((event) => {
      if (this.runtime?.session === session) this.handle_agent_event(event);
    });
    return { session, limits, unsubscribe };
  }

  /** prompt() 已覆盖自动重试与溢出恢复；只有最终 settle 才决定公开终态。 */
  private async run_prompt(
    runtime: AgentRuntime,
    generation: number,
    text: string,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    let outcome: Extract<AgentEntryStatus, "success" | "error"> = "success";
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

  /** 将 SDK 事件收窄为按真实顺序追加的公开时间线；中间失败不冒充最终失败。 */
  private handle_agent_event(event: PiAgentSessionEvent): void {
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

  /** Pi 以最终 assistant 承载模型错误；公开状态由轮次终态统一表达。 */
  private log_request_failure(error: unknown): void {
    this.log_manager.error("Agent 模型回合失败", { source: "agent", error });
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
      this.upsert_entry({
        ...entry,
        status: entry.kind === "tool_call" && outcome !== "success" ? "stopped" : outcome,
      });
    }
    const user = this.entries[user_index];
    if (user?.kind === "user_message") {
      this.upsert_entry({ ...user, status: outcome, endedAt: Date.now() });
    }
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
    this.clear_assistant_stream();
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

  /** prompt 只有仍绑定当前运行时且未被终止时才能发布最终状态。 */
  private prompt_is_current(runtime: AgentRuntime, generation: number): boolean {
    return (
      this.runtime === runtime && generation === this.runtime_generation && this.state === "running"
    );
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
