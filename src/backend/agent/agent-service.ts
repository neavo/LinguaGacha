import { estimateContextTokens } from "@earendil-works/pi-agent-core";
import {
  contentText,
  InMemoryCredentialStore,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
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

import { resolve_app_locale } from "../../domain/app-language";
import type { JsonRecord } from "../../domain/json";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  AGENT_SESSION_EVENT_TOPIC,
  find_agent_reference_ranges,
  format_agent_skill_reference,
  normalize_agent_message_input,
  normalize_agent_revision_request,
  type AgentAssistantMessagePart,
  type AgentEntry,
  type AgentEntryStatus,
  type AgentMessageInput,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import { format_i18n_message } from "../../shared/i18n";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";
import type { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import { register_agent_model } from "./agent-model";
import {
  append_agent_session_seed,
  load_agent_session_seed,
  type AgentSessionSeed,
} from "./agent-session-seed";
import { create_agent_skill_tools } from "./agent-skill-tools";
import { AgentTaskProgress, create_agent_task_progress_tools } from "./agent-task-progress";
import { create_agent_web_tools, type AgentWebPort } from "./agent-web-tools";
import type { AgentWorkspacePort } from "./agent-workspace-service";
import { create_agent_workspace_tools } from "./agent-workspace-tools";
import {
  format_agent_skill_invocation,
  format_agent_skills_for_system_prompt,
  load_agent_skills,
  type AgentSkillDefinition,
} from "./agent-skills";
import { load_agent_system_prompt } from "./agent-system-prompt";
import { log_agent_tool_event, prepare_agent_tool } from "./agent-tool";

const AGENT_KEEP_RECENT_TOKENS = 32_000; // 产品固定保留的最近模型可见历史
const AGENT_STREAM_PUBLISH_INTERVAL_MS = 100; // assistant 完整公开条目最多 10Hz；工具与终态不等待
const AGENT_IMAGE_ONLY_TEXT = "(see attached image)"; // 避免供应商收到带图片的空文本块
const AGENT_IMAGE_MIME_TYPE = "image/webp";

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

/** 只展开公开能力的 marker；隐藏知识仍留在模型清单供自主读取。 */
function select_agent_skills(
  skills: readonly AgentSkillDefinition[],
  text: string,
): AgentSkillDefinition[] {
  const skill_by_marker = new Map(
    skills
      .filter((skill) => skill.visible)
      .map((skill) => [format_agent_skill_reference(skill.name), skill] as const),
  );
  const selected: AgentSkillDefinition[] = [];
  const selected_names = new Set<string>();
  for (const range of find_agent_reference_ranges(text, [...skill_by_marker.keys()])) {
    const skill = skill_by_marker.get(range.marker);
    if (skill !== undefined && !selected_names.has(skill.name)) {
      selected.push(skill);
      selected_names.add(skill.name);
    }
  }
  return selected;
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

/** 公开消息只保存当前可修改位置；完整模型历史仍由 SessionManager 单独拥有。 */
type AgentHistoryCheckpoint = {
  entry_id: string;
  leaf_id: string | null;
};

/** 修订角色显式决定是重新调用模型，还是直接写入人工 assistant。 */
type AgentRevision = {
  checkpoint: AgentHistoryCheckpoint;
  prefix: readonly AgentEntry[];
  message: AgentMessageInput;
  role: "user" | "assistant";
};

/** 新输入与隐藏续跑共用模型执行主链，但只有前者创建公开 user 轮次。 */
type AgentModelRequest =
  | { kind: "prompt"; text: string; images: readonly string[] }
  | { kind: "continue" };

type AgentAssistantStreamDelta = Extract<
  AssistantMessageEvent,
  { type: "text_delta" | "thinking_delta" }
>;

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
  runtimeGate: RuntimeOperationGate;
  web: AgentWebPort | undefined;
  workspace?: AgentWorkspacePort;
  logManager: Pick<LogManager, "append" | "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

type LoadedAgentResources = Readonly<{
  /** 保留未拼接 skill catalog 的原文，reset 时可重建能力清单而不累积旧投影。 */
  baseSystemPrompt: string;
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
  private readonly runtime_gate: RuntimeOperationGate; // task / Agent 互斥与 Agent 写工具授权来源
  private readonly web: AgentWebPort | undefined; // 缺失即不向模型注册 GUI 专属联网能力
  private readonly workspace: AgentWorkspacePort | undefined; // 缺失即不注册 Electron 专属磁盘工作区
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly task_progress = new AgentTaskProgress(); // 对话级队列；只有未完成标签进入公开会话投影
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型历史只存活于当前工程会话世代
  private session_reset: Promise<void> | null = null; // 清理完成前禁止新消息跨会话进入
  private operation_acceptance: Promise<AgentSessionSnapshot> | null = null; // 串行覆盖建会话、换模与尾部恢复
  private runtime_settlement: Promise<void> | null = null; // SDK idle 未覆盖 preflight，统一纳入关闭屏障
  private runtime_lease: RuntimeLease | null = null; // 从消息受理覆盖到 SDK 最终 settle
  private runtime_generation = 0; // stop/reset/dispose 统一令迟到异步阶段失效
  private state: AgentSessionState = "idle"; // 只表达当前回合是否运行，结果归各条目
  private entries: AgentEntry[] = []; // 本次 reset 以来唯一的公开时间线事实
  private context_tokens: number | null = null; // 压缩终态优先采用 SDK 新历史估算，避免复用旧 usage
  private assistant_stream: AgentAssistantStream | null = null; // 当前生成消息的窄字符串增量
  private assistant_stream_publish_timer: ReturnType<typeof setTimeout> | null = null;
  private latest_round_checkpoint: AgentHistoryCheckpoint | null = null; // 最新 user 轮次写入前的位置
  private latest_output_checkpoint: AgentHistoryCheckpoint | null = null; // 最新轮次最终可见 assistant 写入前的位置
  private pending_assistant_checkpoint: { leaf_id: string | null } | null = null; // message_start 到首个可见 part 的暂存位置
  private resources: LoadedAgentResources | null = null; // 基础资源与当前会话 catalog 的唯一原子快照
  private disposed = false;

  /** 会话订阅返回 reset Promise，保证工程生命周期等待旧 Agent 完整退出。 */
  public constructor(options: AgentServiceOptions) {
    this.paths = options.paths;
    this.settings = options.settings;
    this.user_agent = options.userAgent;
    this.session_state = options.sessionState;
    this.runtime_gate = options.runtimeGate;
    this.web = options.web;
    this.workspace = options.workspace;
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.unsubscribe_project_session = this.session_state.subscribe_change((change) =>
      this.reset_session("project", change.loaded ? change.projectPath : null),
    );
  }

  /** 返回仅含不可变投影的公开快照；UI 排序不改写模型侧持有的原始 skill 顺序。 */
  public get_snapshot(): AgentSessionSnapshot {
    return {
      state: this.state,
      entries: structuredClone(this.entries),
      skills: (this.resources?.skills ?? [])
        .filter(({ visible }) => visible)
        .sort((left, right) => {
          // 未配置 order 的能力排在显式顺序之后；同类项依赖稳定排序保留加载顺序。
          if (left.order === undefined) return right.order === undefined ? 0 : 1;
          if (right.order === undefined) return -1;
          return left.order - right.order;
        })
        .map(({ name, displayDescriptions }) => ({
          name,
          displayDescriptions: { ...displayDescriptions },
        })),
      taskProgress: this.task_progress.read_pending_labels(),
      contextTokens: this.context_tokens,
    };
  }

  /** 启动期原子加载必需的基础 Prompt、会话种子和初始 skill catalog。 */
  public async load_resources(): Promise<void> {
    await this.workspace?.initialize();
    const base_system_prompt = load_agent_system_prompt(this.paths);
    const session_seed = load_agent_session_seed(this.paths);
    const skills = await load_agent_skills(this.paths, this.log_manager);
    const skills_prompt = format_agent_skills_for_system_prompt(skills);
    this.resources = {
      baseSystemPrompt: base_system_prompt,
      systemPrompt:
        skills_prompt === "" ? base_system_prompt : `${base_system_prompt}\n\n${skills_prompt}`,
      sessionSeed: session_seed,
      skills,
    };
  }

  /** 同步校验消息，以单一 Promise 串行完成建会话或刷新模型请求快照。 */
  public async send_message(request: JsonRecord): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const resources = this.require_resources();
    this.session_state.require_loaded_project_path();
    const message = normalize_agent_message_input(request);
    if (message === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "empty_agent_message" },
      });
    }
    if (this.find_latest_compaction_entry()?.status === "error") {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_resume_required" },
      });
    }
    const selected_skills = select_agent_skills(resources.skills, message.text);
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(
      this.accept_message(resources, message, selected_skills, runtime_lease),
    );
  }

  /** 最新轮次输入与最终输出可独立修订；原输入修订为自身即表示重试。 */
  public async revise_latest_round(request: JsonRecord): Promise<AgentSessionSnapshot> {
    this.assert_revision_available();
    const revision = normalize_agent_revision_request(request);
    if (revision === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_revision_unavailable" },
      });
    }
    const user_index = this.entries.findLastIndex((entry) => entry.kind === "user_message");
    const user = this.entries[user_index];
    const round_checkpoint = this.latest_round_checkpoint;
    if (
      user?.kind === "user_message" &&
      revision.entryId === user.id &&
      round_checkpoint?.entry_id === user.id &&
      user.status !== "running"
    ) {
      return await this.begin_revision({
        checkpoint: round_checkpoint,
        prefix: this.entries.slice(0, user_index),
        message: revision.message,
        role: "user",
      });
    }

    const output_index = this.entries.findLastIndex(
      (entry, index) => index > user_index && entry.kind === "assistant_message",
    );
    const output = this.entries[output_index];
    const output_checkpoint = this.latest_output_checkpoint;
    if (
      output?.kind === "assistant_message" &&
      revision.entryId === output.id &&
      output_checkpoint?.entry_id === output.id &&
      output.status !== "running" &&
      revision.message.text !== "" &&
      revision.message.images.length === 0
    ) {
      return await this.begin_revision({
        checkpoint: output_checkpoint,
        prefix: this.entries.slice(0, output_index),
        message: revision.message,
        role: "assistant",
      });
    }

    throw new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: { reason: "agent_revision_unavailable" },
    });
  }

  /** 恢复唯一未解决的尾部失败；必要时先恢复压缩，再隐藏续跑原公开轮次。 */
  public async resume(): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle") {
      throw new AppErrors.AppError("runtime.busy");
    }
    this.session_state.require_loaded_project_path();
    const runtime = this.runtime;
    const latest_compaction = this.find_latest_compaction_entry();
    const failed_compaction = latest_compaction?.status === "error" ? latest_compaction : undefined;
    const resume_failed_round =
      this.entries.findLast((entry) => entry.kind === "user_message")?.status === "error";
    if (runtime === null || (failed_compaction === undefined && !resume_failed_round)) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_resume_unavailable" },
      });
    }
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(
      this.accept_resume(runtime, failed_compaction, resume_failed_round, runtime_lease),
    );
  }

  /** 清空当前对话，并在消息受理与旧运行时完全退出后返回最终空快照。 */
  public async reset(): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    const existing_lease = this.runtime_lease;
    const reset_lease = existing_lease ?? this.runtime_gate.begin_runtime("agent");
    if (existing_lease === null) this.runtime_lease = reset_lease;
    try {
      await this.reset_session("workspace");
      return this.get_snapshot();
    } finally {
      if (existing_lease === null) this.finish_runtime(reset_lease);
    }
  }

  /** 立即封口公开轮次并保留历史；压缩与 workspace_apply 不接受中途停止。 */
  public stop(): AgentSessionSnapshot {
    this.assert_not_disposed();
    if (
      this.find_open_compaction_entry() !== undefined ||
      this.find_open_workspace_apply_entry() !== undefined ||
      this.runtime?.session.isCompacting === true
    ) {
      throw new AppErrors.AppError("runtime.busy");
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
    this.task_progress.reset();
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
    await this.workspace?.reset_project(null);
  }

  /** 在当前运行世代内准备唯一候选运行时。 */
  private async accept_message(
    resources: LoadedAgentResources,
    message: AgentMessageInput,
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
          throw new AppErrors.AppError("request.validation_failed", {
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

      const prompt = this.start_round(runtime, generation, message, selected_skills, runtime_lease);
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

  /** 重试与修改共享同一受理边界，目标检查通过后才取得运行 lease。 */
  private async begin_revision(revision: AgentRevision): Promise<AgentSessionSnapshot> {
    const resources = this.require_resources();
    this.session_state.require_loaded_project_path();
    const runtime = this.runtime;
    if (runtime === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_revision_runtime_missing" },
      });
    }
    const selected_skills =
      revision.role === "assistant"
        ? []
        : select_agent_skills(resources.skills, revision.message.text);
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(
      this.accept_revision(runtime, revision, selected_skills, runtime_lease),
    );
  }

  /** 模型预检成功后才裁剪；提交段只改内存历史并立即建立唯一替代版本。 */
  private async accept_revision(
    runtime: AgentRuntime,
    revision: AgentRevision,
    selected_skills: AgentSkillDefinition[],
    runtime_lease: RuntimeLease,
  ): Promise<AgentSessionSnapshot> {
    let prompt_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (this.disposed || generation !== this.runtime_generation || this.runtime !== runtime) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_revision_invalidated" },
        });
      }

      this.replace_active_history(runtime, revision.checkpoint.leaf_id);
      this.pending_assistant_checkpoint = null;
      if (revision.role === "assistant") {
        this.replace_with_assistant(runtime, revision.prefix, revision.message.text);
        return this.get_snapshot();
      }

      const prompt = this.start_round(
        runtime,
        generation,
        revision.message,
        selected_skills,
        runtime_lease,
        revision.prefix,
      );
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

  /** SessionManager 在内存模式下用根到 leaf 的单一路径替换整棵旧树。 */
  private replace_active_history(runtime: AgentRuntime, leaf_id: string | null): void {
    if (leaf_id === null) runtime.session.sessionManager.newSession();
    else runtime.session.sessionManager.createBranchedSession(leaf_id);
    runtime.session.agent.state.messages =
      runtime.session.sessionManager.buildSessionContext().messages;
    this.context_tokens = estimateContextTokens(runtime.session.messages).tokens;
  }

  /** 人工修改的 assistant 是零 usage 的正常历史消息，不触发供应商请求。 */
  private replace_with_assistant(
    runtime: AgentRuntime,
    prefix: readonly AgentEntry[],
    text: string,
  ): void {
    const model = runtime.session.model;
    if (model === undefined) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_revision_model_missing" },
      });
    }
    const created_at = Date.now();
    const checkpoint_leaf = runtime.session.sessionManager.getLeafId();
    runtime.session.sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: created_at,
    });
    runtime.session.agent.state.messages =
      runtime.session.sessionManager.buildSessionContext().messages;
    const entry: AgentEntry = {
      kind: "assistant_message",
      id: uuidv7(),
      parts: [{ kind: "text", text }],
      status: "success",
      createdAt: created_at,
    };
    this.entries = [...structuredClone(prefix), entry];
    this.latest_output_checkpoint = { entry_id: entry.id, leaf_id: checkpoint_leaf };
    this.context_tokens = estimateContextTokens(runtime.session.messages).tokens;
    this.state = "idle";
    this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
  }

  /** 恢复受理只更新模型并启动唯一尾部恢复，不在 renderer 建立补偿命令。 */
  private async accept_resume(
    runtime: AgentRuntime,
    failed_entry: Extract<AgentEntry, { kind: "context_compaction" }> | undefined,
    resume_failed_round: boolean,
    runtime_lease: RuntimeLease,
  ): Promise<AgentSessionSnapshot> {
    let resume_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (this.disposed || generation !== this.runtime_generation || this.runtime !== runtime) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_resume_invalidated" },
        });
      }
      if (failed_entry !== undefined) {
        this.upsert_entry({ ...failed_entry, status: "running" });
        this.set_state("running");
      }
      const resume = this.run_resume(
        runtime,
        generation,
        failed_entry !== undefined,
        resume_failed_round,
        runtime_lease,
      );
      this.runtime_settlement = resume;
      resume_started = true;
      const clear_resume = () => {
        if (this.runtime_settlement === resume) this.runtime_settlement = null;
      };
      void resume.then(clear_resume, clear_resume);
      return this.get_snapshot();
    } finally {
      if (!resume_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 新轮次记录模型写入前的唯一切点；替代操作通过 snapshot_seed 原子换掉旧尾部。 */
  private start_round(
    runtime: AgentRuntime,
    generation: number,
    message: AgentMessageInput,
    selected_skills: AgentSkillDefinition[],
    runtime_lease: RuntimeLease,
    replacement_prefix?: readonly AgentEntry[],
  ): Promise<void> {
    const entry: AgentEntry = {
      kind: "user_message",
      id: uuidv7(),
      text: message.text,
      images: message.images,
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
    };
    const checkpoint = {
      entry_id: entry.id,
      leaf_id: runtime.session.sessionManager.getLeafId(),
    };
    this.latest_round_checkpoint = checkpoint;
    this.latest_output_checkpoint = null;
    this.pending_assistant_checkpoint = null;
    if (replacement_prefix === undefined) {
      this.upsert_entry(entry);
      this.set_state("running");
    } else {
      this.entries = [...structuredClone(replacement_prefix), entry];
      this.state = "running";
      this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
    }
    return this.run_round(runtime, generation, runtime_lease, {
      kind: "prompt",
      text: build_agent_prompt(message.text, selected_skills),
      images: message.images,
    });
  }

  /** 恢复原 user 轮次并以隐藏消息继续，保留失败前的公开条目与模型历史。 */
  private resume_round(
    runtime: AgentRuntime,
    generation: number,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    const user = this.entries.findLast((entry) => entry.kind === "user_message");
    if (user?.kind !== "user_message" || user.status !== "error") {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_failed_round_missing" },
      });
    }
    this.pending_assistant_checkpoint = null;
    this.upsert_entry({ ...user, status: "running", endedAt: null });
    this.set_state("running");
    return this.run_round(runtime, generation, runtime_lease, { kind: "continue" });
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
        ...create_agent_task_progress_tools(this.task_progress),
        ...(this.workspace === undefined ? [] : create_agent_workspace_tools(this.workspace)),
        ...create_agent_skill_tools(resources.skills, this.paths, this.log_manager),
        ...(this.web === undefined ? [] : create_agent_web_tools(this.web)),
      ].map((tool) => prepare_agent_tool(tool, this.log_manager)),
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
  private async run_round(
    runtime: AgentRuntime,
    generation: number,
    runtime_lease: RuntimeLease,
    request: AgentModelRequest,
  ): Promise<void> {
    let outcome: Extract<AgentEntryStatus, "success" | "error"> = "success";
    try {
      runtime.checkpoint_requested = false;
      let previous_compaction_id = this.find_latest_compaction_entry()?.id;
      if (request.kind === "continue") await this.send_continue(runtime);
      else {
        await runtime.session.prompt(request.text, {
          expandPromptTemplates: false,
          images: request.images.map<ImageContent>((data) => ({
            type: "image",
            data,
            mimeType: AGENT_IMAGE_MIME_TYPE,
          })),
          // SDK 在异步 preflight 完成前仍处于 idle；失效后必须在真正启动模型前截断。
          preflightResult: (accepted) => {
            if (accepted && !this.prompt_is_current(runtime, generation)) {
              throw new AppErrors.AppError("runtime.cancelled", {
                diagnostic_context: {
                  resource: "agent_prompt",
                  reason: "agent_message_invalidated",
                },
              });
            }
          },
        });
      }
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
        await this.send_continue(runtime);
      }
      if (this.prompt_is_current(runtime, generation)) {
        const final_assistant = runtime.session.messages.findLast(
          (message): message is AssistantMessage => message.role === "assistant",
        );
        if (final_assistant?.stopReason === "error") {
          outcome = "error";
          this.log_request_failure(
            new Error(final_assistant.errorMessage ?? "Agent model turn failed."),
          );
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

  /** 恢复按需先修复压缩，再在同一公开 user 轮次隐藏续跑。 */
  private async run_resume(
    runtime: AgentRuntime,
    generation: number,
    restore_compaction: boolean,
    resume_failed_round: boolean,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    let round_started = false;
    try {
      if (restore_compaction) await runtime.session.compact();
      if (resume_failed_round && this.runtime_is_current(runtime, generation)) {
        const prompt = this.resume_round(runtime, generation, runtime_lease);
        round_started = true;
        await prompt;
      }
    } catch {
      // 模型与压缩事件已经发布权威失败条目和诊断，命令 Promise 不建立第二套错误通道。
    } finally {
      if (!round_started) {
        if (this.runtime_is_current(runtime, generation)) this.set_state("idle");
        this.finish_runtime(runtime_lease);
      }
    }
  }

  /** 将 SDK 事件收窄为按真实顺序追加的公开时间线；中间失败不冒充最终失败。 */
  private handle_agent_event(event: PiAgentSessionEvent): void {
    if (event.type === "compaction_start") {
      const compaction = this.find_latest_compaction_entry();
      if (compaction?.status === "running") return;
      this.upsert_entry(
        compaction?.status === "error"
          ? { ...compaction, status: "running" }
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
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.pending_assistant_checkpoint = {
        leaf_id: this.runtime?.session.sessionManager.getLeafId() ?? null,
      };
      return;
    }
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
        this.pending_assistant_checkpoint = null;
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
        throw new AppErrors.AppError("runtime.internal_invariant", {
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
      // 工具成功终帧表示原子状态已提交；失败时保留旧投影。
      if (!event.isError && running_entry.toolName === "task_progress") {
        this.publish_event({
          type: "task_progress",
          taskProgress: this.task_progress.read_pending_labels(),
        });
      }
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
      const entry: AgentEntry = {
        kind: "assistant_message",
        id: uuidv7(),
        parts,
        status,
        createdAt: created_at,
      };
      this.upsert_entry(entry);
      const checkpoint = this.pending_assistant_checkpoint;
      if (checkpoint !== null) {
        this.latest_output_checkpoint = {
          entry_id: entry.id,
          leaf_id: checkpoint.leaf_id,
        };
      }
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

  /** 未解决压缩跨自动重试与手动恢复保持单一条目身份。 */
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

  /** apply 从开始校验到 SDK 接收终帧都不可停止，避免提交事实被迟到取消覆盖。 */
  private find_open_workspace_apply_entry(): AgentEntry | undefined {
    return this.entries.find(
      (entry) =>
        entry.kind === "tool_call" &&
        entry.toolName === "workspace_apply" &&
        entry.status === "running",
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

  /** 立即隔离公开会话；工程切换还把新工程路径交给 sources 生命周期。 */
  private reset_session(
    scope: "workspace" | "project",
    project_path: string | null = null,
  ): Promise<void> {
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
    this.latest_round_checkpoint = null;
    this.latest_output_checkpoint = null;
    this.pending_assistant_checkpoint = null;
    this.task_progress.reset();
    const reset = Promise.all([
      acceptance?.catch(() => undefined),
      settlement?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
      this.reload_session_skills(),
    ])
      .then(async () => {
        if (scope === "project") {
          await this.workspace?.reset_project(project_path);
        } else {
          await this.workspace?.reset_workspace();
        }
        if (!this.disposed) {
          this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
        }
      })
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

  /** 所有异步受理共享同一关闭屏障，命令类型不再各自复制清理时序。 */
  private async track_operation_acceptance(
    acceptance: Promise<AgentSessionSnapshot>,
  ): Promise<AgentSessionSnapshot> {
    this.operation_acceptance = acceptance;
    try {
      return await acceptance;
    } finally {
      if (this.operation_acceptance === acceptance) this.operation_acceptance = null;
    }
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
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_resources_not_loaded" },
      });
    }
    return this.resources;
  }

  /** 新产品会话重新冻结 catalog；System Prompt、mention 与 marker 始终共享同一快照。 */
  private async reload_session_skills(): Promise<void> {
    if (this.resources === null) return;
    const skills = await load_agent_skills(this.paths, this.log_manager);
    const skills_prompt = format_agent_skills_for_system_prompt(skills);
    this.resources = {
      ...this.resources,
      systemPrompt:
        skills_prompt === ""
          ? this.resources.baseSystemPrompt
          : `${this.resources.baseSystemPrompt}\n\n${skills_prompt}`,
      skills,
    };
  }

  /** 所有自动与手动恢复共用同一种隐藏模型消息，不制造公开 user 轮次。 */
  private async send_continue(runtime: AgentRuntime): Promise<void> {
    await runtime.session.sendCustomMessage(
      {
        customType: "linguagacha_continue",
        content: [{ type: "text", text: this.read_continue_text() }],
        display: false,
      },
      { triggerTurn: true },
    );
  }

  /** 隐藏续跑消息在操作发起时读取当前 UI 语言。 */
  private read_continue_text(): string {
    const setting = this.settings.read_setting();
    return format_i18n_message(
      resolve_app_locale(setting["app_language"]),
      "agent_runtime.message.continue",
    );
  }

  /** dispose 后的命令必须失败，避免重新创建已脱离订阅的运行时。 */
  private assert_not_disposed(): void {
    if (this.disposed) throw new AppErrors.AppError("runtime.disposed");
  }

  /** 消息改写只允许发生在稳定空闲态，且不能绕过失败压缩恢复。 */
  private assert_revision_available(): void {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle") {
      throw new AppErrors.AppError("runtime.busy");
    }
    if (this.find_latest_compaction_entry()?.status === "error") {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_resume_required" },
      });
    }
  }
}

/** skill 指令块按 marker 首次出现顺序置前，原始用户正文始终随后进入历史。 */
function build_agent_prompt(text: string, skills: readonly AgentSkillDefinition[]): string {
  const user_text = text === "" ? AGENT_IMAGE_ONLY_TEXT : text;
  if (skills.length === 0) return user_text;
  const blocks = skills.map((skill) => format_agent_skill_invocation(skill));
  blocks.push(user_text);
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
