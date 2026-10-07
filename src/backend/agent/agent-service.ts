import { randomUUID } from "node:crypto";
import type { ProjectDatabase } from "../database/database-operations";
import type { AgentChatStorage } from "../database/agent-chat-storage";
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
import { BatchTranslationCompletionError } from "../batch-translation/batch-translation-runtime";
import type { Model } from "../../domain/model";
import { create_agent_batch_item_translation_tool } from "./tools/run-batch-item-translation";
import { type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { isDeepStrictEqual } from "node:util";
import { AgentChat, AgentCompactionError, type AgentExecution } from "./agent-chat";

import { resolve_app_locale } from "../../domain/app-language";
import { is_json_record, type JsonRecord } from "../../domain/json";
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
  type AgentMessageInput,
  type AgentChatChange,
  type AgentChatSnapshot,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import { format_i18n_message } from "../../shared/i18n";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { LogManager } from "../log/log-manager";
import type { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { AgentDecisionCoordinator } from "./agent-decision";
import { register_agent_model, resolve_agent_batch_translation_model } from "./agent-model";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import type { PiModelCatalogReader } from "../llm/pi-model-catalog";
import { load_agent_chat_seed, type AgentChatSeed } from "./agent-chat-seed";
import { create_agent_read_skill_tool } from "./tools/read-skill";
import { create_agent_ask_user_tool } from "./tools/ask-user";
import { AgentInputQueue } from "./agent-input-queue";
import { create_agent_web_search_tool, type AgentWebSearchPort } from "./tools/web-search";
import type { AgentWorkspacePort } from "./workspace/service";
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

type AgentServicePaths = Pick<
  AppPathService,
  | "get_app_root"
  | "get_agent_builtin_skill_dir"
  | "get_agent_user_skill_dir"
  | "get_agent_system_prompt_path"
  | "get_agent_chat_seed_path"
>;

type AgentServiceOptions = {
  database: Pick<ProjectDatabase, "open_agent_store">;
  auth?: ChatGPTAuthService;
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
  logManager: Pick<LogManager, "append">;
  publish: (topic: string, payload: JsonRecord) => void;
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
>;

/** 启动时加载的基础提示词和会话种子。 */
type LoadedAgentResources = Readonly<{
  baseSystemPrompt: string;
  defaultPersonality: string;
  chatSeed: AgentChatSeed;
}>;

/** 产品命令协调唯一会话与运行租约。历史和公开条目来自 durable 提交。 */
export class AgentService {
  private readonly auth: ChatGPTAuthService | undefined;
  private readonly catalog: PiModelCatalogReader;
  private readonly batch_translation: AgentServiceOptions["batchTranslation"];
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly skills: AgentServiceOptions["skills"];
  private readonly user_agent: string;
  private readonly session_state: ProjectSessionState;
  private readonly runtime_gate: RuntimeOperationGate;
  private readonly web_search: AgentWebSearchPort | undefined;
  private readonly workspace: AgentWorkspacePort;
  private readonly images: AgentServiceOptions["images"];
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_skills: () => void;
  private readonly unsubscribe_project_session: () => void;
  private readonly decisions: AgentDecisionCoordinator;
  private readonly token_speed = new AgentTokenSpeed();
  private token_speed_snapshot: AgentTokenSpeedSnapshot = null;
  private token_speed_updated_at: number | null = null;
  private chat_id = "inactive"; // 无工程时的快照身份，激活后采用持久化身份
  private readonly database: AgentServiceOptions["database"];
  private store: AgentChatStorage | null = null; // 工程连接的使用权覆盖 SDK 与上传收尾
  private chat: AgentChat | null = null;
  private model_config: Model | null = null; // 当前主模型配置供批量翻译跟随解析
  private execution: AgentExecution | null = null; // 唯一活动执行，旧会话收尾依原执行身份释放租约
  private readonly input_commands = new Map<
    string,
    { kind: AgentInputCommandKind; request: JsonRecord; work: Promise<AgentInputCommandAck> }
  >(); // 同一命令的并发回包共用受理过程
  private chat_reset: Promise<void> | null = null; // 关闭与重置共用串行屏障，资源切换等待旧会话收尾
  private resources: LoadedAgentResources | null = null;
  private revision = 0;
  private disposed = false;
  private publishedFields: AgentChatFields | null = null; // 上一批已发布的控制字段，用于抑制重复通知

  /** 连接工程生命周期、技能变更与决定协调器，会话事实统一提交后发布。 */
  public constructor(options: AgentServiceOptions) {
    this.database = options.database;
    this.auth = options.auth;
    this.catalog = options.catalog;
    this.batch_translation = options.batchTranslation;
    this.paths = options.paths;
    this.settings = options.settings;
    this.skills = options.skills;
    this.unsubscribe_skills = this.skills.subscribe(() => {
      if (!this.disposed && this.resources !== null && this.chat_reset === null) {
        this.publish_snapshot();
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
    // 决定随当前工具等待存活，直接发布协调器事实，重开时由 SDK 取消遗留任务。
    this.decisions = new AgentDecisionCoordinator(() => this.publish_snapshot());
    this.unsubscribe_project_session = this.session_state.subscribe_change((change) =>
      this.activate_project(change.loaded ? change.projectPath : null),
    );
  }

  /** 会话清理期间拒绝激活工作区链接。 */
  public async activate_workspace_path(request: JsonRecord): Promise<AgentWorkspaceLinkResult> {
    this.assert_not_disposed();
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
    return this.workspace.activate_path(is_json_record(request) ? request["path"] : undefined);
  }

  /** 文件描述绑定当前会话，菜单无法复用旧会话的同名工作文件。 */
  public describe_workspace_file(request: JsonRecord): AgentFile {
    this.assert_workspace_preview_chat(request["chatId"]);
    return this.workspace.describe_file(request["path"]);
  }

  /** 请求和响应都绑定对话身份，防止旧页面读取重建后的同名文件。 */
  public async read_workspace_document(request: JsonRecord): Promise<AgentDocument> {
    this.assert_workspace_preview_chat(request["chatId"]);
    const document = await this.workspace.read_document(request["path"]);
    this.assert_workspace_preview_chat(request["chatId"]);
    return { chatId: this.chat_id, ...document };
  }

  /** 配图与正文共用会话边界，旧会话的图片响应同样失效。 */
  public async read_workspace_image(
    href: string | null,
    chat_id: string | null,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    this.assert_workspace_preview_chat(chat_id);
    const image = await this.workspace.read_document_image(href);
    this.assert_workspace_preview_chat(chat_id);
    return image;
  }

  /** 清理期间拒绝读取，清理后按对话身份拒绝迟到请求。 */
  private assert_workspace_preview_chat(chat_id: unknown): void {
    this.assert_not_disposed();
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
    if (chat_id !== this.chat_id) throw new AppErrors.AppError("file.not_found");
  }

  /** 上传不占用模型或脚本互斥，文件身份仍属于当前工程会话。 */
  public async upload_file(
    name: string,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<AgentFileAttachment> {
    this.assert_not_disposed();
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
    this.session_state.require_loaded_project_path();
    return this.workspace.uploads.upload(name, body, signal);
  }

  /** Gateway 关闭前取消请求体读取，让在途上传及时退出。 */
  public cancel_uploads(): void {
    this.workspace.cancel_uploads();
  }

  /** 文件下载遵守会话关闭屏障，存储层拥有定位与流的创建。 */
  public read_upload(id: string): ReturnType<AgentWorkspacePort["uploads"]["open"]> {
    this.assert_not_disposed();
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
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
  public list_files(): AgentFilesResponse {
    this.assert_not_disposed();
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
    return { chatId: this.chat_id, files: this.workspace.list_files() };
  }

  /** 完整快照和技能事件共用公开投影，隐藏技能仍可供模型读取。 */
  private get_skill_snapshot(): AgentChatSnapshot["skills"] {
    return this.skills
      .get_current()
      .filter(({ visible }) => visible)
      .map(({ name, displayDescriptions }) => ({
        name,
        displayDescriptions: { ...displayDescriptions },
      }));
  }

  /** 快照由相同的提交事实投影，调用者只能取得独立值。 */
  public get_snapshot(): AgentChatSnapshot {
    return {
      ...this.read_fields(),
      revision: this.revision,
      entries: structuredClone(this.chat?.entries ?? []),
    };
  }
  /** 读取会话控制字段，用于事件比较和完整快照组装。 */
  private read_fields(): AgentChatFields {
    const chat = this.chat;
    const execution = this.execution;
    const state =
      execution === null || chat === null
        ? "idle"
        : execution.controller.signal.aborted
          ? "stopping"
          : "running";
    return {
      chatId: this.chat_id,
      state,
      pendingDecision: this.decisions.read_pending(),
      skills: this.get_skill_snapshot(),
      inputQueue: (chat?.queue ?? new AgentInputQueue()).read_snapshot(this.can_send_now()),
      doing: chat?.state.doing ?? null,
      context: structuredClone(chat?.context ?? { tokens: null, compactable: false, limits: null }),
      usage: { ...(chat?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) },
      tokenSpeed: structuredClone(this.token_speed_snapshot),
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

  /** 启动期加载必需基础资源，并通过技能服务准备空白对话的候选。 */
  public async load_resources(): Promise<void> {
    const base_system_prompt = load_agent_system_prompt(this.paths);
    const default_personality = load_agent_personality(this.paths);
    const chat_seed = load_agent_chat_seed(this.paths);
    await this.skills.refresh();
    this.resources = {
      baseSystemPrompt: base_system_prompt,
      defaultPersonality: default_personality,
      chatSeed: chat_seed,
    };
    this.publishedFields = this.read_fields();
    const project = this.session_state.snapshot();
    if (project.loaded) await this.activate_project(project.projectPath);
  }

  /** 所有公开输入命令先按产品身份去重，再进入原有租约与队列规则。 */
  public input_command(
    kind: AgentInputCommandKind,
    request: JsonRecord,
  ): Promise<AgentInputCommandAck> {
    this.assert_not_disposed();
    const chat = this.require_chat();
    const { chatId, commandId, ...body } = request;
    if (
      chatId !== this.chat_id ||
      typeof commandId !== "string" ||
      commandId.length === 0 ||
      commandId.length > AGENT_INPUT_COMMAND_ID_LIMIT
    )
      throw agent_queue_validation_error("agent_input_command_invalid");
    const saved = chat.state.commands[commandId];
    const key = `${this.chat_id}:${commandId}`;
    const running = this.input_commands.get(key);
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
    this.input_commands.set(key, { kind, request: requestBody, work });
    void work
      .finally(() => {
        if (this.input_commands.get(key)?.work === work) this.input_commands.delete(key);
      })
      .catch(() => undefined); // 原始 Promise 将受理错误返回命令调用方。
    return work;
  }

  /** 重连只查询受理结果，不产生新的输入或模型请求。 */
  public input_command_status(request: JsonRecord): AgentInputCommandAck {
    this.assert_not_disposed();
    if (request["chatId"] !== this.chat_id || typeof request["commandId"] !== "string")
      throw agent_queue_validation_error("agent_input_command_invalid");
    return {
      ...this.ack(),
      status: this.require_chat().state.commands[request["commandId"]]?.status ?? "unknown",
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
        conversationId: null,
        requestId: null,
      };
    });
    try {
      if (this.chat !== chat) throw new AppErrors.AppError("runtime.cancelled");
      const request = { ...body, commandId };
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
          await this.revise_latest_round(request);
          break;
        case "continue":
          await this.continue_chat(request);
          break;
      }
    } catch (error) {
      await chat.settle_input_command(commandId).catch((failure) => {
        chat.log.report_failure("cleanup", failure);
        chat.log.flush();
      });
      throw error;
    }
    await chat.settle_input_command(commandId);
    return { ...this.ack(), status: chat.state.commands[commandId]!.status };
  }

  /** 运行中入队，空闲时占用租约并完成模型与附件预检。 */
  public async send_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    this.session_state.require_loaded_project_path();
    const message = this.read_message(request);
    if (
      this.execution !== null &&
      this.execution.phase !== "preparing" &&
      this.read_fields().state === "running"
    ) {
      await this.require_chat().change_queue(
        (queue) => queue.enqueue(message),
        read_input_command_id(request),
      );
      return this.ack();
    }
    if (this.chat?.queue.is_paused) throw agent_queue_validation_error("agent_continue_required");
    this.require_resources();
    const execution = this.begin_execution(read_input_command_id(request));
    return this.accept(execution, () => this.accept_round(execution, message));
  }
  /** 编辑只作用于尚未发送的草稿，附件身份在服务边界解析。 */
  public async update_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    const { id, message } = read_queue_message_request(request, this.resolve_file);
    await this.require_chat().change_queue((queue) => queue.update(id, message));
    return this.ack();
  }
  /** 删除草稿经队列事务校验发送状态并同步暂停态。 */
  public async delete_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    await this.require_chat().change_queue((queue) => queue.delete(read_queue_id(request)));
    return this.ack();
  }
  /** 重排校验完整身份排列，`sending` 项仍属于队列。 */
  public async reorder_queued_messages(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    const ids = request["ids"];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      throw agent_queue_validation_error("agent_input_queue_invalid_order");
    await this.require_chat().change_queue((queue) => queue.reorder(ids as string[]));
    return this.ack();
  }
  /** 运行中按 `steer` 受理选中草稿，准备失败时恢复发送占用。 */
  public async send_queued_message(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    this.session_state.require_loaded_project_path();
    const chat = this.require_chat();
    const id = read_queue_id(request);
    const item = chat.queue.read(id);
    if (this.execution !== null) {
      const execution = this.execution;
      if (!chat.can_steer || execution.acceptance !== null)
        throw new AppErrors.AppError("runtime.busy");
      await chat.change_queue((queue) => queue.begin_send(id));
      return this.accept(
        execution,
        async () => {
          try {
            const prepared = await this.prepare_message(item);
            this.assert_execution(execution);
            if (!chat.can_steer) {
              await chat.change_queue((queue) => queue.cancel_send());
              return;
            }
            await chat.submit(
              item,
              prepared,
              execution,
              "steer",
              id,
              read_input_command_id(request),
            );
          } catch (error) {
            await chat.change_queue((queue) => queue.cancel_send());
            throw error;
          }
        },
        false,
      );
    }
    const execution = this.begin_execution(read_input_command_id(request));
    return this.accept(execution, () => this.accept_round(execution, item, id));
  }
  /** 失败轮次以隐藏输入续跑，暂停草稿在同一租约内恢复 FIFO。 */
  public async continue_chat(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_queue_available();
    this.session_state.require_loaded_project_path();
    const chat = this.require_chat();
    const round = chat.entries.findLast(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
    const failed =
      round?.kind === "user_message" && round.delivery === "round" && round.status === "error";
    const message = read_agent_continue_message(request, this.resolve_file);
    if (!chat.queue.has_items && !failed)
      throw agent_queue_validation_error("agent_continue_unavailable");
    if (message !== null && !chat.queue.has_items)
      throw agent_queue_validation_error("agent_continue_message_without_queue");
    const execution = this.begin_execution(read_input_command_id(request));
    return this.accept(execution, async () => {
      await chat.change_queue((queue) => {
        if (message !== null) queue.enqueue(message);
        queue.resume();
      }, read_input_command_id(request));
      if (failed) {
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
        await chat.change((state) => {
          const previous = state.rounds[round.id]!;
          previous.status = "running";
          previous.endedAt = null;
          previous.averageTokensPerSecond = null;
        });
        const text = this.read_continue_text();
        const accepted = await chat.submit(
          { text, attachments: [] },
          { text, images: [] },
          execution,
          "hidden",
        );
        chat.log.begin_run(round.id, "continue");
        this.launch(chat, execution, () => this.drive(chat, execution, accepted));
      } else {
        const next = chat.queue.read_next();
        if (next === null) throw agent_queue_validation_error("agent_continue_unavailable");
        await this.accept_round(execution, next, next.id);
      }
    });
  }
  /** 完整轮次分叉共用输入命令幂等与运行租约。 */
  public async fork_round(request: JsonRecord): Promise<AgentCommandAck> {
    this.assert_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    const chat = this.require_chat();
    const roundId = request["roundId"];
    if (typeof roundId !== "string")
      throw agent_queue_validation_error("agent_revision_unavailable");
    const execution = this.begin_execution(read_input_command_id(request));
    return this.accept(execution, async () => {
      await chat.fork_round(roundId, read_input_command_id(request));
      this.release(execution);
    });
  }

  /** 限制最新轮次的可修订目标，完成预检后才切换历史分支。 */
  public async revise_latest_round(request: JsonRecord): Promise<AgentCommandAck> {
    const commandId = read_input_command_id(request);
    // 直接调用与 HTTP 入口共用命令登记、失败结算和恢复事实。
    if (commandId === undefined)
      return this.input_command("revise", {
        ...request,
        chatId: this.chat_id,
        commandId: randomUUID(),
      });
    this.assert_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    const chat = this.require_chat();
    const revision = normalize_agent_revision_request(request, this.resolve_file);
    if (revision === null) throw agent_queue_validation_error("agent_revision_unavailable");
    const userIndex = chat.entries.findLastIndex(
      (entry) => entry.kind === "user_message" && entry.delivery === "round",
    );
    const user = chat.entries[userIndex];
    const output = chat.entries.findLast(
      (entry, index) => index > userIndex && entry.kind === "assistant_message",
    );
    const target =
      revision.entryId === user?.id ? user : revision.entryId === output?.id ? output : undefined;
    if (
      target === undefined ||
      target.status === "running" ||
      (target.kind === "assistant_message" &&
        (revision.message.text === "" || revision.message.attachments.length > 0))
    )
      throw agent_queue_validation_error("agent_revision_unavailable");
    this.session_state.require_loaded_project_path();
    const execution = this.begin_execution(read_input_command_id(request));
    return this.accept(execution, async () => {
      if (target.kind === "assistant_message") {
        chat.log.revise(user!.id, "assistant", revision.message.text);
        await chat.revise_assistant(target, revision.message.text, read_input_command_id(request));
        this.release(execution);
        return;
      }
      const resolved = await this.prepare_model(chat, execution);
      const prepared = await this.prepare_message(revision.message);
      this.assert_execution(execution);
      chat.log.revise(user!.id, "user", revision.message.text);
      execution.commandId = commandId;
      await chat.revise_user(target, resolved.model, resolved.thinkingLevel, commandId);
      const accepted = await this.submit_round(chat, execution, revision.message, prepared);
      this.launch(chat, execution, () => this.drive(chat, execution, accepted));
    });
  }
  /** 手动压缩先受理并发布运行态，摘要结算由后台持有租约。 */
  public async compact_context(): Promise<AgentCommandAck> {
    this.assert_queue_available();
    if (this.execution !== null) throw new AppErrors.AppError("runtime.busy");
    const chat = this.require_chat();
    if (!chat.context.compactable)
      throw agent_queue_validation_error("agent_context_not_compactable");
    this.session_state.require_loaded_project_path();
    const execution = this.begin_execution();
    return this.accept(execution, async () => {
      await this.update_model(chat, execution);
      this.assert_execution(execution);
      this.launch(chat, execution, async () => {
        try {
          await chat.compact("manual", execution);
        } catch (error) {
          if (
            !(error instanceof AgentCompactionError) &&
            !is_agent_cancellation(error, execution.controller.signal)
          )
            chat.log.report_failure("compaction", error);
        }
      });
      // 排在原生压缩受理之后的短提交，使命令回执包含 running 条目，无需等待摘要。
      await chat.change(() => {});
    });
  }
  /** 工程提交保持原子边界，其余执行公开停止请求并等待 SDK 结算。 */
  public async stop(): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    const chat = this.chat;
    const execution = this.execution;
    if (chat?.can_stop === false) throw new AppErrors.AppError("runtime.busy");
    if (execution === null || execution.cancellation !== undefined) return this.ack();
    const average = this.token_speed.finish_round(performance.now());
    this.token_speed_snapshot = null;
    this.cancel_execution(chat, execution, "user", average);
    return this.ack();
  }
  /** 空闲重置也占用 Agent 租约，防止清理与其他运行重叠。 */
  public async reset(): Promise<AgentCommandAck> {
    this.assert_not_disposed();
    const resetLease = this.execution === null ? this.runtime_gate.begin_runtime("agent") : null;
    try {
      const project = this.session_state.snapshot();
      if (project.loaded) {
        await this.transition(async () => {
          const id = this.store === null ? null : this.chat_id;
          this.chat?.log.reset("workspace");
          await this.close_chat("reset");
          const store = this.database.open_agent_store(project.projectPath);
          try {
            await store.reset();
          } finally {
            await store.close();
          }
          if (id !== null) await this.workspace.delete_chat(id);
          await this.open_project(project.projectPath);
        });
      } else {
        await this.skills.refresh();
      }
    } finally {
      if (resetLease !== null) this.runtime_gate.finish_runtime(resetLease);
    }
    return this.ack();
  }
  /** 先解除外部订阅，再等待当前清理与执行退出。 */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe_project_session();
    this.unsubscribe_skills();
    if (this.chat_reset !== null) await this.chat_reset;
    await this.transition(() => this.close_chat("shutdown"));
  }

  /** 每次运行只有一个控制器和租约，迟到操作依执行对象身份失效。 */
  private begin_execution(commandId?: string): AgentExecution {
    const lease = this.runtime_gate.begin_runtime("agent");
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
    if (this.chat !== null) this.chat.execution = execution;
    return execution;
  }
  /** 区分命令受理与后台结算，受理失败只释放尚未转交的租约。 */
  private async accept(
    execution: AgentExecution,
    operation: () => Promise<void>,
    releaseOnFailure = true,
  ): Promise<AgentCommandAck> {
    const acceptance = operation();
    execution.acceptance = acceptance;
    try {
      await acceptance;
      return this.ack();
    } catch (error) {
      if (releaseOnFailure && execution.settlement === null) {
        await this.chat?.change_queue((queue) => {
          queue.cancel_send();
          queue.pause();
        });
        await execution.cancellation;
        this.release(execution);
      }
      throw error;
    } finally {
      if (execution.acceptance === acceptance) execution.acceptance = null;
    }
  }
  /** 后台结算统一等待受理与取消收尾，保存终态后释放原执行的租约。 */
  private launch(chat: AgentChat, execution: AgentExecution, operation: () => Promise<void>): void {
    const settlement = (async () => {
      try {
        await operation();
      } finally {
        try {
          await execution.acceptance?.catch(() => undefined); // 受理失败由原命令回传，这里只等待退出。
          await execution.cancellation;
        } finally {
          try {
            await chat.flush();
          } finally {
            this.release(execution);
          }
        }
      }
    })();
    execution.settlement = settlement;
    void settlement.catch(async (error) => {
      // 取消 Promise 的拥有者已记录其失败，等待者只传播同一错误。
      if (execution.cancellation !== undefined) {
        try {
          await execution.cancellation;
        } catch (cause) {
          if (cause === error) return;
        }
      }
      chat.log.report_failure("cleanup", error);
      chat.log.flush();
    });
  }
  /** 附件与模型预检成功后才受理轮次，失败时保留待发送草稿。 */
  private async accept_round(
    execution: AgentExecution,
    message: AgentMessageInput,
    queuedId?: string,
  ): Promise<void> {
    if (queuedId !== undefined)
      await this.require_chat().change_queue((queue) => queue.begin_send(queuedId));
    this.require_resources();
    const chat = this.require_chat();
    await this.skills.refresh();
    const prepared = await this.prepare_message(message);
    this.assert_execution(execution);
    await this.update_model(chat, execution);
    const accepted = await this.submit_round(chat, execution, message, prepared, queuedId);
    this.launch(chat, execution, () => this.drive(chat, execution, accepted));
  }

  /** 显式发送、修订与 FIFO 共用轮次初始化，速度与恢复额度随新轮次重置。 */
  private async submit_round(
    chat: AgentChat,
    execution: AgentExecution,
    message: AgentMessageInput,
    prepared: PreparedAgentMessage,
    queuedId?: string,
  ): ReturnType<AgentChat["submit"]> {
    execution.phase = "running";
    execution.translationPaused = null;
    execution.recoveryUsed = false;
    this.token_speed.reset();
    this.token_speed_updated_at = null;
    this.token_speed_snapshot = null;
    return chat.submit(message, prepared, execution, "round", queuedId ?? null);
  }
  /** 串行结算轮次并续取 FIFO，失败暂停队列，后台结算统一收尾。 */
  private async drive(
    chat: AgentChat,
    execution: AgentExecution,
    initial: Awaited<ReturnType<AgentChat["submit"]>>,
  ): Promise<void> {
    let accepted = initial;
    for (;;) {
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
      if (execution.controller.signal.aborted) {
        // 真实故障先封口，取消清理只结算仍在运行的轮次。
        if (status === "error") await chat.finish_round(execution, status, null);
        break;
      }
      const success = status === "success";
      await chat.finish_round(
        execution,
        success ? "success" : "error",
        this.token_speed.finish_round(performance.now()),
      );
      this.token_speed_snapshot = null;
      await chat.cancel_inputs(execution);
      if (!success) {
        await chat.change_queue((queue) => queue.pause());
        break;
      }
      const next = chat.queue.read_next();
      if (next === null) break;
      execution.phase = "preparing";
      await chat.change_queue((queue) => queue.begin_send(next.id));
      try {
        await this.update_model(chat, execution);
        const prepared = await this.prepare_message(next);
        this.assert_execution(execution);
        accepted = await this.submit_round(chat, execution, next, prepared, next.id);
      } catch (error) {
        await chat.change_queue((queue) => {
          queue.cancel_send();
          queue.pause();
        });
        if (!is_agent_cancellation(error, execution.controller.signal))
          chat.log.report_failure("input_prepare", error);
        break;
      }
    }
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
  private async create_chat(store: AgentChatStorage): Promise<AgentChat> {
    const resources = this.require_resources();
    const models = createModels();
    const log = new AgentRuntimeLog(this.log_manager, this.chat_id);
    const chat = await AgentChat.open({
      chatId: this.chat_id,
      storage: await store.open_storage(),
      cwd: this.paths.get_app_root(),
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
      skillsPrompt: () => format_agent_skills_for_system_prompt(this.skills.get_current()),
      log,
      onChange: () => this.publish_snapshot(),
      onModelEvent: (event) => this.observe_model(event),
      onReport: (error) => {
        log.report_failure("cleanup", error);
        log.flush();
      },
    });
    return chat;
  }
  /** 产品工具复用后端服务与当前租约，统一经过错误和参数边界。 */
  private create_tools() {
    return [
      create_agent_batch_item_translation_tool(async (request, signal) => {
        const execution = this.require_execution();
        if (execution.translationPaused !== null) return execution.translationPaused;
        this.session_state.require_loaded_project_path();
        signal.throwIfAborted();
        this.runtime_gate.assert_current_runtime(execution.lease, "agent");
        const model = resolve_agent_batch_translation_model(
          this.settings.read_setting(),
          this.model_config!,
          this.catalog.read_models(),
        );
        try {
          const result = await this.batch_translation.run_under_agent(
            execution.lease,
            signal,
            model,
            request,
          );
          if (this.execution === execution && result.stop_source === "user")
            execution.translationPaused = result;
          return result;
        } catch (error) {
          if (error instanceof BatchTranslationCompletionError) {
            if (this.execution === execution && error.result.stop_source === "user")
              execution.translationPaused = error.result;
            throw new AgentToolError({ code: "tool_failed", ...error.result }, error, "fault");
          }
          throw error;
        }
      }),
      create_agent_ask_user_tool({
        wait_for_answer: (id, question, signal) =>
          this.decisions.wait_for_question(id, question, signal),
      }),
      create_agent_workspace_run_tool({
        run: (script, signal) => {
          const execution = this.require_execution();
          return this.workspace.run(script, signal, async (text) => {
            signal.throwIfAborted();
            this.assert_execution(execution);
            await this.require_chat().change((state) => {
              signal.throwIfAborted();
              this.assert_execution(execution);
              state.doing = text;
            });
          });
        },
        refresh_skills: () => this.skills.refresh(),
      }),
      create_agent_workspace_apply_tool({
        workspace: this.workspace,
        approval: this.workspace_approval_port(),
      }),
      create_agent_read_skill_tool(() => this.skills.get_current(), this.paths),
      ...(this.web_search === undefined ? [] : [create_agent_web_search_tool(this.web_search)]),
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
    if (this.disposed || (this.chat_reset !== null && !force)) return;
    const fields = this.read_fields();
    const previous = this.publishedFields;
    const timeline = this.chat?.view.take_change();
    if (force || previous === null || previous.chatId !== fields.chatId || timeline?.replace) {
      this.revision++;
      const snapshot = {
        ...fields,
        revision: this.revision,
        entries: structuredClone(this.chat?.entries ?? []),
      };
      this.publish(AGENT_CHAT_EVENT_TOPIC, {
        type: "snapshot_seed",
        revision: this.revision,
        snapshot,
      });
    } else {
      const changes: AgentChatChange[] = [];
      if (!isDeepStrictEqual(fields.tokenSpeed, previous.tokenSpeed))
        changes.push({ type: "token_speed", tokenSpeed: fields.tokenSpeed });
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
          changes: structuredClone(changes),
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
  /** 即时发送同时受用户决定、产品阶段与全局运行占用约束。 */
  private can_send_now(): boolean {
    return (
      !this.decisions.has_pending &&
      (this.execution === null
        ? this.runtime_gate.get_snapshot().owner === null
        : this.chat?.can_steer === true)
    );
  }
  /** 旧执行只释放自己的租约，当前身份匹配时才清空会话运行态。 */
  private release(execution: AgentExecution): void {
    if (this.execution === execution) {
      this.execution = null;
      if (this.chat?.execution === execution) this.chat.execution = null;
    }
    this.runtime_gate.finish_runtime(execution.lease);
    this.publish_snapshot();
  }
  /** 命令和工程生命周期共用关闭屏障。所有权切换只在旧使用者收尾后发生。 */
  private transition(operation: () => Promise<void>): Promise<void> {
    if (this.chat_reset !== null) return this.chat_reset.then(() => this.transition(operation));
    const pending = operation();
    this.chat_reset = pending;
    return pending.finally(() => {
      if (this.chat_reset === pending) this.chat_reset = null;
      this.publish_snapshot(true);
    });
  }

  /** 串行关闭旧工程执行，再恢复目标工程的持久化对话。 */
  private activate_project(project: string | null): Promise<void> {
    return this.transition(async () => {
      this.chat?.log.reset("project");
      await this.close_chat("project_change");
      if (project !== null) await this.open_project(project);
    });
  }

  /** 产品身份与上传先于模型请求可用，首次打开空工程也不需要模型配置。 */
  private async open_project(project: string): Promise<void> {
    this.require_resources();
    const store = this.database.open_agent_store(project);
    this.store = store;
    try {
      const record =
        (await store.read()) ?? (await store.create(await this.workspace.create_chat()));
      this.chat_id = record.id;
      await this.workspace.activate_chat(record.id, record.data.uploads, (file) =>
        store.save_upload(record.id, file),
      );
      this.chat = await this.create_chat(store);
    } catch (error) {
      await this.close_chat("project_change");
      throw error;
    }
  }

  /** 关闭保存事实并释放资源。目录删除只由显式重置和数量清理负责。 */
  private async close_chat(reason: AgentStopReason): Promise<void> {
    const chat = this.chat;
    const execution = this.execution;
    const store = this.store;
    if (execution !== null) this.cancel_execution(chat, execution, reason, null);
    this.chat = null;
    this.images.clear();
    this.workspace.cancel_uploads();
    this.workspace.invalidate_links();
    this.decisions.reset();
    this.token_speed.reset();
    this.token_speed_snapshot = null;
    try {
      try {
        await execution?.acceptance?.catch(() => undefined); // 受理失败由命令报告，关闭继续收尾。
        await execution?.cancellation;
        await execution?.settlement;
      } finally {
        try {
          await this.workspace.close();
        } finally {
          await chat?.close();
        }
      }
    } finally {
      if (execution !== null) this.release(execution);
      this.store = null;
      this.chat_id = "inactive";
      await store?.close();
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
  /** 需要历史的命令在空白会话中按请求错误拒绝。 */
  private require_chat(): AgentChat {
    if (this.chat === null) throw new AppErrors.AppError("request.validation_failed");
    return this.chat;
  }
  /** 启动资源属于组合根前置条件，缺失表示内部生命周期错误。 */
  private require_resources(): LoadedAgentResources {
    if (this.resources === null) throw new AppErrors.AppError("runtime.internal_invariant");
    return this.resources;
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
    if (this.chat_reset !== null) throw new AppErrors.AppError("runtime.busy");
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
    average: number | null,
  ): void {
    if (execution.stop_reason !== null) return;
    execution.stop_reason = reason;
    chat?.log.request_stop(reason);
    execution.controller.abort();
    this.decisions.reset();
    if (chat !== null) {
      execution.cancellation = chat.stop(execution, average);
      void execution.cancellation.catch((error) => {
        chat.log.report_failure("cleanup", error);
        chat.log.flush();
      });
    }
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
