import { create_agent_batch_llm_request_tool } from "./tools/batch-llm-request";
import { create_search_port } from "./search/request";
import {
  BatchRequestCompletionError,
  type BatchRequestService,
} from "../batch-request/batch-request-service";
import { AgentCompactionError } from "./agent-compaction";
import { randomUUID } from "node:crypto";
import type { ProjectDatabase } from "../database/database-operations";
import type { AgentChatStorage, AgentChatRecord } from "../database/agent-chat-storage";
import {
  create_agent_workspace_apply_tool,
  type AgentWorkspaceApprovalPort,
} from "./tools/workspace-apply";
import type { AgentFile, AgentDocument } from "../../shared/agent-workspace-file";
import { normalize_agent_approval_mode } from "../../domain/setting";
import type { AgentSkillsService } from "./agent-skills-service";
import type { AgentFilesResponse } from "../../shared/agent-reference";
import type { AgentImageService } from "./agent-image-service";
import type { AgentFileAttachment } from "../../shared/agent";
import { prepare_agent_message, type PreparedAgentMessage } from "./agent-message-input";
import { BatchTaskCompletionError } from "../batch-task/batch-task-runtime";
import type { Model } from "../../domain/model";
import { create_agent_batch_item_translation_tool } from "./tools/batch-item-translation";
import { type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { isDeepStrictEqual } from "node:util";
import { AgentChat, type AgentExecution, type AgentSubmitOptions } from "./agent-chat";

import { resolve_app_locale } from "../../domain/app-language";
import { is_json_record, type JsonRecord, type JsonSnapshot } from "../../domain/json";
import {
  AGENT_CHAT_EVENT_TOPIC,
  AGENT_INPUT_COMMAND_ID_LIMIT,
  normalize_agent_message_input,
  normalize_agent_revision_request,
  type AgentWorkspaceLinkResult,
  type AgentCommandAck,
  type AgentInputCommandKind,
  type AgentInputCommandAck,
  type AgentTokenSpeedSnapshot,
  type AgentRunOutputSnapshot,
  type AgentMessageInput,
  type AgentQueuedInput,
  type AgentChatChange,
  type AgentChatSnapshot,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import { format_i18n_message } from "../../shared/i18n";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogManager } from "../log/log-manager";
import type { AgentWorkspaceDirectories } from "./workspace/directories";
import type { ProjectOperationGate } from "../runtime-operation-gate";
import { AgentDecisionCoordinator } from "./agent-decision";
import { register_agent_model, resolve_agent_batch_model } from "./agent-model";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import type { PiModelCatalogReader } from "../llm/pi-model-catalog";
import { load_agent_chat_seed, type AgentChatSeed } from "./agent-chat-seed";
import { create_agent_read_skill_tool } from "./tools/read-skill";
import { create_agent_ask_user_tool } from "./tools/ask-user";
import { AgentInputQueue } from "./agent-input-queue";
import type { AgentWorkspacePort } from "./workspace/service";
import { format_agent_workspace_contract_prompt } from "./workspace/contract";
import { create_agent_workspace_run_tool } from "./tools/workspace-run";
import { format_agent_skills_for_system_prompt } from "./agent-skills";
import {
  insert_agent_personality,
  load_agent_personality,
  load_agent_system_prompt,
} from "./agent-system-prompt";
import { AgentToolError, is_agent_cancellation } from "./tool-definition";

import { AgentTokenSpeed } from "./agent-token-speed";
import { AgentRuntimeLog, type AgentStopReason, type AgentLogStatus } from "./agent-runtime-log";

const AGENT_TOKEN_SPEED_PUBLISH_INTERVAL_MS = 250;
const AGENT_TOKEN_SPEED_DECIMAL_PLACES = 2;
const AGENT_WORKSPACE_CONTRACT_PROMPT = format_agent_workspace_contract_prompt();
const EMPTY_AGENT_CONTEXT = Object.freeze({ tokens: null, compactable: false, limits: null });
const EMPTY_AGENT_USAGE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

type AgentServicePaths = Pick<
  AppPathService,
  | "get_app_root"
  | "get_agent_builtin_skill_dir"
  | "get_agent_user_skill_dir"
  | "get_agent_system_prompt_path"
  | "get_agent_chat_seed_path"
>;

type AgentServiceOptions = {
  projectId: string;
  projectPath: string;
  database: Pick<ProjectDatabase, "open_agent_store">;
  directories: AgentWorkspaceDirectories;
  protectedChatIds: Set<string>;
  resources: LoadedAgentResources;
  auth?: ChatGPTAuthService;
  skills: Pick<AgentSkillsService, "get_current" | "subscribe" | "refresh">;
  catalog: PiModelCatalogReader;
  batchRequests: Pick<BatchRequestService, "run">;
  batchTranslation: Pick<
    import("../batch-translation/batch-translation-service").BatchTranslationService,
    "run_under_agent"
  >;
  settings: Pick<AppSettingService, "read_setting">;
  userAgent: string;
  runtimeGate: ProjectOperationGate;
  workspace: AgentWorkspacePort;
  images: Pick<AgentImageService, "prepare">;
  logManager: Pick<LogManager, "append">;
  publish: (topic: string, payload: Readonly<Record<string, JsonSnapshot>>) => void; // SSE 同步序列化，只读消费该值。
};

type AgentChatFields = Pick<
  AgentChatSnapshot,
  | "chatId"
  | "state"
  | "pendingDecision"
  | "skills"
  | "inputQueue"
  | "doing"
  | "context"
  | "usage"
  | "tokenSpeed"
  | "runOutput"
  | "exportedRoundId"
>;

/** 占用完成后才能取消，命令则等待新轮次受理。 */
type QueuedInterrupt = {
  reservation: Promise<AgentQueuedInput>;
  commandId: string | undefined;
  accepted: PromiseWithResolvers<void>;
};

type AgentWork = () => Promise<void>;

/** 调度循环持有租约，轮次各自持有取消信号。 */
type AgentRun = {
  execution: AgentExecution;
  settlement: Promise<void> | null;
  interrupt: QueuedInterrupt | null;
};

/** 启动时加载的基础提示词和会话种子。 */
type LoadedAgentResources = Readonly<{
  baseSystemPrompt: string;
  defaultPersonality: string;
  chatSeed: AgentChatSeed;
}>;

/** 应用启动时读取必需资源，打开工程直接复用该快照。 */
export function load_agent_resources(paths: AgentServicePaths): LoadedAgentResources {
  return {
    baseSystemPrompt: load_agent_system_prompt(paths),
    defaultPersonality: load_agent_personality(paths),
    chatSeed: load_agent_chat_seed(paths),
  };
}

/** 产品命令协调唯一会话与运行租约。历史和公开条目来自 durable 提交。 */
export class AgentService {
  private readonly auth: ChatGPTAuthService | undefined;
  private readonly catalog: PiModelCatalogReader;
  private readonly batch_requests: AgentServiceOptions["batchRequests"];
  private readonly batch_translation: AgentServiceOptions["batchTranslation"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly skills: AgentServiceOptions["skills"];
  private readonly user_agent: string;
  private readonly runtime_gate: ProjectOperationGate;
  private readonly workspace: AgentWorkspacePort;
  private readonly images: AgentServiceOptions["images"];
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_skills: () => void;
  private readonly decisions: AgentDecisionCoordinator;
  private readonly token_speed = new AgentTokenSpeed();
  private token_speed_snapshot: AgentTokenSpeedSnapshot = null;
  private token_speed_updated_at: number | null = null;
  private run_output: AgentRunOutputSnapshot = null; // 冻结值，只在执行期间存在，不进入条目
  private exported_round_id: string | null = null; // 本次运行最后一轮成功且包含导出时记录，收尾后公开。
  private readonly store: AgentChatStorage;
  private record: AgentChatRecord | null = null;
  private resetting: Promise<void> | null = null; // 快照和关闭等待新旧对话交接。
  private recovering: Promise<void> | null = null; // 封闭的 Harness 只重接一次。

  private get chat_id(): string {
    if (this.record === null) throw new AppErrors.AppError("runtime.disposed");
    return this.record.id;
  }
  private chat: AgentChat | null = null;
  private model_config: Model | null = null; // 当前主模型配置供批量翻译跟随解析
  private run: AgentRun | null = null;
  private readonly input_commands = new Map<
    string,
    { kind: AgentInputCommandKind; request: JsonRecord; work: Promise<AgentInputCommandAck> }
  >(); // 同一命令的并发回包共用受理过程
  private readonly resources: LoadedAgentResources;
  private revision = 0;
  private disposed = false;
  private publishedFields: AgentChatFields | null = null; // 上一批已发布的控制字段，用于抑制重复通知
  private skill_snapshot: AgentChatFields["skills"]; // 随技能目录的变更通知更新。
  private queueSnapshot?: {
    source: AgentChat["state"]["queue"] | undefined;
    canSendNow: boolean;
    value: AgentChatFields["inputQueue"];
  };

  private get execution(): AgentExecution | null {
    return this.run?.execution ?? null;
  }

  /** 连接工程生命周期、技能变更与决定协调器，会话事实统一提交后发布。 */
  private constructor(private readonly options: AgentServiceOptions) {
    this.store = options.database.open_agent_store(options.projectPath);
    this.resources = options.resources;
    this.auth = options.auth;
    this.catalog = options.catalog;
    this.batch_translation = options.batchTranslation;
    this.batch_requests = options.batchRequests;
    this.settings = options.settings;
    this.skills = options.skills;
    this.skill_snapshot = this.read_skill_snapshot();
    this.unsubscribe_skills = this.skills.subscribe(() => {
      this.skill_snapshot = this.read_skill_snapshot();
      if (!this.disposed && this.chat !== null) {
        this.publish_snapshot();
      }
    });
    this.user_agent = options.userAgent;
    this.runtime_gate = options.runtimeGate;
    this.workspace = options.workspace;
    this.images = options.images;
    this.log_manager = options.logManager;
    this.publish = (topic, payload) =>
      options.publish(topic, { ...payload, projectId: options.projectId });
    // 决定随当前工具等待存活，直接发布协调器事实，重开时由 SDK 取消遗留任务。
    this.decisions = new AgentDecisionCoordinator(() => this.publish_snapshot());
  }

  /** 会话清理期间拒绝激活工作区链接。 */
  public async activate_workspace_path(request: JsonRecord): Promise<AgentWorkspaceLinkResult> {
    this.assert_available();
    return this.workspace.activate_path(is_json_record(request) ? request["path"] : undefined);
  }

  /** 文件描述绑定当前会话，旧标签不能打开新会话的同名文件。 */
  public describe_workspace_file(path: unknown): AgentFile {
    this.assert_available();
    return this.workspace.describe_file(path);
  }

  /** 请求和响应都绑定对话身份，防止旧页面读取重建后的同名文件。 */
  public async read_workspace_document(path: unknown): Promise<AgentDocument> {
    this.assert_available();
    const chatId = this.chat_id;
    const document = await this.workspace.read_document(path);
    this.assert_chat_identity(chatId);
    return { chatId, ...document };
  }

  /** 配图与正文共用会话边界，旧会话的图片响应同样失效。 */
  public async read_workspace_image(
    href: string | null,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    this.assert_available();
    const chatId = this.chat_id;
    const image = await this.workspace.read_document_image(href);
    this.assert_chat_identity(chatId);
    return image;
  }

  /** 在公开读取入口校验序号，并从当前会话分支解码历史图片。 */
  public read_tool_image(
    entry_id: string | null,
    raw_index: string | null,
  ): { bytes: Uint8Array; mime: string } {
    const index = Number(raw_index);
    if (!entry_id || !raw_index || !/^\d+$/.test(raw_index) || !Number.isSafeInteger(index)) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    this.assert_available();
    const image = this.chat?.view.read_tool_image(entry_id, index);
    if (image === undefined) throw new AppErrors.AppError("file.not_found");
    return { bytes: Buffer.from(image.data, "base64"), mime: image.mimeType };
  }

  /** 上传不占用模型或脚本互斥，文件身份仍属于当前工程会话。 */
  public async upload_file(
    name: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<AgentFileAttachment> {
    this.assert_available();
    return this.workspace.uploads.upload(name, body, signal);
  }

  /** Gateway 关闭前取消请求体读取，让在途上传及时退出。 */
  public cancel_uploads(): void {
    this.workspace.cancel_uploads();
  }

  /** 文件下载遵守会话关闭屏障，存储层拥有定位与流的创建。 */
  public read_upload(id: string): ReturnType<AgentWorkspacePort["uploads"]["open"]> {
    this.assert_available();
    return this.workspace.uploads.open(id);
  }

  /** 请求附件只提交身份，完整元数据取自当前上传记录。 */
  private readonly resolve_file = (id: string): AgentFileAttachment =>
    this.workspace.uploads.get(id);

  /** 附件转换后先复核执行归属，已取消的旧执行沿取消回执收尾。 */
  private async prepare_message(message: AgentMessageInput): Promise<PreparedAgentMessage> {
    const execution = this.execution;
    const prepared = await prepare_agent_message(message, this.workspace.uploads, this.images);
    if (execution !== this.execution || execution?.controller.signal.aborted)
      throw new AppErrors.AppError("runtime.cancelled");
    this.assert_not_disposed();
    return prepared;
  }

  /** 菜单读取当前会话可用的轻量文件事实。 */
  public async list_files(): Promise<AgentFilesResponse> {
    this.assert_available();
    const chatId = this.chat_id;
    const files = await this.workspace.list_files();
    this.assert_chat_identity(chatId);
    return { chatId, files };
  }

  /** 只投影界面可见技能，模型请求直接读取技能目录。 */
  private read_skill_snapshot(): AgentChatFields["skills"] {
    return this.skills
      .get_current()
      .filter(({ visible }) => visible)
      .map(({ name, displayDescriptions }) => ({ name, displayDescriptions }));
  }

  /** 队列内容由提交快照替换，即时发送资格也可能随运行状态独立变化。 */
  private get_queue_snapshot(): AgentChatFields["inputQueue"] {
    const source = this.chat?.state.queue;
    const canSendNow = this.can_send_now();
    if (this.queueSnapshot?.source !== source || this.queueSnapshot?.canSendNow !== canSendNow)
      this.queueSnapshot = {
        source,
        canSendNow,
        value: new AgentInputQueue(source).read_snapshot(canSendNow),
      };
    return this.queueSnapshot.value;
  }

  /** 重连可能恰逢重置，等新快照完成再向 HTTP 调用者交付。 */
  public async read_snapshot(): Promise<AgentChatSnapshot> {
    while (this.resetting !== null) await this.resetting;
    return this.get_snapshot();
  }

  /** 快照由相同的提交事实投影，调用者只能取得独立值。 */
  public get_snapshot(): AgentChatSnapshot {
    this.assert_available();
    return structuredClone({
      ...this.read_fields(),
      revision: this.revision,
      entries: this.chat?.entries ?? [],
    });
  }

  /** 运行在完成取消与收尾前仍占用工程。 */
  private get state(): AgentChatSnapshot["state"] {
    const execution = this.execution;
    if (execution === null || this.chat === null) return "idle";
    return execution.controller.signal.aborted ? "stopping" : "running";
  }
  /** 读取会话控制字段，用于事件比较和完整快照组装。 */
  private read_fields(): AgentChatFields {
    const chat = this.chat;
    return {
      chatId: this.chat_id,
      state: this.state,
      pendingDecision: this.decisions.read_pending(),
      skills: this.skill_snapshot,
      inputQueue: this.get_queue_snapshot(),
      doing: chat?.state.doing ?? null,
      context: chat?.context ?? EMPTY_AGENT_CONTEXT,
      usage: chat?.usage ?? EMPTY_AGENT_USAGE,
      tokenSpeed: this.token_speed_snapshot,
      runOutput: this.run_output,
      exportedRoundId: this.run === null ? this.exported_round_id : null,
    };
  }
  /** 协调器同步清除决定并发布事件，回执指向浮层关闭后的修订。 */
  public async resolve_question(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_available();
    this.decisions.resolve_question(request);
    return this.ack();
  }
  /** 工程授权与问题回答共用决定提交边界。 */
  public async resolve_write_approval(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_available();
    this.decisions.resolve_write_approval(request);
    return this.ack();
  }

  /** 先恢复唯一登记和历史，再由工程注册表公布打开周期。 */
  public static async open(options: AgentServiceOptions): Promise<AgentService> {
    const service = new AgentService(options);
    try {
      await service.restore();
      return service;
    } catch (error) {
      try {
        await service.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Agent open and cleanup failed", {
          cause: error,
        });
      }
      throw error;
    }
  }

  /** 工程副本换用本机材料身份，继续读取工程内原有历史。 */
  private async restore(): Promise<void> {
    const { directories, protectedChatIds, projectPath } = this.options;
    const saved = await this.store.read();
    const id =
      saved === null
        ? await directories.create()
        : await directories.claim(saved.id, projectPath, protectedChatIds.has(saved.id));
    protectedChatIds.add(id);
    try {
      if (saved === null) {
        await directories.claim(id, projectPath, false);
        this.record = await this.store.create(id);
      } else {
        this.record = id === saved.id ? saved : await this.store.replace_id(saved, id);
      }
    } catch (error) {
      protectedChatIds.delete(id);
      if (id !== saved?.id) await directories.remove(id);
      throw error;
    }
    await this.activate_record(this.record);
    await directories.prune(protectedChatIds);
  }

  /** 上传登记和 SDK 历史分别绑定工作区身份与文档键。 */
  private async activate_record({ id, data }: AgentChatRecord): Promise<void> {
    await this.workspace.activate_chat(id, data.uploads, (file) =>
      this.store.save_upload(id, file),
    );
    this.chat = await this.create_chat(data.documentKey ?? id);
    this.publish_snapshot(true);
  }

  /** chatId 只校验旧命令或预览的归属，工程路由始终使用 projectId。 */
  public assert_chat_identity(expected: unknown): void {
    this.assert_available();
    if (expected !== this.chat_id) throw new AppErrors.AppError("runtime.cancelled");
  }

  /** 旧对话与上传收尾之后才清理登记，重置租约保护整个交接过程。 */
  public async reset(): Promise<AgentCommandAck> {
    this.assert_available();
    const lease = this.runtime_gate.begin_runtime("agent_reset");
    const resetting = this.reset_chat();
    this.resetting = resetting;
    try {
      await resetting;
      this.assert_not_disposed();
      return this.ack();
    } finally {
      this.resetting = null;
      this.runtime_gate.finish_runtime(lease);
    }
  }

  /** 先等在途重接与命令结算，再清理持久化数据。 */
  private async reset_chat(): Promise<void> {
    await this.recovering;
    await Promise.allSettled([...this.input_commands.values()].map(({ work }) => work));
    const old = this.record; // 清空登记之后仍需要旧身份来清理本机材料。
    this.chat?.log.reset("workspace");
    try {
      await this.close_chat("reset");
      await this.store.reset();
    } catch (error) {
      if (!this.disposed && old !== null) {
        try {
          const saved = await this.store.read();
          // 数据库关闭失败也可能发生在清空已提交之后，按重新读到的事实交接。
          if (saved === null) await this.open_reset_chat(old);
          else await this.activate_record(saved);
        } catch (recovery) {
          throw new AggregateError([error, recovery], "Agent reset and recovery failed", {
            cause: error,
          });
        }
      }
      throw error;
    }
    await this.open_reset_chat(old);
  }

  /** 只有 SDK 历史已清空，才释放旧材料目录并创建空对话。 */
  private async open_reset_chat(old: AgentChatRecord | null): Promise<void> {
    this.record = null;
    if (old !== null) {
      this.options.protectedChatIds.delete(old.id);
      await this.options.directories.remove(old.id);
    }
    if (!this.disposed) await this.restore();
  }

  /** 所有公开输入命令先按产品身份去重，再进入原有租约与队列规则。 */
  public async input_command(
    kind: AgentInputCommandKind,
    request: JsonRecord,
  ): Promise<AgentInputCommandAck> {
    const chat = await this.command_chat(request["chatId"]);
    this.assert_available();
    const { chatId: _chatId, commandId, ...body } = request;
    if (
      typeof commandId !== "string" ||
      commandId.length === 0 ||
      commandId.length > AGENT_INPUT_COMMAND_ID_LIMIT
    )
      throw agent_queue_validation_error("agent_input_command_invalid");
    const saved = chat.state.commands[commandId];
    const running = this.input_commands.get(commandId);
    const previous = saved ?? running;
    if (
      previous !== undefined &&
      (previous.kind !== kind || !isDeepStrictEqual(previous.request, body))
    )
      throw agent_queue_validation_error("agent_input_command_conflict");
    if (running !== undefined) return running.work;
    if (saved !== undefined) return Promise.resolve({ ...this.ack(), status: saved.status });
    // 持久化期间的重复命令共用 Promise，并在内存边界核对冻结参数。
    const requestBody = structuredClone(body); // 受理过程和并发查重共用固定的参数副本
    const work = this.accept_input_command(chat, kind, commandId, requestBody);
    this.input_commands.set(commandId, { kind, request: requestBody, work });
    void work
      .finally(() => {
        this.input_commands.delete(commandId);
      })
      .catch(() => undefined); // 原始 Promise 将受理错误返回命令调用方。
    return work;
  }

  /** 重连只查询受理结果，不产生新的输入或模型请求。 */
  public async input_command_status(request: JsonRecord): Promise<AgentInputCommandAck> {
    const chat = await this.command_chat(request["chatId"]);
    this.assert_available();
    if (typeof request["commandId"] !== "string")
      throw agent_queue_validation_error("agent_input_command_invalid");
    const commandId = request["commandId"];
    const running = this.input_commands.has(commandId);
    await chat.flush();
    chat.assert_usable();
    this.assert_available();
    if (this.chat !== chat) throw agent_queue_validation_error("agent_input_command_invalid");
    return {
      ...this.ack(),
      status: chat.state.commands[commandId]?.status ?? (running ? "pending" : "unknown"),
    };
  }

  /** 先保存受理意图，业务失败时按 SDK 回执结算并保留原始错误。 */
  private async accept_input_command(
    chat: AgentChat,
    kind: AgentInputCommandKind,
    commandId: string,
    body: JsonRecord,
  ): Promise<AgentInputCommandAck> {
    await chat.change((state) => {
      state.commands[commandId] = {
        kind,
        request: body,
        status: "pending",
      };
    });
    try {
      if (this.chat !== chat) throw new AppErrors.AppError("runtime.cancelled");
      chat.assert_usable(); // 登记后实例失效时由状态核对结算，旧命令不能借公开入口重开并重发。
      const request = { ...body, commandId, chatId: this.chat_id };
      switch (kind) {
        case "send":
          await this.send_message(request);
          break;
        case "queue_send":
          await this.send_queued_message(request);
          break;
        case "fork":
          await this.fork_round(request);
          break;
        case "revise":
          await this.revise_round(request);
          break;
        case "continue":
          await this.continue_chat(request);
          break;
      }
    } catch (error) {
      if (!chat.sealed)
        await chat.cancel_pending_command(commandId).catch((failure) => {
          chat.log.report_failure("cleanup", failure);
          chat.log.flush();
        });
      throw error;
    }
    await chat.cancel_pending_command(commandId);
    return { ...this.ack(), status: chat.state.commands[commandId]!.status };
  }

  /** 运行中入队，空闲时占用租约并完成模型与附件预检。 */
  public async send_message(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    const message = this.read_message(request);
    const execution = this.execution;
    if (
      execution !== null &&
      execution.phase !== "preparing" &&
      execution.phase !== "settling" &&
      !execution.controller.signal.aborted
    ) {
      await chat.change_queue((queue) => queue.enqueue(message), read_input_command_id(request));
      return this.ack();
    }
    if (chat.queue.is_paused) throw agent_queue_validation_error("agent_continue_required");
    const run = this.begin_run(read_input_command_id(request));
    return this.accept(run, () => this.prepare_run(chat, run, message));
  }
  /** 编辑只作用于尚未发送的草稿，附件身份在服务边界解析。 */
  public async update_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    const { id, message } = read_queue_message_request(request, this.resolve_file);
    await chat.change_queue((queue) => queue.update(id, message));
    return this.ack();
  }
  /** 删除草稿经队列事务校验发送状态并同步暂停态。 */
  public async delete_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    await chat.change_queue((queue) => queue.delete(read_queue_id(request)));
    return this.ack();
  }
  /** 重排校验完整身份排列，`sending` 项仍属于队列。 */
  public async reorder_queued_messages(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    const ids = request["ids"];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      throw agent_queue_validation_error("agent_input_queue_invalid_order");
    await chat.change_queue((queue) => queue.reorder(ids as string[]));
    return this.ack();
  }
  /** 运行中占用选中的草稿并请求停止，由当前调度循环接续。 */
  public async send_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    const id = read_queue_id(request);
    const commandId = read_input_command_id(request);
    const run = this.run;
    if (run === null) {
      const started = this.begin_run(commandId);
      return this.accept(started, async () => {
        const item = await chat.change_queue((queue) => queue.begin_send(id));
        return this.prepare_run(chat, started, item, { queuedId: id });
      });
    }
    if (!this.can_send_now()) throw new AppErrors.AppError("runtime.busy");
    const execution = run.execution;
    const interrupt: QueuedInterrupt = {
      commandId,
      accepted: Promise.withResolvers<void>(),
      reservation: chat
        .change_queue((queue) => queue.begin_send(id))
        .then(async (item) => {
          // 事务期间轮次可能自然结束或进入不可停止的工具。
          if (this.chat !== chat || execution.controller.signal.aborted)
            throw new AppErrors.AppError("runtime.cancelled");
          if (execution.phase === "settling") return item;
          if (!chat.can_stop || this.decisions.has_pending) {
            await chat.change_queue((queue) => queue.cancel_send());
            throw new AppErrors.AppError("runtime.busy");
          }
          this.cancel_execution(chat, execution, "queue_send");
          return item;
        }),
    };
    run.interrupt = interrupt;
    try {
      await Promise.all([interrupt.reservation, interrupt.accepted.promise]);
      return this.ack();
    } finally {
      if (run.interrupt === interrupt) {
        run.interrupt = null;
        this.publish_snapshot();
      }
    }
  }
  /** 继续优先发送队首，空队列才恢复原失败轮次。 */
  public async continue_chat(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_queue_available();
    const round = chat.entries.findLast(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
    const failed =
      round?.kind === "user_message" && round.delivery === "round" && round.status === "error";
    const message = read_agent_continue_message(request, this.resolve_file);
    const has_items = chat.queue.has_items;
    if (!has_items && !failed) throw agent_queue_validation_error("agent_continue_unavailable");
    if (message !== null && !has_items)
      throw agent_queue_validation_error("agent_continue_message_without_queue");
    const run = this.begin_run(read_input_command_id(request));
    const execution = run.execution;
    return this.accept(run, async () => {
      if (has_items) {
        const next = await chat.change_queue((queue) => queue.begin_next(true));
        if (next === null) throw agent_queue_validation_error("agent_continue_unavailable");
        return this.prepare_run(chat, run, next, {
          queuedId: next.id,
          change: (state) => {
            const queue = new AgentInputQueue(state.queue);
            if (message !== null) queue.enqueue(message);
            queue.resume();
          },
        });
      } else if (failed) {
        await this.update_model(chat, execution);
        execution.roundId = round.id;
        execution.phase = "running";
        this.token_speed_snapshot =
          round.averageTokensPerSecond === null
            ? null
            : {
                roundId: round.id,
                tokensPerSecond: Number(
                  round.averageTokensPerSecond.toFixed(AGENT_TOKEN_SPEED_DECIMAL_PLACES),
                ),
              };
        const accepted = await chat.continue_round(execution, (state) => {
          const previous = state.rounds[round.id]!;
          previous.status = "running";
          previous.endedAt = null;
          previous.averageTokensPerSecond = null;
        });
        chat.log.begin_run(round.id, "continue");
        return () => this.drive(chat, run, accepted);
      }
    });
  }
  /** 完整轮次分叉共用输入命令幂等与运行租约。 */
  public async fork_round(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    this.assert_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    const roundId = request["roundId"];
    if (typeof roundId !== "string")
      throw agent_queue_validation_error("agent_revision_unavailable");
    const run = this.begin_run(read_input_command_id(request));
    return this.accept(run, () => chat.fork_round(roundId, read_input_command_id(request)));
  }

  /** 用户输入按轮次修订，助手回复仅限最新轮次末条。预检完成后才创建分支。 */
  public async revise_round(request: JsonRecord): Promise<AgentCommandAck> {
    const chat = await this.command_chat(request["chatId"] ?? this.chat_id);
    const commandId = read_input_command_id(request);
    // 直接调用与 HTTP 入口共用命令登记、失败结算和恢复事实。
    if (commandId === undefined)
      return this.input_command("revise", {
        ...request,
        chatId: request["chatId"] ?? this.chat_id,
        commandId: randomUUID(),
      });
    this.assert_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    const revision = normalize_agent_revision_request(request, this.resolve_file);
    if (revision === null) throw agent_queue_validation_error("agent_revision_unavailable");
    const entries = chat.entries;
    const index = entries.findIndex((entry) => entry.id === revision.entryId);
    const target = entries[index];
    // 日志记录目标所属轮次，历史修订不能误记为最新轮次。
    const round = entries.findLast(
      (entry, position) =>
        position <= index && entry.kind === "user_message" && entry.delivery === "round",
    );
    const valid =
      target?.kind === "user_message"
        ? target.delivery === "round" && target.status !== "running"
        : target?.kind === "assistant_message" &&
          target.status !== "running" &&
          revision.message.text !== "" &&
          revision.message.attachments.length === 0 &&
          !entries.some(
            (entry, position) =>
              position > index &&
              (entry.kind === "assistant_message" ||
                (entry.kind === "user_message" && entry.delivery === "round")),
          );
    if (!valid || target === undefined || round === undefined)
      throw agent_queue_validation_error("agent_revision_unavailable");
    const run = this.begin_run(read_input_command_id(request));
    const execution = run.execution;
    return this.accept(run, async () => {
      if (target.kind === "assistant_message") {
        chat.log.revise(round.id, "assistant", revision.message.text);
        await chat.revise_assistant(target, revision.message.text, read_input_command_id(request));
        return;
      }
      const resolved = await this.prepare_model(chat, execution);
      const prepared = await this.prepare_message(revision.message);
      this.assert_execution(execution);
      chat.log.revise(round.id, "user", revision.message.text);
      const conversation = await chat.fork_user_revision(
        target,
        resolved.model,
        resolved.thinkingLevel,
      );
      const accepted = await this.submit_round(chat, execution, revision.message, prepared, {
        conversation,
      });
      return () => this.drive(chat, run, accepted);
    });
  }
  /** 手动压缩返回受理回执，摘要结算由后台持有租约。 */
  public async compact_context(): Promise<AgentCommandAck> {
    const chat = await this.command_chat(this.chat_id);
    this.assert_queue_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    if (!chat.context.compactable)
      throw agent_queue_validation_error("agent_context_not_compactable");
    const run = this.begin_run();
    const execution = run.execution;
    return this.accept(run, async () => {
      await this.update_model(chat, execution);
      this.assert_execution(execution);
      return async () => {
        try {
          execution.phase = "compacting";
          const result = await chat.compact("manual", execution);
          if (result.status === "error") throw result.error;
          if (result.status === "running") throw new Error("Compaction summary did not settle");
        } catch (error) {
          if (
            !(error instanceof AgentCompactionError) &&
            !is_agent_cancellation(error, execution.controller.signal)
          )
            chat.log.report_failure("compaction", error);
        }
      };
    });
  }
  /** 工程提交保持原子边界，其余执行公开停止请求并等待 SDK 结算。 */
  public async stop(): Promise<AgentCommandAck> {
    this.assert_available();
    const chat = this.chat;
    const execution = this.execution;
    if (chat?.can_stop === false) throw new AppErrors.AppError("runtime.busy");
    if (execution === null || execution.cancellation !== undefined) return this.ack();
    this.cancel_execution(chat, execution, "user");
    return this.ack();
  }
  /** 停止接收命令，等对话交接与收尾完成后释放数据库入口。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe_skills();
    this.cancel_uploads();
    try {
      // 在途重置和重接各自由原请求报告失败，关闭仍须完成资源清理。
      await Promise.allSettled([this.resetting, this.recovering]);
      await this.close_chat("shutdown");
    } finally {
      if (this.record !== null) this.options.protectedChatIds.delete(this.record.id);
      await this.store.close();
    }
  }

  /** 一次运行持有工程租约，队列接续只替换轮次执行身份。 */
  private begin_run(commandId?: string): AgentRun {
    if (this.run !== null) throw new AppErrors.AppError("runtime.busy");
    const chat = this.require_chat();
    chat.assert_usable();
    const lease = this.runtime_gate.begin_runtime("agent");
    const run = {
      execution: chat.begin_execution(lease, commandId),
      settlement: null,
      interrupt: null,
    };
    this.run = run;
    this.exported_round_id = null;
    return run;
  }
  /** 命令在受理后返回，运行结算覆盖预检、后台执行和清理。 */
  private async accept(
    run: AgentRun,
    prepare: () => Promise<AgentWork | void>,
  ): Promise<AgentCommandAck> {
    const chat = this.require_chat();
    const execution = run.execution;
    const acceptance = prepare();
    execution.acceptance = acceptance;
    // 关闭入口从预检起就等待同一次结算，避免与预检失败同时清理会话。
    const settlement = acceptance.then(
      (work) => {
        execution.acceptance = null;
        return work === undefined ? this.finish_run(chat, run, []) : this.run_work(chat, run, work);
      },
      () => {
        execution.acceptance = null;
        return this.finish_run(chat, run, [], true);
      },
    );
    run.settlement = settlement;
    void settlement.catch(() => undefined); // 命令或后台运行负责报告对应阶段的故障。

    let work: AgentWork | void;
    try {
      work = await acceptance;
    } catch (error) {
      try {
        await settlement;
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Agent input preparation and cleanup failed", {
          cause: error,
        });
      }
      throw error;
    }
    if (work === undefined) await settlement;
    await chat.flush();
    chat.assert_usable();
    return this.ack();
  }
  /** 后台执行与取消共用收尾，清理故障由拥有者记录。 */
  private async run_work(chat: AgentChat, run: AgentRun, work: AgentWork): Promise<void> {
    const errors: unknown[] = [];
    try {
      await work();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.finish_run(chat, run, errors);
    } catch (error) {
      const cancellation = await run.execution.cancellation?.catch((cause: unknown) => cause);
      if (cancellation !== error) {
        chat.log.report_failure("cleanup", error);
        chat.log.flush();
      }
      throw error;
    }
  }
  /** 受理和后台执行共用退出边界，清理错误附加到首个故障，副作用退出后才释放租约。 */
  private async finish_run(
    chat: AgentChat,
    run: AgentRun,
    errors: unknown[],
    pause = errors.length > 0,
  ): Promise<void> {
    const execution = run.execution;
    try {
      await run.interrupt?.reservation.catch(() => undefined); // 等待占用事务退出，避免迟到提交。
      await execution.cancellation?.catch((error) => errors.push(error));
      try {
        if (!chat.sealed) {
          if (execution.controller.signal.aborted || pause) await this.pause_queue(chat);
          else await chat.flush();
        }
      } catch (error) {
        errors.push(error);
      }
      if (chat.sealed) await chat.close().catch((error) => errors.push(error));
    } finally {
      run.interrupt?.accepted.reject(errors[0] ?? new AppErrors.AppError("runtime.cancelled"));
      this.release(run);
    }
    const failures = [...new Set(errors)];
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Agent execution and cleanup failed", {
        cause: failures[0],
      });
  }

  /** 首条输入受理后返回调度循环，由运行拥有者负责启动。 */
  private async prepare_run(
    chat: AgentChat,
    run: AgentRun,
    message: AgentMessageInput,
    options?: AgentSubmitOptions,
  ): Promise<AgentWork> {
    const accepted = await this.prepare_round(chat, run.execution, message, options);
    return () => this.drive(chat, run, accepted);
  }

  /** 显式发送与队列接续共用附件、模型准备和 SDK 受理。 */
  private async prepare_round(
    chat: AgentChat,
    execution: AgentExecution,
    message: AgentMessageInput,
    options?: AgentSubmitOptions,
  ): ReturnType<AgentChat["submit"]> {
    await this.skills.refresh();
    const prepared = await this.prepare_message(message);
    this.assert_execution(execution);
    await this.update_model(chat, execution);
    return this.submit_round(chat, execution, message, prepared, options);
  }

  /** 显式发送、修订与 FIFO 共用轮次初始化，速度与恢复额度随新轮次重置。 */
  private async submit_round(
    chat: AgentChat,
    execution: AgentExecution,
    message: AgentMessageInput,
    prepared: PreparedAgentMessage,
    options: AgentSubmitOptions = {},
  ): ReturnType<AgentChat["submit"]> {
    execution.phase = "running";
    this.token_speed.reset();
    this.token_speed_updated_at = null;
    this.token_speed_snapshot = null;
    return chat.submit(message, prepared, execution, "round", options);
  }
  /** 结算当前轮次后才安排下一轮，连续失败只自动接续一次。 */
  private async drive(
    chat: AgentChat,
    run: AgentRun,
    initial: Awaited<ReturnType<AgentChat["submit"]>>,
  ): Promise<void> {
    let accepted = initial;
    let following_failure = false;
    for (;;) {
      const execution = run.execution;
      let status: AgentLogStatus = "success";
      let failure: unknown;
      try {
        await chat.run(accepted, execution);
        if (execution.controller.signal.aborted) status = "stopped";
      } catch (error) {
        status = is_agent_cancellation(error, execution.controller.signal) ? "stopped" : "error";
        if (status === "error") failure = error;
      }
      chat.log.finish_run(status, {
        ...(status === "stopped" && execution.stop_reason !== null
          ? { stop_reason: execution.stop_reason }
          : {}),
        ...(failure instanceof AgentCompactionError
          ? { failure: { operation: "compaction" as const, task_id: failure.task_id } }
          : failure === undefined
            ? {}
            : { error: failure }),
      });
      if (chat.sealed) return;
      await chat.finish_round(execution, status, this.token_speed.finish_round(performance.now()));
      this.token_speed_snapshot = null;

      const interrupt = run.interrupt;
      const selected = interrupt === null ? null : await interrupt.reservation.catch(() => null);
      await execution.cancellation;
      if (this.chat !== chat) return;
      if (selected === null && status === "error" && following_failure) {
        await this.pause_queue(chat);
        return;
      }
      const next =
        selected ??
        (!execution.controller.signal.aborted && chat.queue.has_items && !chat.queue.is_paused
          ? await chat.change_queue((queue) => queue.begin_next())
          : null);
      if (
        this.chat !== chat ||
        (execution.controller.signal.aborted && execution.stop_reason !== "queue_send")
      )
        return;
      // 自动接续队列时不产生中间提醒，只考虑本次运行的最后一轮。
      if (next === null) {
        if (status === "success" && execution.filesExported)
          this.exported_round_id = execution.roundId;
        return;
      }

      const following = chat.begin_execution(
        execution.lease,
        selected === null ? undefined : interrupt?.commandId,
      );
      run.execution = following;
      this.publish_snapshot();
      const acceptance = this.prepare_round(chat, following, next, { queuedId: next.id });
      following.acceptance = acceptance;
      try {
        accepted = await acceptance;
        if (selected !== null) {
          run.interrupt = null;
          interrupt?.accepted.resolve();
        }
      } catch (error) {
        if (is_agent_cancellation(error, following.controller.signal)) return;
        if (!chat.sealed) await this.pause_queue(chat);
        if (selected !== null) interrupt?.accepted.reject(error);
        else chat.log.report_failure("input_prepare", error);
        return;
      } finally {
        following.acceptance = null;
      }
      this.publish_snapshot();
      following_failure = selected === null && status === "error";
    }
  }

  /** 一次提交归还占用并暂停队列，保证重连读取同一份清理结果。 */
  private pause_queue(chat: AgentChat): Promise<void> {
    return chat.change_queue((queue) => {
      queue.cancel_send();
      queue.pause();
    });
  }
  /** 已存在的会话在配置前检查认证，失败保留原有历史。 */
  private async update_model(chat: AgentChat, execution: AgentExecution): Promise<void> {
    const resolved = await this.prepare_model(chat, execution);
    await chat.configure(resolved.model, resolved.thinkingLevel);
  }

  /** 预检只固定请求配置，调用者选择写入当前分支或候选分支。 */
  private async prepare_model(
    chat: AgentChat,
    execution: AgentExecution,
  ): Promise<ReturnType<typeof register_agent_model>> {
    const resolved = register_agent_model(
      chat.models,
      this.settings.read_setting(),
      { user_agent: this.user_agent },
      this.catalog,
      this.auth,
    );
    if (chat.state.seeded) {
      const available = await chat.models.getAvailable(resolved.model.provider);
      this.assert_execution(execution);
      if (!available.some((model) => model.id === resolved.model.id))
        throw new AppErrors.AppError("model.auth_required");
    }
    this.assert_execution(execution);
    this.model_config = resolved.model_config;
    return resolved;
  }
  /** 会话创建时绑定宿主能力，动态提示在真实请求准备完成后读取。 */
  private async create_chat(documentKey: string): Promise<AgentChat> {
    const resources = this.resources;
    const models = createModels();
    const log = new AgentRuntimeLog(this.log_manager, this.chat_id);
    const chat = await AgentChat.open({
      documentKey,
      storage: await this.store.open_storage(),
      readBatch: (read) => this.store.read_batch(read),
      cwd: this.workspace.root_path,
      models,
      seed: resources.chatSeed,
      tools: this.create_tools(),
      continueText: () => this.read_continue_text(),
      systemPrompt: () => {
        const override = this.settings.read_setting().agent_personality;
        return insert_agent_personality(
          resources.baseSystemPrompt,
          typeof override === "string" ? override : resources.defaultPersonality,
        );
      },
      workspacePrompt: AGENT_WORKSPACE_CONTRACT_PROMPT,
      skillsPrompt: () => format_agent_skills_for_system_prompt(this.skills.get_current()),
      log,
      onChange: () => this.publish_snapshot(),
      onModelEvent: (event) => this.observe_model(event),
      onClosing: (closing) => {
        if (this.chat === closing) this.decisions.reset();
      },
    });
    return chat;
  }
  /** 产品工具复用后端服务与当前租约，统一经过错误和参数边界。 */
  private create_tools() {
    return [
      create_agent_batch_llm_request_tool(async (input, signal) => {
        const execution = this.require_execution();
        if (execution.batchStopped)
          throw new AgentToolError({ code: "batch_task.stopped", stop_source: "user" });
        this.runtime_gate.assert_agent_runtime(execution.lease);
        signal.throwIfAborted();
        const config_snapshot = structuredClone(this.settings.read_setting());
        const model = resolve_agent_batch_model(
          config_snapshot,
          this.model_config!,
          input.model_usage,
          this.catalog.read(),
          input.thinking_downgrade === true,
        );
        try {
          const result = await this.batch_requests.run(
            execution.lease,
            signal,
            this.workspace.root_path,
            { model: model.to_json(), config_snapshot },
            input.request_file,
          );
          if (this.execution === execution && result.stop_source === "user")
            execution.batchStopped = true;
          return result;
        } catch (error) {
          if (
            error instanceof BatchRequestCompletionError &&
            this.execution === execution &&
            error.summary.stop_source === "user"
          )
            execution.batchStopped = true;
          throw error;
        }
      }),
      create_agent_batch_item_translation_tool(async (request, thinking_downgrade, signal) => {
        const execution = this.require_execution();
        // 用户停止后本轮不再启动翻译，明确拒绝以免把上次运行的事实当作本次结果。
        if (execution.batchStopped)
          throw new AgentToolError({ code: "batch_translation.stopped", stop_source: "user" });
        signal.throwIfAborted();
        this.runtime_gate.assert_agent_runtime(execution.lease);
        const model = resolve_agent_batch_model(
          this.settings.read_setting(),
          this.model_config!,
          "batch_translation",
          this.catalog.read(),
          thinking_downgrade,
        );
        try {
          const result = await this.batch_translation.run_under_agent(
            execution.lease,
            signal,
            model,
            request,
          );
          if (this.execution === execution && result.stop_source === "user")
            execution.batchStopped = true;
          return result;
        } catch (error) {
          if (
            error instanceof BatchTaskCompletionError &&
            this.execution === execution &&
            error.result.stop_source === "user"
          )
            execution.batchStopped = true;
          throw error;
        }
      }),
      create_agent_ask_user_tool({
        wait_for_answer: (id, question, signal) =>
          this.decisions.wait_for_question(id, question, signal),
      }),
      create_agent_workspace_run_tool({
        run: async ({ script, timeoutMs, callId }, signal) => {
          const execution = this.require_execution();
          const entry_id = this.require_chat().view.tool_entry_id(callId)!; // 工具入口已等待投影完成
          try {
            return await this.workspace.run(
              {
                script,
                timeoutMs,
                search: create_search_port(this.settings.read_setting()),
                doing: async (text) => {
                  signal.throwIfAborted();
                  this.assert_execution(execution);
                  await this.require_chat().change((state) => {
                    signal.throwIfAborted();
                    this.assert_execution(execution);
                    state.doing = text;
                  });
                },
                output: (tail) => {
                  if (
                    this.execution !== execution ||
                    execution.controller.signal.aborted ||
                    signal.aborted
                  )
                    return;
                  this.run_output = Object.freeze({ entryId: entry_id, ...tail });
                  this.publish_snapshot();
                },
                onFilesGenerated: () => {
                  execution.filesExported = true;
                },
              },
              signal,
            );
          } finally {
            // `sequential` 让整轮工具串行，观察又在 run 返回前停止，此时的运行输出只属于本次调用。
            this.run_output = null;
            this.publish_snapshot();
          }
        },
        refresh_skills: () => this.skills.refresh(),
      }),
      create_agent_workspace_apply_tool({
        workspace: this.workspace,
        approval: this.workspace_approval_port(),
      }),
      create_agent_read_skill_tool(() => this.skills.get_current()),
    ];
  }
  /** 每个可见增量参与速度统计，公开速度按时间窗口合并。 */
  private observe_model(event: AssistantMessageEvent): void {
    const execution = this.execution;
    if (execution === null || execution.controller.signal.aborted || execution.roundId === null)
      return;
    if (
      event.type === "text_delta" ||
      event.type === "thinking_delta" ||
      event.type === "toolcall_delta"
    ) {
      const content = event.partial.content[event.contentIndex];
      if (event.delta !== "" && !(content?.type === "thinking" && content.redacted))
        this.token_speed.record(event.delta, event.contentIndex, performance.now());
      const now = performance.now();
      if (
        this.token_speed_updated_at === null ||
        now - this.token_speed_updated_at >= AGENT_TOKEN_SPEED_PUBLISH_INTERVAL_MS
      ) {
        this.token_speed_updated_at = now;
        const speed = this.token_speed.measure(now);
        if (speed !== null)
          this.token_speed_snapshot = {
            roundId: execution.roundId,
            tokensPerSecond: Number(speed.toFixed(AGENT_TOKEN_SPEED_DECIMAL_PLACES)),
          };
        this.publish_snapshot();
      }
    } else if (event.type === "done" || event.type === "error") {
      const message = event.type === "done" ? event.message : event.error;
      this.token_speed.finish_response(performance.now(), message.usage.output);
      this.token_speed_updated_at = null;
    }
  }
  /** 投影直接提供条目变化。这里只比较会话控制字段。 */
  private publish_snapshot(force = false): void {
    if (this.disposed || this.chat === null) return;
    const fields = this.read_fields();
    const previous = this.publishedFields;
    const timeline = this.chat?.view.take_change();
    if (force || previous === null || previous.chatId !== fields.chatId || timeline?.replace) {
      this.revision++;
      this.publish(AGENT_CHAT_EVENT_TOPIC, {
        type: "snapshot_seed",
        revision: this.revision,
        snapshot: { ...fields, revision: this.revision, entries: this.chat?.entries ?? [] },
      });
    } else {
      const changes: AgentChatChange[] = [];
      if (!isDeepStrictEqual(fields.tokenSpeed, previous.tokenSpeed))
        changes.push({ type: "token_speed", tokenSpeed: fields.tokenSpeed });
      if (!isDeepStrictEqual(fields.runOutput, previous.runOutput))
        changes.push({ type: "run_output", runOutput: fields.runOutput });
      if (fields.exportedRoundId !== previous.exportedRoundId)
        changes.push({ type: "exported_round", exportedRoundId: fields.exportedRoundId });
      for (const entry of timeline?.entries ?? []) changes.push({ type: "entry_upsert", entry });
      if (fields.state !== previous.state)
        changes.push({ type: "chat_status", state: fields.state });
      if (!isDeepStrictEqual(fields.pendingDecision, previous.pendingDecision))
        changes.push({ type: "pending_decision", pendingDecision: fields.pendingDecision });
      if (!isDeepStrictEqual(fields.inputQueue, previous.inputQueue))
        changes.push({ type: "input_queue", inputQueue: fields.inputQueue });
      if (fields.doing !== previous.doing) changes.push({ type: "doing", doing: fields.doing });
      if (!isDeepStrictEqual(fields.context, previous.context))
        changes.push({ type: "context", context: fields.context });
      if (!isDeepStrictEqual(fields.usage, previous.usage))
        changes.push({ type: "usage", usage: fields.usage });
      if (!isDeepStrictEqual(fields.skills, previous.skills))
        changes.push({ type: "skills_changed", skills: fields.skills });
      if (changes.length > 0) {
        this.revision++;
        this.publish(AGENT_CHAT_EVENT_TOPIC, {
          type: "chat_update",
          revision: this.revision,
          changes,
        });
      }
    }
    this.publishedFields = fields;
  }
  /** 回执指向已发布的最新修订，前端以事件更新会话事实。 */
  private ack(): AgentCommandAck {
    this.publish_snapshot();
    return { revision: this.revision };
  }
  /** 只有可停止的产品轮次接受插队，空闲时发送仍受全局租约约束。 */
  private can_send_now(): boolean {
    const chat = this.chat;
    if (chat === null || chat.sealed || this.decisions.has_pending) return false;
    const run = this.run;
    if (run === null) return true;
    const execution = run.execution;
    return (
      chat.can_stop &&
      run.interrupt === null &&
      execution.roundId !== null &&
      execution.acceptance === null &&
      !execution.controller.signal.aborted &&
      execution.phase !== "preparing" &&
      execution.phase !== "settling"
    );
  }
  /** 只有当前调度循环可以释放租约，迟到的清理不能影响下一次运行。 */
  private release(run: AgentRun): void {
    if (this.run !== run) return;
    this.run = null;
    if (this.chat?.execution === run.execution) this.chat.execution = null;
    this.runtime_gate.finish_runtime(run.execution.lease);
    this.publish_snapshot();
  }
  /** SDK 封闭后只重接当前会话，旧命令身份在等待前后均须有效。 */
  private async command_chat(chatId: unknown): Promise<AgentChat> {
    this.assert_chat_identity(chatId);
    if (this.chat === null || this.chat.sealed) {
      this.recovering ??= this.reopen_chat().finally(() => {
        this.recovering = null;
      });
      await this.recovering;
    }
    this.assert_chat_identity(chatId);
    const chat = this.require_chat();
    chat.assert_usable();
    return chat;
  }

  /** 重接沿用已登记的文档键，工作区保持当前对话的身份。 */
  private async reopen_chat(): Promise<void> {
    await this.run?.settlement?.catch(() => {}); // 本轮故障已由执行结算记录。
    await this.chat?.close();
    this.assert_not_disposed();
    const record = this.record!;
    this.chat = await this.create_chat(record.data.documentKey ?? record.id);
    this.publish_snapshot(true);
  }

  /** 关闭保存事实并释放资源。目录删除只由显式重置和数量清理负责。 */
  private async close_chat(reason: AgentStopReason): Promise<void> {
    const chat = this.chat;
    const run = this.run;
    const execution = run?.execution;
    if (execution !== undefined) this.cancel_execution(chat, execution, reason);
    this.chat = null;
    this.workspace.cancel_uploads();
    this.workspace.invalidate_links();
    this.decisions.reset();
    this.token_speed.reset();
    this.token_speed_snapshot = null;
    this.run_output = null;
    this.exported_round_id = null;
    try {
      await run?.settlement;
    } finally {
      try {
        await chat?.close();
      } finally {
        await this.workspace.close();
      }
    }
  }

  /** 异步准备结束后复核执行身份与取消状态，阻断迟到写入。 */
  private assert_execution(execution: AgentExecution): void {
    if (this.execution !== execution || execution.controller.signal.aborted)
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "agent_message_invalidated" },
      });
    this.assert_not_disposed();
  }
  /** 工具只能使用当前有效执行持有的租约。 */
  private require_execution(): AgentExecution {
    const execution = this.execution;
    if (execution === null) throw new AppErrors.AppError("runtime.internal_invariant");
    this.assert_execution(execution);
    return execution;
  }
  /** SDK 会话未就绪时拒绝需要历史的命令。 */
  private require_chat(): AgentChat {
    if (this.chat === null) throw new AppErrors.AppError("request.validation_failed");
    return this.chat;
  }
  /** 统一解析用户消息与附件引用，非法输入在入队前拒绝。 */
  private read_message(value: unknown): AgentMessageInput {
    const message = normalize_agent_message_input(value, this.resolve_file);
    if (message === null) throw new AppErrors.AppError("request.validation_failed");
    return message;
  }
  /** 关闭后的命令统一返回生命周期错误。 */
  private assert_not_disposed(): void {
    if (this.disposed) throw new AppErrors.AppError("runtime.disposed");
  }
  /** 会话清理期间阻止命令进入即将失效的状态。 */
  private assert_available(): void {
    this.assert_not_disposed();
    if (this.resetting !== null) throw new AppErrors.AppError("runtime.busy");
  }
  /** 等待用户决定时暂停队列命令，保留当前审批上下文。 */
  private assert_queue_available(): void {
    this.assert_available();
    if (this.decisions.has_pending) throw new AppErrors.AppError("runtime.busy");
  }
  /** 所有停止入口固定首次来源，并等待同一次 SDK 取消。 */
  private cancel_execution(
    chat: AgentChat | null,
    execution: AgentExecution,
    reason: AgentStopReason,
  ): void {
    if (execution.stop_reason !== null) return;
    execution.stop_reason = reason;
    chat?.log.request_stop(reason);
    this.token_speed.finish_round(performance.now());
    this.token_speed_snapshot = null;
    execution.controller.abort();
    this.decisions.reset();
    if (chat !== null) {
      execution.cancellation = chat.stop();
      void execution.cancellation.catch((error) => {
        chat.log.report_failure("cleanup", error);
        chat.log.flush();
      });
    }
    this.publish_snapshot();
  }
  /** 隐藏继续消息采用当前应用语言。 */
  private read_continue_text(): string {
    return format_i18n_message(
      resolve_app_locale(this.settings.read_setting()["app_language"]),
      "agent_runtime.message.continue",
    );
  }
  /** 每批读取审批偏好，拒绝决定作为安全工具错误交回模型。 */
  private workspace_approval_port(): AgentWorkspaceApprovalPort {
    return {
      read_mode: () =>
        normalize_agent_approval_mode(this.settings.read_setting()["agent_approval_mode"]),
      wait_for_decision: async (id, summary, signal) => {
        if ((await this.decisions.wait_for_write_approval(id, summary, signal)) === "reject")
          throw new AgentToolError({ code: "approval_denied", action: "await_user" });
      },
    };
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

/** 空 continue 不制造消息。携带 message 时仍复用完整用户消息边界。 */
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

/** 仅公开输入入口加入命令身份，内部 FIFO 和恢复输入直接使用 SDK 尝试身份。 */
function read_input_command_id(request: JsonRecord): string | undefined {
  return typeof request["commandId"] === "string" ? request["commandId"] : undefined;
}
