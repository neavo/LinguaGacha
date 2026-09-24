import type { AgentSkillsService } from "./agent-skills-service";
import type { AgentFilesResponse } from "../../shared/agent-reference";
import type { AgentImageService } from "./agent-image-service";
import type { AgentFileAttachment } from "../../shared/agent";
import { prepare_agent_message, type PreparedAgentMessage } from "./agent-message-input";
import { BatchTranslationCompletionError } from "../batch-translation/batch-translation-runtime";
import { resolve_agent_batch_translation_model } from "../model/model-config-resolver";
import type { BatchTranslationResult } from "../../domain/batch-translation";
import type { Model } from "../../domain/model";
import { create_agent_batch_item_translation_tool } from "./model-tools/batch-translation";
import {
  InMemoryCredentialStore,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
  type TextContent,
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
import { is_json_record, type JsonRecord } from "../../domain/json";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  AGENT_SESSION_EVENT_TOPIC,
  normalize_agent_assistant_message_parts,
  normalize_agent_message_input,
  normalize_agent_revision_request,
  type AgentAssistantMessageParts,
  type AgentApprovalMode,
  type AgentWorkspaceLinkResult,
  type AgentCommandAck,
  type AgentContextSnapshot,
  type AgentTokenSpeedSnapshot,
  type AgentUsageSnapshot,
  type AgentEntry,
  type AgentEntryStatus,
  type AgentMessageInput,
  type AgentSessionEvent,
  type AgentSessionEventPayload,
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
import { AgentDecisionCoordinator } from "./agent-decision";
import { register_agent_model } from "./agent-model";
import type { PiModelCatalogReader } from "../llm/pi-model-catalog";
import {
  append_agent_session_seed,
  load_agent_session_seed,
  type AgentSessionSeed,
} from "./agent-session-seed";
import { create_agent_skill_tools } from "./model-tools/skill";
import { create_agent_question_tools } from "./model-tools/question";
import { AgentInputQueue } from "./agent-input-queue";
import { create_agent_web_search_tool, type AgentWebSearchPort } from "./model-tools/web-search";
import type { AgentWorkspacePort } from "./workspace/service";
import {
  create_agent_workspace_tools,
  type AgentTodoPort,
  type AgentWorkspaceApprovalPort,
} from "./model-tools/workspace";
import { format_agent_skills_for_system_prompt } from "./agent-skills";
import {
  insert_agent_personality,
  load_agent_personality,
  load_agent_system_prompt,
} from "./agent-system-prompt";
import { AgentToolError, prepare_agent_tool } from "./model-tools/definition";

import { AgentTokenSpeed } from "./agent-token-speed";
import { AgentSessionLog } from "./agent-log";
import { project_assistant_message_parts } from "./agent-message";
import { AGENT_KEEP_RECENT_TOKENS, read_agent_session_context } from "./agent-session-context";

const AGENT_TOKEN_SPEED_PUBLISH_INTERVAL_MS = 250; // 数值最多 4Hz，采样仍消费每个增量
const AGENT_STREAM_PUBLISH_INTERVAL_MS = 100; // assistant 完整公开条目最多 10Hz；工具与终态不等待
/** 产品会话使用固定压缩预算，不读取 coding-agent 用户设置。 */
function build_agent_session_settings() {
  return {
    images: { autoResize: false }, // 所有产品图片已由唯一后端入口处理，SDK 直接消费固定字节。
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

type AgentRuntime = {
  readonly session_id: string; // 冻结初始 UUID，修订重建 SDK 历史和压缩均沿用产品对话身份
  log: AgentSessionLog; // 跟随 SDK 生命周期，独立于公开时间线的提前封口
  session: AgentSession;
  model_config: Model; // 随 SDK 成功换模同步的应用配置；批量翻译跟随时以此作为继承来源
  unsubscribe: () => void;
  steer_ready: boolean; // Pi 已进入 agent loop 且当前不在压缩阶段
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
  | { kind: "prompt" | "queued"; text: string; images: ImageContent[] }
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
  skills: Pick<AgentSkillsService, "get_current" | "subscribe" | "refresh">;
  catalog: PiModelCatalogReader;
  batchTranslation: Pick<
    import("../batch-translation/batch-translation-service").BatchTranslationService,
    "run_under_agent"
  >;
  paths: AgentServicePaths;
  settings: Pick<AppSettingService, "read_setting">;
  userAgent: string;
  sessionState: ProjectSessionState;
  runtimeGate: RuntimeOperationGate;
  webSearch: AgentWebSearchPort | undefined;
  workspace: AgentWorkspacePort;
  images: Pick<AgentImageService, "prepare" | "clear">;
  logManager: Pick<LogManager, "append" | "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

type AgentIncrementalEvent = Exclude<AgentSessionEventPayload, { type: "snapshot_seed" }>;

/** 启动时加载的基础提示词和会话种子。 */
type LoadedAgentResources = Readonly<{
  baseSystemPrompt: string;
  defaultPersonality: string;
  sessionSeed: AgentSessionSeed;
}>;

/**
 * 单个后端 Agent 产品会话的状态拥有者；通用模型生命周期交给 AgentSession。
 */
export class AgentService {
  private readonly catalog: PiModelCatalogReader; // 每轮准备时读取组合根持有的当前目录。
  private readonly token_speed = new AgentTokenSpeed(); // 失败继续复用回合累计统计。
  private token_speed_updated_at: number | null = null; // 计数和发布共用节流时间。
  private token_speed_snapshot: AgentTokenSpeedSnapshot = null; // 等待期间保留最近展示值。
  private session_id = uuidv7(); // 对话重置时换代，前端据此清理草稿文件引用
  private readonly batch_translation: AgentServiceOptions["batchTranslation"];
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly skills: AgentServiceOptions["skills"]; // 菜单、模型目录与读取工具共用的当前技能入口。
  private readonly unsubscribe_skills: () => void; // 关闭时解除订阅，停止接收集合变更。
  private readonly user_agent: string;
  private readonly session_state: ProjectSessionState;
  private readonly runtime_gate: RuntimeOperationGate; // task / Agent 互斥与 Agent 写工具授权来源
  private readonly web_search: AgentWebSearchPort | undefined; // 缺失即不向模型注册 GUI 专属搜索能力
  private readonly workspace: AgentWorkspacePort; // Agent 恒定工作面；初始化失败直接阻止会话启动
  private readonly images: AgentServiceOptions["images"];
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private todos: string[] = []; // 对话级有序待办；Node 脚本成功后才原子替换
  private readonly input_queue = new AgentInputQueue(); // 当前产品会话的待发送输入；不写入 Pi follow-up
  private readonly decisions: AgentDecisionCoordinator; // 当前回合唯一用户决策及其取消生命周期
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型历史只存活于当前工程会话世代
  private session_reset: Promise<void> | null = null; // 清理完成前禁止新消息跨会话进入
  private operation_acceptance: Promise<AgentCommandAck> | null = null; // 串行覆盖建会话、换模与异步操作启动
  private runtime_settlement: Promise<void> | null = null; // 后台模型与压缩操作统一纳入关闭屏障
  private runtime_lease: RuntimeLease | null = null; // 从消息受理覆盖到 SDK 最终 settle
  private translation_paused_result: BatchTranslationResult | null = null; // 用户停止后在当前 round 内暂停翻译能力
  private runtime_generation = 0; // stop/reset/dispose 统一令迟到异步阶段失效
  private state: AgentSessionState = "idle"; // 只表达当前回合是否运行，结果归各条目
  private approval_mode_revision = 0; // 显式设置优先于较早批次提交后的自动模式回写
  private approval_mode: AgentApprovalMode = "manual"; // 当前任务的工程写入审批策略
  private entries: AgentEntry[] = []; // 本次 reset 以来唯一的公开时间线事实
  private context: AgentContextSnapshot = { tokens: null, compactable: false, limits: null }; // 模型历史估算与手动压缩能力的同源快照
  private removed_usage: AgentUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; // 历史修订移出 SDK 会话的已发生用量
  private usage: AgentUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; // 最近发布的完整用量，供快照读取与事件去重
  private assistant_stream: AgentAssistantStream | null = null; // 当前生成消息的窄字符串增量
  private assistant_stream_publish_timer: ReturnType<typeof setTimeout> | null = null; // 固定窗口唯一发布计时器
  private latest_round_checkpoint: AgentHistoryCheckpoint | null = null; // 最新 user 轮次写入前的位置
  private latest_output_checkpoint: AgentHistoryCheckpoint | null = null; // 最新轮次最终可见 assistant 写入前的位置
  private pending_assistant_checkpoint: { leaf_id: string | null } | null = null; // message_start 到首个可见 part 的暂存位置
  private resources: LoadedAgentResources | null = null; // 启动期基础提示词和会话种子。
  private revision = 0; // 当前产品会话公开事件的全局单调序号；reset 与工程切换均不回退
  private disposed = false; // 关闭后永久拒绝命令和事件发布

  /** 会话订阅返回 reset Promise，保证工程生命周期等待旧 Agent 完整退出。 */
  public constructor(options: AgentServiceOptions) {
    this.catalog = options.catalog;
    this.batch_translation = options.batchTranslation;
    this.paths = options.paths;
    this.settings = options.settings;
    this.skills = options.skills;
    this.unsubscribe_skills = this.skills.subscribe(() => {
      if (!this.disposed && this.resources !== null && this.session_reset === null) {
        this.publish_event({ type: "skills_changed", skills: this.get_skill_snapshot() });
      }
    });
    this.user_agent = options.userAgent;
    this.session_state = options.sessionState;
    this.runtime_gate = options.runtimeGate;
    this.web_search = options.webSearch;
    this.workspace = options.workspace;
    this.images = options.images;
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.decisions = new AgentDecisionCoordinator(() => {
      if (this.disposed) return;
      this.publish_event({
        type: "pending_decision",
        pendingDecision: this.decisions.read_pending(),
      });
      this.publish_input_queue();
    });
    this.unsubscribe_project_session = this.session_state.subscribe_change((change) =>
      this.reset_session("project", change.loaded ? change.projectPath : null),
    );
  }

  /** 会话清理期间拒绝激活工作区链接。 */
  public async activate_workspace_path(request: JsonRecord): Promise<AgentWorkspaceLinkResult> {
    this.assert_not_disposed();
    if (this.session_reset !== null) throw new AppErrors.AppError("runtime.busy");
    return this.workspace.activate_path(is_json_record(request) ? request["path"] : undefined);
  }

  /** 上传不占用模型或脚本互斥，文件身份仍属于当前工程会话。 */
  public async upload_file(
    name: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<AgentFileAttachment> {
    this.assert_not_disposed();
    if (this.session_reset !== null) throw new AppErrors.AppError("runtime.busy");
    this.session_state.require_loaded_project_path();
    return this.workspace.uploads.upload(name, body, signal);
  }

  /** Gateway 关闭前取消请求体读取，让在途上传及时退出。 */
  public cancel_uploads(): void {
    this.workspace.uploads.cancel();
  }

  /** 文件下载遵守会话关闭屏障，存储层拥有定位与流的创建。 */
  public read_upload(id: string): ReturnType<AgentWorkspacePort["uploads"]["open"]> {
    this.assert_not_disposed();
    if (this.session_reset !== null) throw new AppErrors.AppError("runtime.busy");
    return this.workspace.uploads.open(id);
  }

  /** 请求附件只提交身份，完整元数据取自当前上传记录。 */
  private readonly resolve_file = (id: string): AgentFileAttachment =>
    this.workspace.uploads.get(id);

  /** 附件转换是异步边界，所有调用者在提交消息前统一复核运行世代。 */
  private async prepare_message(message: AgentMessageInput): Promise<PreparedAgentMessage> {
    const generation = this.runtime_generation;
    const prepared = await prepare_agent_message(message, this.workspace.uploads, this.images);
    this.assert_not_disposed();
    if (generation !== this.runtime_generation) throw new AppErrors.AppError("runtime.cancelled");
    return prepared;
  }

  /** 菜单读取当前会话可用的轻量文件事实。 */
  public list_files(): AgentFilesResponse {
    this.assert_not_disposed();
    if (this.session_reset !== null) throw new AppErrors.AppError("runtime.busy");
    return { sessionId: this.session_id, files: this.workspace.list_files() };
  }

  /** 完整快照和技能事件共用公开投影，隐藏技能仍可供模型读取。 */
  private get_skill_snapshot(): AgentSessionSnapshot["skills"] {
    return this.skills
      .get_current()
      .filter(({ visible }) => visible)
      .map(({ name, displayDescriptions }) => ({
        name,
        displayDescriptions: { ...displayDescriptions },
      }));
  }

  /** 返回独立的公开快照，技能沿用当前集合顺序。 */
  public get_snapshot(): AgentSessionSnapshot {
    return {
      sessionId: this.session_id,
      revision: this.revision,
      state: this.state,
      approvalMode: this.approval_mode,
      pendingDecision: this.decisions.read_pending(),
      entries: structuredClone(this.entries),
      skills: this.get_skill_snapshot(),
      inputQueue: this.input_queue.read_snapshot(this.can_send_queued_now()),
      todos: [...this.todos],
      context: structuredClone(this.context),
      usage: { ...this.usage },
      tokenSpeed: structuredClone(this.token_speed_snapshot),
    };
  }

  /** 更新当前 Agent 任务的写入请求审批模式；reset、工程切换和应用重启都会回到手动。 */
  public set_approval_mode(request: JsonRecord): AgentCommandAck {
    this.assert_not_disposed();
    if (this.session_reset !== null) throw new AppErrors.AppError("runtime.busy");
    const approval_mode = read_agent_approval_mode(request);
    this.approval_mode_revision += 1;
    if (this.approval_mode !== approval_mode) {
      this.approval_mode = approval_mode;
      this.publish_event({ type: "approval_mode", approvalMode: approval_mode });
    }
    return this.get_acknowledgement();
  }

  /** 普通问题的决定只恢复 ask_user，不建立公开 user 消息。 */
  public resolve_question(request: JsonRecord): AgentCommandAck {
    this.assert_not_disposed();
    this.decisions.resolve_question(request);
    return this.get_acknowledgement();
  }

  /** 写入授权只恢复当前 workspace_apply，不接受普通问题答案。 */
  public resolve_write_approval(request: JsonRecord): AgentCommandAck {
    this.assert_not_disposed();
    this.decisions.resolve_write_approval(request);
    return this.get_acknowledgement();
  }

  /** 启动期加载必需基础资源，并通过技能服务准备空白对话的候选。 */
  public async load_resources(): Promise<void> {
    await this.workspace.initialize();
    const base_system_prompt = load_agent_system_prompt(this.paths);
    const default_personality = load_agent_personality(this.paths);
    const session_seed = load_agent_session_seed(this.paths);
    await this.skills.refresh();
    this.resources = {
      baseSystemPrompt: base_system_prompt,
      defaultPersonality: default_personality,
      sessionSeed: session_seed,
    };
  }

  /** 同步校验消息，以单一 Promise 串行完成建会话或刷新模型请求快照。 */
  public async send_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.AppError("runtime.busy");
    }
    if (this.decisions.has_pending) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const message = normalize_agent_message_input(request, this.resolve_file);
    if (message === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "empty_agent_message" },
      });
    }
    if (this.session_reset !== null || this.decisions.has_pending)
      throw new AppErrors.AppError("runtime.busy");
    this.session_state.require_loaded_project_path();
    if (this.state === "running") {
      this.input_queue.enqueue(message);
      this.publish_input_queue();
      return this.get_acknowledgement();
    }
    if (this.input_queue.is_paused) {
      throw agent_queue_validation_error("agent_continue_required");
    }
    this.require_resources();
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(this.accept_round(message, runtime_lease));
  }

  /** 只允许修改仍在等待的队列项；发送中的内容已经交给 Pi，不能再改写。 */
  public async update_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_command_available();
    const { id, message } = read_queue_message_request(request, this.resolve_file);
    this.assert_queue_command_available();
    this.input_queue.update(id, message);
    this.publish_input_queue();
    return this.get_acknowledgement();
  }

  /** 删除等待项后由队列自行解除无项目标暂停态。 */
  public delete_queued_message(request: JsonRecord): AgentCommandAck {
    this.assert_queue_command_available();
    this.input_queue.delete(read_queue_id(request));
    this.publish_input_queue();
    return this.get_acknowledgement();
  }

  /** 重排请求必须完整列出当前队列身份，避免部分顺序覆盖并发变化。 */
  public reorder_queued_messages(request: JsonRecord): AgentCommandAck {
    this.assert_queue_command_available();
    const ids = request["ids"];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw agent_queue_validation_error("agent_input_queue_invalid_order");
    }
    this.input_queue.reorder(ids as string[]);
    this.publish_input_queue();
    return this.get_acknowledgement();
  }

  /** 运行中交给 Pi steer；空闲时将选中项作为新公开轮次启动，其他暂停项保持不动。 */
  public async send_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_command_available();
    this.session_state.require_loaded_project_path();
    const id = read_queue_id(request);
    if (this.state === "running") {
      const runtime = this.runtime;
      if (runtime === null || !runtime.steer_ready) throw new AppErrors.AppError("runtime.busy");
      const item = this.input_queue.begin_send(id);
      this.publish_input_queue();
      return this.track_operation_acceptance(this.accept_steer(runtime, item));
    }
    this.require_resources();
    const item = this.input_queue.read(id);
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(this.accept_round(item, runtime_lease, item.id));
  }

  /** steer 的准备占位与失败回滚属于同一个受理操作，轮次结束会等待它结算。 */
  private async accept_steer(
    runtime: AgentRuntime,
    item: AgentMessageInput,
  ): Promise<AgentCommandAck> {
    const generation = this.runtime_generation;
    try {
      const prepared = await this.prepare_message(item);
      if (this.runtime !== runtime || !runtime.steer_ready)
        throw new AppErrors.AppError("runtime.busy");
      await runtime.session.steer(prepared.text, prepared.images);
      return this.get_acknowledgement();
    } catch (error) {
      if (this.runtime_is_current(runtime, generation)) {
        this.input_queue.cancel_send();
        this.publish_input_queue();
      }
      throw error;
    }
  }

  /** 最新轮次输入与最终输出可独立修订；原输入修订为自身即表示重试。 */
  public async revise_latest_round(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_revision_available();
    const revision = normalize_agent_revision_request(request, this.resolve_file);
    if (revision === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_revision_unavailable" },
      });
    }
    this.assert_revision_available();
    const user_index = this.entries.findLastIndex(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
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
      revision.message.attachments.length === 0
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

  /** 唯一继续入口原子追加可选队尾消息，并恢复失败轮次或暂停队列。 */
  public async continue_session(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle") {
      throw new AppErrors.AppError("runtime.busy");
    }
    this.session_state.require_loaded_project_path();
    const message = read_agent_continue_message(request, this.resolve_file);
    if (this.session_reset !== null || this.state !== "idle")
      throw new AppErrors.AppError("runtime.busy");
    const runtime = this.runtime;
    const continue_failed_round =
      this.entries.findLast((entry) => entry.kind === "user_message" && entry.delivery === "round")
        ?.status === "error";
    const continue_failed = runtime !== null && continue_failed_round;
    if (!this.input_queue.has_items && !continue_failed) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_continue_unavailable" },
      });
    }
    if (message !== null && !this.input_queue.has_items) {
      throw agent_queue_validation_error("agent_continue_message_without_queue");
    }
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    let delegated = false;
    try {
      if (message !== null) this.input_queue.enqueue(message);
      if (this.input_queue.has_items) this.input_queue.resume();
      this.publish_input_queue();
      const acceptance =
        continue_failed && runtime !== null
          ? this.accept_continue(runtime, runtime_lease)
          : this.accept_next_queued_message(runtime_lease);
      delegated = true;
      return await this.track_operation_acceptance(acceptance);
    } catch (error) {
      this.input_queue.pause();
      this.publish_input_queue();
      if (!delegated) this.finish_runtime(runtime_lease);
      throw error;
    }
  }

  /** 空闲会话以当前模型配置压缩旧历史；运行互斥与可压缩性都由后端复核。 */
  public async compact_context(): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle" || this.decisions.has_pending) {
      throw new AppErrors.AppError("runtime.busy");
    }
    if (!this.context.compactable) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_context_not_compactable" },
      });
    }
    this.session_state.require_loaded_project_path();
    const runtime = this.runtime;
    if (runtime === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_compaction_runtime_missing" },
      });
    }
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(
      this.accept_context_compaction(runtime, runtime_lease),
    );
  }

  /** 清空当前对话，并在消息受理与旧运行时完全退出后返回最终空快照。 */
  public async reset(): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    const existing_lease = this.runtime_lease;
    const reset_lease = existing_lease ?? this.runtime_gate.begin_runtime("agent");
    if (existing_lease === null) this.runtime_lease = reset_lease;
    try {
      await this.reset_session("workspace");
      return this.get_acknowledgement();
    } finally {
      if (existing_lease === null) this.finish_runtime(reset_lease);
    }
  }

  /** 立即封口公开轮次并保留历史；压缩与 workspace_apply 不接受中途停止。 */
  public stop(): AgentCommandAck {
    this.assert_not_disposed();
    if (
      this.find_open_compaction_entry() !== undefined ||
      this.find_open_workspace_apply_entry() !== undefined ||
      this.runtime?.session.isCompacting === true
    ) {
      throw new AppErrors.AppError("runtime.busy");
    }
    this.runtime?.log.request_stop();
    this.flush_assistant_stream();
    this.runtime?.session.clearQueue();
    this.input_queue.cancel_send();
    this.input_queue.pause();
    this.publish_input_queue();
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
    return this.get_acknowledgement();
  }

  /** dispose 不再发布事件，但会等待 reset、消息受理与所有运行时清理。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.images.clear();
    this.workspace.uploads.cancel();
    this.workspace.invalidate_links();
    this.clear_assistant_stream();
    this.decisions.reset();
    this.token_speed.reset();
    this.token_speed_updated_at = null;
    this.token_speed_snapshot = null;
    this.todos = [];
    this.input_queue.reset();
    this.runtime_generation += 1;
    this.unsubscribe_project_session();
    this.unsubscribe_skills();
    const runtime = this.runtime;
    const reset = this.session_reset;
    runtime?.log.reset("dispose");
    const acceptance = this.operation_acceptance;
    const settlement = this.runtime_settlement;
    this.runtime = null;
    await Promise.all([
      reset,
      acceptance?.catch(() => undefined),
      settlement?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
    ]);
    await this.workspace.reset_project(null);
  }

  /** 在当前运行世代准备运行时，启动回合前才移除队列输入。 */
  private async accept_round(
    message: AgentMessageInput,
    runtime_lease: RuntimeLease,
    queued_id?: string,
  ): Promise<AgentCommandAck> {
    let prompt_started = false;
    const generation = this.runtime_generation;
    let runtime = this.runtime;
    const created = runtime === null;
    try {
      if (queued_id !== undefined) {
        this.input_queue.begin_send(queued_id);
        this.publish_input_queue();
      }
      const model_settings = this.settings.read_setting();
      if (runtime === null) {
        await this.skills.refresh();
        this.assert_current_acceptance(generation);
        runtime = await this.create_runtime(model_settings);
      } else {
        await this.update_runtime_model(runtime, model_settings);
      }
      this.assert_current_acceptance(generation);
      const prepared = await this.prepare_message(message);
      this.assert_current_acceptance(generation);
      // 异步准备成功后才提交候选运行时。
      if (created) {
        this.runtime = runtime;
        this.publish_context();
      }
      if (queued_id !== undefined) {
        this.input_queue.commit_send();
        this.publish_input_queue();
      }
      const prompt = this.start_round(runtime, generation, message, prepared, runtime_lease);
      this.track_runtime_settlement(prompt);
      prompt_started = true;
      return this.get_acknowledgement();
    } finally {
      if (!prompt_started) {
        if (created) {
          if (this.runtime === runtime) this.runtime = null;
          if (runtime !== null) await this.close_runtime(runtime);
        }
        if (queued_id !== undefined && generation === this.runtime_generation) {
          this.input_queue.cancel_send();
          this.input_queue.pause();
          this.publish_input_queue();
        }
        this.finish_runtime(runtime_lease);
      }
    }
  }

  /** 重置和工程切换可发生在任一准备阶段，迟到结果只能清理自己的候选。 */
  private assert_current_acceptance(generation: number): void {
    if (this.disposed || generation !== this.runtime_generation) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_message_invalidated" },
      });
    }
  }

  /** 已解除暂停的继续命令从产品 FIFO 选择队首，复用普通队列受理链。 */
  private accept_next_queued_message(runtime_lease: RuntimeLease): Promise<AgentCommandAck> {
    const item = this.input_queue.read_next();
    if (item === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_continue_queue_missing" },
      });
    }
    this.require_resources();
    return this.accept_round(item, runtime_lease, item.id);
  }

  /** 重试与修改共享同一受理边界，目标检查通过后才取得运行 lease。 */
  private async begin_revision(revision: AgentRevision): Promise<AgentCommandAck> {
    this.require_resources();
    this.session_state.require_loaded_project_path();
    const runtime = this.runtime;
    if (runtime === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_revision_runtime_missing" },
      });
    }
    const runtime_lease = this.runtime_gate.begin_runtime("agent");
    this.runtime_lease = runtime_lease;
    return await this.track_operation_acceptance(
      this.accept_revision(runtime, revision, runtime_lease),
    );
  }

  /** 模型预检成功后才裁剪；提交段只改内存历史并立即建立唯一替代版本。 */
  private async accept_revision(
    runtime: AgentRuntime,
    revision: AgentRevision,
    runtime_lease: RuntimeLease,
  ): Promise<AgentCommandAck> {
    let prompt_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (this.disposed || generation !== this.runtime_generation || this.runtime !== runtime) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_revision_invalidated" },
        });
      }

      const prepared =
        revision.role === "assistant" ? null : await this.prepare_message(revision.message);
      runtime.log.revise(
        this.latest_round_checkpoint!.entry_id,
        revision.role,
        revision.message.text,
      );
      this.replace_active_history(runtime, revision.checkpoint.leaf_id);
      this.pending_assistant_checkpoint = null;
      if (revision.role === "assistant") {
        this.replace_with_assistant(runtime, revision.prefix, revision.message.text);
        return this.get_acknowledgement();
      }

      const prompt = this.start_round(
        runtime,
        generation,
        revision.message,
        prepared!,
        runtime_lease,
        revision.prefix,
      );
      this.track_runtime_settlement(prompt);
      prompt_started = true;
      return this.get_acknowledgement();
    } finally {
      if (!prompt_started) this.finish_runtime(runtime_lease);
    }
  }

  /** SessionManager 在内存模式下用根到 leaf 的单一路径替换整棵旧树。 */
  private replace_active_history(runtime: AgentRuntime, leaf_id: string | null): void {
    const before = runtime.session.getSessionStats().tokens;
    if (leaf_id === null) runtime.session.sessionManager.newSession();
    else runtime.session.sessionManager.createBranchedSession(leaf_id);
    const after = runtime.session.getSessionStats().tokens;
    // SDK 内存分支只保留新路径，差额属于同一产品对话已发生的用量。
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      this.removed_usage[key] += before[key] - after[key];
    }
    runtime.session.refreshContext();
    this.context = read_agent_session_context(runtime.session);
    this.publish_usage();
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
    runtime.session.refreshContext();
    const entry: AgentEntry = {
      kind: "assistant_message",
      id: uuidv7(),
      parts: [{ kind: "text", text }],
      status: "success",
      createdAt: created_at,
    };
    this.entries = [...structuredClone(prefix), entry];
    this.latest_output_checkpoint = { entry_id: entry.id, leaf_id: checkpoint_leaf };
    this.context = read_agent_session_context(runtime.session);
    this.state = "idle";
    this.publish_snapshot_seed();
  }

  /** 继续受理只更新模型并启动失败 round 的唯一尾部恢复。 */
  private async accept_continue(
    runtime: AgentRuntime,
    runtime_lease: RuntimeLease,
  ): Promise<AgentCommandAck> {
    let continuation_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (this.disposed || generation !== this.runtime_generation || this.runtime !== runtime) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_continue_invalidated" },
        });
      }
      this.translation_paused_result = null;
      const continuation = this.run_continue(runtime, generation, runtime_lease);
      this.track_runtime_settlement(continuation);
      continuation_started = true;
      return this.get_acknowledgement();
    } finally {
      if (!continuation_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 手动压缩独占共享运行时，但不建立模型 round 或改变公开会话状态。 */
  private async accept_context_compaction(
    runtime: AgentRuntime,
    runtime_lease: RuntimeLease,
  ): Promise<AgentCommandAck> {
    let compaction_started = false;
    try {
      const generation = this.runtime_generation;
      await this.update_runtime_model(runtime, this.settings.read_setting());
      if (
        !this.runtime_is_current(runtime, generation) ||
        this.state !== "idle" ||
        !this.context.compactable
      ) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "agent_compaction_invalidated" },
        });
      }
      this.begin_context_compaction();
      const compaction = this.run_context_compaction(runtime, runtime_lease);
      this.track_runtime_settlement(compaction);
      compaction_started = true;
      return this.get_acknowledgement();
    } finally {
      if (!compaction_started) this.finish_runtime(runtime_lease);
    }
  }

  /** 手动压缩在后台结算，公开终态与诊断继续由统一压缩事件拥有。 */
  private async run_context_compaction(
    runtime: AgentRuntime,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    try {
      await runtime.session.compact();
    } catch {
      // AgentSession.compact 在拒绝前已同步发布 compaction_end，公开失败与诊断由该事件收束。
    } finally {
      this.finish_runtime(runtime_lease);
    }
  }

  /** 新轮次记录模型写入前的唯一切点；替代操作通过 snapshot_seed 原子换掉旧尾部。 */
  private start_round(
    runtime: AgentRuntime,
    generation: number,
    message: AgentMessageInput,
    prepared: PreparedAgentMessage,
    runtime_lease: RuntimeLease,
    replacement_prefix?: readonly AgentEntry[],
  ): Promise<void> {
    this.start_round_entry(runtime, message, replacement_prefix);
    return this.run_round(runtime, generation, runtime_lease, {
      kind: "prompt",
      ...prepared,
    });
  }

  /** 建立公开 round 与 SDK history checkpoint；steer 输入不经过此入口。 */
  private start_round_entry(
    runtime: AgentRuntime,
    message: AgentMessageInput,
    replacement_prefix?: readonly AgentEntry[],
  ): void {
    this.translation_paused_result = null;
    const entry: AgentEntry = {
      kind: "user_message",
      id: uuidv7(),
      delivery: "round",
      text: message.text,
      attachments: message.attachments,
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
      averageTokensPerSecond: null,
    };
    this.token_speed.reset();
    this.token_speed_updated_at = null;
    this.publish_token_speed(null);
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
      this.publish_snapshot_seed();
    }
  }

  /** 恢复原 user 轮次并以隐藏消息继续，保留失败前的公开条目与模型历史。 */
  private continue_failed_round(
    runtime: AgentRuntime,
    generation: number,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    const user = this.entries.findLast(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
    if (user?.kind !== "user_message" || user.delivery !== "round" || user.status !== "error") {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "agent_failed_round_missing" },
      });
    }
    this.pending_assistant_checkpoint = null;
    // 先恢复已显示的均速，再切回运行态，避免状态条在首个新增量前短暂丢失速度。
    this.token_speed_updated_at = null;
    this.publish_token_speed(user.averageTokensPerSecond);
    this.upsert_entry({ ...user, status: "running", endedAt: null, averageTokensPerSecond: null });
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
      {
        user_agent: this.user_agent,
        session_id: runtime.session_id,
      },
      this.catalog,
    );
    await runtime.session.setModel(resolved_model.model);
    runtime.session.settingsManager.applyOverrides(build_agent_session_settings());
    runtime.session.setThinkingLevel(resolved_model.thinkingLevel);
    runtime.model_config = resolved_model.model_config;
    this.publish_context();
  }

  /** 创建完全内存化的 SDK 会话，并关闭默认工具与运行期资源发现。 */
  private async create_runtime(model_settings: JsonRecord): Promise<AgentRuntime> {
    const resources = this.require_resources();
    const app_root = this.paths.get_app_root();
    const session_manager = SessionManager.inMemory(app_root);
    const session_id = session_manager.getSessionId();
    const model_runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const resolved_model = register_agent_model(
      model_runtime,
      model_settings,
      {
        user_agent: this.user_agent,
        session_id,
      },
      this.catalog,
    );
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
      systemPrompt: resources.baseSystemPrompt,
      appendSystemPrompt: [],
    });
    await resource_loader.reload();
    append_agent_session_seed(session_manager, resources.sessionSeed, resolved_model.model);
    const { session } = await createAgentSession({
      cwd: app_root,
      agentDir: app_root,
      modelRuntime: model_runtime,
      model: resolved_model.model,
      thinkingLevel: resolved_model.thinkingLevel,
      noTools: "builtin",
      customTools: [
        create_agent_batch_item_translation_tool(async (request, signal) => {
          const lease = this.runtime_lease;
          if (lease === null) throw new AppErrors.AppError("runtime.internal_invariant");
          if (this.translation_paused_result !== null) return this.translation_paused_result;
          const generation = this.runtime_generation;
          try {
            this.session_state.require_loaded_project_path();
            signal.throwIfAborted();
            this.runtime_gate.assert_current_runtime(lease, "agent");
            const model = resolve_agent_batch_translation_model(
              this.settings.read_setting(),
              runtime.model_config,
            );
            const result = await this.batch_translation.run_under_agent(
              lease,
              signal,
              model,
              request,
            );
            if (generation === this.runtime_generation && result.stop_source === "user") {
              this.translation_paused_result = result;
            }
            return result;
          } catch (error) {
            if (error instanceof BatchTranslationCompletionError) {
              if (generation === this.runtime_generation && error.result.stop_source === "user") {
                this.translation_paused_result = error.result;
              }
              // 翻译边界投影取消事实；原始收尾异常进入本地诊断。
              this.log_manager.error(t_main_log("app.diagnostic.agent.tool_execution_failed"), {
                source: "agent",
                error,
                context: { tool_name: "run_batch_item_translation" },
              });
              throw new AgentToolError({ code: "tool_failed", ...error.result }, error);
            }
            throw error;
          }
        }),
        ...create_agent_question_tools({
          wait_for_answer: (tool_call_id, question, signal) =>
            this.decisions.wait_for_question(tool_call_id, question, signal),
        }),
        ...create_agent_workspace_tools({
          workspace: {
            run: async (...args) => {
              // 文件写入在失败或取消前也可能完成，进程收尾后统一同步磁盘事实。
              const result = await this.workspace.run(...args).then(
                (value) => ({ ok: true as const, value }),
                (error: unknown) => ({ ok: false as const, error }),
              );
              try {
                await this.skills.refresh();
              } catch (error) {
                // 程序和刷新同时失败时保留程序错误，刷新异常另记诊断。
                if (result.ok) throw error;
                this.log_manager.error(t_main_log("app.diagnostic.agent.tool_execution_failed"), {
                  source: "agent",
                  error,
                  context: { tool_name: "workspace_run", action: "refresh_skills" },
                });
              }
              if (!result.ok) throw result.error;
              return result.value;
            },
            apply_workspace: (...args) => this.workspace.apply_workspace(...args),
          },
          todo: this.todo_port(),
          approval: this.workspace_approval_port(),
        }),
        ...create_agent_skill_tools(() => this.skills.get_current(), this.paths),
        ...(this.web_search === undefined ? [] : [create_agent_web_search_tool(this.web_search)]),
      ].map((tool) => prepare_agent_tool(tool, this.log_manager)),
      resourceLoader: resource_loader,
      sessionManager: session_manager,
      settingsManager: settings_manager,
    });
    // 模板与历史保持稳定，每次请求在原位插入当前人格，并附加最新技能目录。
    const transform_context = session.agent.transformContext;
    session.agent.transformContext = async (messages, signal) => {
      const original = transform_context ? await transform_context(messages, signal) : messages;
      const catalog = format_agent_skills_for_system_prompt(this.skills.get_current());
      const override = this.settings.read_setting().agent_personality;
      const personality = typeof override === "string" ? override : resources.defaultPersonality;
      const context = original.map((message) => {
        // DefaultResourceLoader 将固定模板放入 preamble，按请求替换并保留历史原文。
        if (message.role !== "system" || typeof message.sections?.preamble !== "string")
          return message;
        return {
          ...message,
          sections: {
            ...message.sections,
            preamble: insert_agent_personality(message.sections.preamble, personality),
          },
        };
      });
      if (!catalog) return context;
      return [
        {
          role: "system",
          content: "",
          sections: { available_skills: catalog },
          timestamp: Date.now(),
        },
        ...context,
      ];
    };
    const runtime: AgentRuntime = {
      session_id,
      log: new AgentSessionLog(this.log_manager),
      session,
      model_config: resolved_model.model_config,
      unsubscribe: () => undefined,
      steer_ready: false,
    };
    runtime.unsubscribe = session.subscribe((event) => {
      runtime.log.handle_event(event);
      if (this.runtime?.session === session) this.handle_agent_event(event);
    });
    return runtime;
  }

  /** SDK 拥有单个 round 内的工具循环与压缩；产品只在 settle 后消费 FIFO。 */
  private async run_round(
    runtime: AgentRuntime,
    generation: number,
    runtime_lease: RuntimeLease,
    request: AgentModelRequest,
  ): Promise<void> {
    let outcome: Extract<AgentEntryStatus, "success" | "error"> = "success";
    let next_request: AgentModelRequest | null = null;
    // 恢复会从模型上下文排除失败响应，运行结果必须由本次执行事件独立确认。
    let request_error: string | null = null; // 后续响应成功时清除本次执行的中间失败。
    const unsubscribe_result = runtime.session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        request_error =
          event.message.stopReason === "error"
            ? (event.message.errorMessage ?? "Agent model turn failed.")
            : null;
      } else if (
        event.type === "compaction_end" &&
        event.reason === "overflow" &&
        event.result === undefined
      ) {
        request_error = event.errorMessage ?? "Agent context recovery failed.";
      }
    });
    runtime.log.begin_run(this.latest_round_checkpoint!.entry_id, request.kind);
    try {
      // 普通入口已在受理前完成预检；FIFO 在实际出队执行时采用新设置，失败归入该轮终态。
      if (request.kind === "queued")
        await this.update_runtime_model(runtime, this.settings.read_setting());
      if (!this.prompt_is_current(runtime, generation)) return;
      if (request.kind === "continue") await this.send_continue(runtime);
      else await this.send_prompt(runtime, generation, request.text, request.images);
      if (this.prompt_is_current(runtime, generation) && request_error !== null) {
        outcome = "error";
        this.log_request_failure(new Error(request_error));
      }
    } catch (error) {
      if (this.prompt_is_current(runtime, generation)) {
        outcome = "error";
        this.log_request_failure(error);
      }
    } finally {
      unsubscribe_result();
      runtime.log.finish_run(outcome);
      if (this.prompt_is_current(runtime, generation)) {
        this.flush_assistant_stream();
        this.finish_current_round(outcome);
        runtime.steer_ready = false;
        // 轮次可能在 steer 的图片准备期间结束；先等受理回滚，避免同一队列身份被两条链消费。
        await this.operation_acceptance?.catch(() => undefined);
        this.input_queue.cancel_send();
        if (outcome === "error") this.input_queue.pause();
        const next = outcome === "success" ? this.input_queue.read_next() : null;
        if (next !== null) {
          // 先占位再准备，期间仍可收新消息，但不能修改正在准备的队首。
          this.input_queue.begin_send(next.id);
          this.publish_input_queue();
          try {
            const prepared = await this.prepare_message(next);
            if (this.prompt_is_current(runtime, generation)) {
              this.input_queue.commit_send();
              this.start_round_entry(runtime, next);
              next_request = { kind: "queued", ...prepared };
            }
          } catch (error) {
            if (this.prompt_is_current(runtime, generation)) {
              this.input_queue.cancel_send();
              this.input_queue.pause();
              this.log_request_failure(error);
            }
          }
        }
        if (this.runtime_is_current(runtime, generation)) this.publish_input_queue();
        if (next_request === null && this.prompt_is_current(runtime, generation))
          this.set_state("idle");
      }
      if (next_request === null) this.finish_runtime(runtime_lease);
    }
    if (next_request !== null) {
      await this.run_round(runtime, generation, runtime_lease, next_request);
    }
  }

  /** 初始 round 统一通过 SDK preflight 防止失效请求启动模型。 */
  private async send_prompt(
    runtime: AgentRuntime,
    generation: number,
    text: string,
    images: ImageContent[],
  ): Promise<void> {
    await runtime.session.prompt(text, {
      expandPromptTemplates: false,
      images,
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

  /** 以隐藏消息恢复失败 round；压缩重试由 SDK 的下一请求预检统一处理。 */
  private async run_continue(
    runtime: AgentRuntime,
    generation: number,
    runtime_lease: RuntimeLease,
  ): Promise<void> {
    let round_started = false;
    try {
      if (this.runtime_is_current(runtime, generation)) {
        const prompt = this.continue_failed_round(runtime, generation, runtime_lease);
        round_started = true;
        await prompt;
      }
    } catch {
      // 模型与压缩事件已经发布权威失败条目和诊断，命令 Promise 不建立第二套错误通道。
      this.input_queue.pause();
      this.publish_input_queue();
    } finally {
      if (!round_started) {
        if (this.runtime_is_current(runtime, generation)) this.set_state("idle");
        this.finish_runtime(runtime_lease);
      }
    }
  }

  /** 将 SDK 事件收窄为按真实顺序追加的公开时间线；中间失败不冒充最终失败。 */
  private handle_agent_event(event: PiAgentSessionEvent): void {
    if (
      event.type === "turn_end" ||
      event.type === "agent_settled" ||
      (event.type === "entry_appended" && event.entry.type === "context_edit")
    ) {
      // message_end 通知早于 SDK 落库；这些边界已提交历史，直接读取 SessionManager。
      this.publish_context();
      return;
    }
    if (event.type === "compaction_start") {
      this.begin_context_compaction();
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
      this.publish_context();
      return;
    }
    if (event.type === "agent_start" || event.type === "turn_start") {
      if (this.runtime !== null) this.runtime.steer_ready = true;
      this.publish_input_queue();
      return;
    }
    if (event.type === "agent_end") {
      if (this.runtime !== null) this.runtime.steer_ready = false;
      this.publish_input_queue();
      return;
    }
    // stop 会先切 idle 再取消 SDK，因此取消过程中到达的事件天然失效。
    if (this.state !== "running") return;
    if (event.type === "message_start" && event.message.role === "user") {
      const item = this.input_queue.commit_send();
      if (item !== null) {
        const now = Date.now();
        this.upsert_entry({
          kind: "user_message",
          id: uuidv7(),
          delivery: "steer",
          text: item.text,
          attachments: item.attachments,
          status: "success",
          createdAt: now,
          endedAt: now,
        });
        this.publish_input_queue();
      }
      return;
    }
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.pending_assistant_checkpoint = {
        leaf_id: this.runtime?.session.sessionManager.getLeafId() ?? null,
      };
      return;
    }
    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      if (
        delta.type === "text_delta" ||
        delta.type === "thinking_delta" ||
        delta.type === "toolcall_delta"
      ) {
        const content = delta.partial.content[delta.contentIndex];
        if (delta.delta !== "" && !(content?.type === "thinking" && content.redacted === true)) {
          const now = performance.now();
          this.token_speed.record(delta.delta, delta.contentIndex, now);
          this.publish_realtime_token_speed(now);
        }
      }
      if (delta.type === "text_delta" || delta.type === "thinking_delta") {
        this.append_assistant_stream_delta(delta);
      }
      return;
    }
    if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        // 结算响应采样后保留展示值，覆盖工具执行和模型等待期间，直到下一次输出更新。
        this.token_speed.finish_response(performance.now(), event.message.usage.output);
        this.token_speed_updated_at = null;
        this.clear_assistant_stream();
        this.upsert_assistant_message(
          event.message,
          event.message.stopReason === "error" ? "error" : "success",
        );
        this.pending_assistant_checkpoint = null;
      }
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
        output: event.result.content.flatMap((part: TextContent | ImageContent) =>
          part.type === "text" ? [part.text] : [],
        ),
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

  /** running 与 canonical final 复用同一条目身份；空终帧只封口已有可见内容。 */
  private upsert_assistant_parts(
    parts: AgentAssistantMessageParts | null,
    created_at: number,
    status: AgentEntryStatus,
  ): void {
    const existing = this.find_open_assistant_entry();
    const next_parts = parts ?? existing?.parts; // 空终帧不覆盖已经公开的流式内容。
    if (next_parts === undefined) return;
    if (existing === undefined) {
      const entry: AgentEntry = {
        kind: "assistant_message",
        id: uuidv7(),
        parts: next_parts,
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
      this.upsert_entry({ ...existing, parts: next_parts, status });
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
    const parts = normalize_agent_assistant_message_parts(
      stream.blocks.map((block) => ({ kind: block.kind, text: block.chunks.join("") })),
    );
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

  /** 自动与手动压缩共用同一个公开开始事实；重复 SDK start 保持幂等。 */
  private begin_context_compaction(): void {
    const compaction = this.find_latest_compaction_entry();
    if (compaction?.status === "running") return;
    if (this.runtime !== null) this.runtime.steer_ready = false;
    this.publish_input_queue();
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
  }

  /** 连续自动压缩尝试复用最近一次失败条目，时间线始终只有一个诊断位置。 */
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
      (entry) =>
        entry.kind === "user_message" && entry.delivery === "round" && entry.status === "running",
    );
    if (user_index < 0) return;
    this.token_speed_updated_at = null;
    const average_tokens_per_second = this.token_speed.finish_round(performance.now());
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
    if (user?.kind === "user_message" && user.delivery === "round" && user.status === "running") {
      this.upsert_entry({
        ...user,
        status: outcome,
        endedAt: Date.now(),
        averageTokensPerSecond: average_tokens_per_second,
      });
    }
    this.publish_token_speed(null);
  }

  /** 每次模型历史变化后发布完整上下文快照。 */
  private publish_context(): void {
    const session = this.runtime?.session;
    if (session === undefined) return;
    this.context = read_agent_session_context(session);
    this.publish_event({ type: "context", context: structuredClone(this.context) });
    this.publish_usage();
  }

  /** SDK 汇总模型调用，产品层补回历史修订移出的已发生用量。 */
  private publish_usage(): void {
    const tokens = this.runtime?.session.getSessionStats().tokens;
    if (tokens === undefined) return;
    const usage: AgentUsageSnapshot = {
      input: this.removed_usage.input + tokens.input,
      output: this.removed_usage.output + tokens.output,
      cacheRead: this.removed_usage.cacheRead + tokens.cacheRead,
      cacheWrite: this.removed_usage.cacheWrite + tokens.cacheWrite,
    };
    if (
      (["input", "output", "cacheRead", "cacheWrite"] as const).every(
        (key) => this.usage[key] === usage[key],
      )
    )
      return;
    this.usage = usage;
    this.publish_event({ type: "usage", usage: { ...usage } });
  }

  /** 分词与实时发布共用更新节奏，即使数值不变也限制分词频率。 */
  private publish_realtime_token_speed(now: number): void {
    if (
      this.token_speed_updated_at !== null &&
      now - this.token_speed_updated_at < AGENT_TOKEN_SPEED_PUBLISH_INTERVAL_MS
    )
      return;
    this.token_speed_updated_at = now;
    this.publish_token_speed(this.token_speed.measure(now));
  }

  /** 实时数据绑定当前回合，按显示精度去重，结束结果由回合条目承载。 */
  private publish_token_speed(tokens_per_second: number | null): void {
    const round_id = this.latest_round_checkpoint?.entry_id;
    const speed: AgentTokenSpeedSnapshot =
      tokens_per_second === null || round_id === undefined
        ? null
        : { roundId: round_id, tokensPerSecond: Number(tokens_per_second.toFixed(2)) };
    if (
      this.token_speed_snapshot?.roundId === speed?.roundId &&
      this.token_speed_snapshot?.tokensPerSecond === speed?.tokensPerSecond
    )
      return;
    this.token_speed_snapshot = speed;
    this.publish_event({ type: "token_speed", tokenSpeed: structuredClone(speed) });
  }

  /** 状态未变化时不发布重复 SSE。 */
  private set_state(state: AgentSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.publish_event({ type: "session_state", state });
  }

  /** 输入队列与可 steer 能力始终以完整快照发布，renderer 可幂等替换。 */
  private publish_input_queue(): void {
    this.publish_event({
      type: "input_queue",
      inputQueue: this.input_queue.read_snapshot(this.can_send_queued_now()),
    });
  }

  /** 只有 Pi agent loop 可接收 steer，空闲时则由共享 runtime gate 决定。 */
  private can_send_queued_now(): boolean {
    if (this.decisions.has_pending) return false;
    if (this.state === "running") return this.runtime?.steer_ready === true;
    return this.runtime_gate.get_snapshot().owner === null;
  }

  /** AgentService 的所有增量在唯一入口分配 revision，再复用同一公开 topic。 */
  private publish_event(event: AgentIncrementalEvent): void {
    this.revision += 1;
    this.publish(AGENT_SESSION_EVENT_TOPIC, { ...event, revision: this.revision });
  }

  /** seed 先占用 revision，再以同一个值构造内外两层快照边界。 */
  private publish_snapshot_seed(): void {
    this.revision += 1;
    const event: AgentSessionEvent = {
      type: "snapshot_seed",
      revision: this.revision,
      snapshot: this.get_snapshot(),
    };
    this.publish(AGENT_SESSION_EVENT_TOPIC, event);
  }

  /** 命令回执只暴露同步受理完成时的事件边界，不复制会话历史。 */
  private get_acknowledgement(): AgentCommandAck {
    return { revision: this.revision };
  }

  /** 立即隔离公开会话；工程切换还把新工程路径交给 sources 生命周期。 */
  private reset_session(
    scope: "workspace" | "project",
    project_path: string | null = null,
  ): Promise<void> {
    if (this.session_reset !== null) return this.session_reset;
    this.session_id = uuidv7();
    this.images.clear();
    this.workspace.uploads.cancel();
    this.workspace.invalidate_links();
    this.runtime_generation += 1;
    this.clear_assistant_stream();
    const runtime = this.runtime;
    runtime?.log.reset(scope);
    const acceptance = this.operation_acceptance;
    const settlement = this.runtime_settlement;
    this.runtime = null;
    this.state = "idle";
    this.approval_mode = "manual";
    this.approval_mode_revision += 1;
    this.decisions.reset();
    this.entries = [];
    this.token_speed.reset();
    this.token_speed_updated_at = null;
    this.token_speed_snapshot = null;
    this.context = { tokens: null, compactable: false, limits: null };
    this.removed_usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    this.usage = { ...this.removed_usage };
    this.latest_round_checkpoint = null;
    this.translation_paused_result = null;
    this.latest_output_checkpoint = null;
    this.pending_assistant_checkpoint = null;
    this.todos = [];
    this.input_queue.reset();
    const reset = Promise.all([
      acceptance?.catch(() => undefined),
      settlement?.catch(() => undefined),
      runtime === null ? undefined : this.close_runtime(runtime),
      this.skills.refresh(),
    ])
      .then(async () => {
        if (scope === "project") {
          await this.workspace.reset_project(project_path);
        } else {
          await this.workspace.reset_workspace();
        }
        // 先恢复技能通知再发布最终快照，避免队列保存落在快照与清理屏障之间。
        if (this.session_reset === reset) this.session_reset = null;
        if (!this.disposed) {
          this.publish_snapshot_seed();
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
        runtime.unsubscribe();
      } catch (error) {
        this.warn_cleanup_failure(error);
      }
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
    acceptance: Promise<AgentCommandAck>,
  ): Promise<AgentCommandAck> {
    this.operation_acceptance = acceptance;
    try {
      return await acceptance;
    } finally {
      if (this.operation_acceptance === acceptance) this.operation_acceptance = null;
    }
  }

  /** 当前唯一后台运行持有关闭屏障，并按 Promise 身份清除自身。 */
  private track_runtime_settlement(settlement: Promise<void>): void {
    this.runtime_settlement = settlement;
    // 迟到的收尾只能清除自身持有的关闭屏障。
    const clear_settlement = () => {
      if (this.runtime_settlement === settlement) this.runtime_settlement = null;
    };
    void settlement.then(clear_settlement, clear_settlement);
  }

  /** 同时清除本地引用和共享 owner；迟到 lease 由 gate 身份校验忽略。 */
  private finish_runtime(lease: RuntimeLease): void {
    if (this.runtime_lease === lease) this.runtime_lease = null;
    this.runtime_gate.finish_runtime(lease);
    if (!this.disposed && this.session_reset === null && this.input_queue.has_items) {
      this.publish_input_queue();
    }
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

  /** 失败 round 使用隐藏模型消息续跑，不制造公开 user 轮次。 */
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

  /** 只有仍绑定当前会话的 SDK runtime 可以提交成功结束的 Node Todo。 */
  private todo_port(): AgentTodoPort {
    return {
      read: () => [...this.todos],
      write: (todos) => {
        if (this.disposed || this.runtime === null) return;
        if (
          todos.length === this.todos.length &&
          todos.every((item, index) => item === this.todos[index])
        ) {
          return;
        }
        this.todos = [...todos];
        this.publish_event({ type: "todo", todos: [...this.todos] });
      },
    };
  }

  /** workspace_apply 的授权模式与用户决定在 AgentService 边界汇合。 */
  private workspace_approval_port(): AgentWorkspaceApprovalPort {
    return {
      read_mode: () => this.approval_mode,
      wait_for_decision: async (tool_call_id, summary, signal) => {
        const mode_revision = this.approval_mode_revision;
        const decision = await this.decisions.wait_for_write_approval(
          tool_call_id,
          summary,
          signal,
        );
        if (decision === "reject") {
          throw new AgentToolError({ code: "approval_denied", action: "await_user" });
        }
        return { auto_revision: decision === "allow_session" ? mode_revision : null };
      },
      activate_auto: (mode_revision) => {
        if (mode_revision !== this.approval_mode_revision) return;
        this.approval_mode = "auto";
        this.publish_event({ type: "approval_mode", approvalMode: "auto" });
      },
    };
  }

  /** dispose 后的命令必须失败，避免重新创建已脱离订阅的运行时。 */
  private assert_not_disposed(): void {
    if (this.disposed) throw new AppErrors.AppError("runtime.disposed");
  }

  /** 消息改写只允许发生在稳定空闲态。 */
  private assert_revision_available(): void {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.state !== "idle") {
      throw new AppErrors.AppError("runtime.busy");
    }
  }

  /** 队列命令可与模型回合并行，但不能穿透 reset 关闭屏障。 */
  private assert_queue_command_available(): void {
    this.assert_not_disposed();
    if (this.session_reset !== null || this.decisions.has_pending) {
      throw new AppErrors.AppError("runtime.busy");
    }
  }
}

/** 队列命令只接受非空稳定身份。 */
function read_queue_id(request: JsonRecord): string {
  const id = request["id"];
  if (typeof id !== "string" || id === "") {
    throw agent_queue_validation_error("agent_input_queue_invalid_id");
  }
  return id;
}

/** 审批模式是公开协议窄枚举，拒绝缺失、布尔值和未知字符串。 */
function read_agent_approval_mode(request: JsonRecord): AgentApprovalMode {
  const value = request["approvalMode"];
  if (value === "manual" || value === "auto") return value;
  throw new AppErrors.AppError("request.validation_failed", {
    diagnostic_context: { reason: "agent_approval_mode_invalid" },
  });
}

/** 修改请求在服务边界拆出身份与待归一化消息。 */
function read_queue_message_request(
  request: JsonRecord,
  resolve_file: (id: string) => AgentFileAttachment,
): {
  id: string;
  message: AgentMessageInput;
} {
  const message = normalize_agent_message_input(request["message"], resolve_file);
  if (message === null) throw agent_queue_validation_error("agent_input_queue_invalid_message");
  return { id: read_queue_id(request), message };
}

/** 空 continue 不制造消息；携带 message 时仍复用完整用户消息边界。 */
function read_agent_continue_message(
  request: JsonRecord,
  resolve_file: (id: string) => AgentFileAttachment,
): AgentMessageInput | null {
  if (!Object.hasOwn(request, "message")) return null;
  const message = normalize_agent_message_input(request["message"], resolve_file);
  if (message === null) throw agent_queue_validation_error("agent_continue_invalid_message");
  return message;
}

/** 队列校验错误复用公开 validation code，并把细分原因留给诊断。 */
function agent_queue_validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", { diagnostic_context: { reason } });
}
