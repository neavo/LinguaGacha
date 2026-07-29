import { Agent, uuidv7, type AgentEvent } from "@earendil-works/pi-agent-core";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import {
  AGENT_SESSION_EVENT_TOPIC,
  type AgentMessageSnapshot,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
  type AgentToolStatus,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import type { ProjectChangeEvent } from "../../shared/project-event";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { LogManager } from "../log/log-manager";
import type { ProjectSessionState } from "../project/project-session-state";
import type { QualityRuleService } from "../quality/quality-rule-service";
import { create_agent_corpus_tools } from "./agent-corpus-tools";
import { create_agent_glossary_tools } from "./agent-glossary-tools";
import { resolve_agent_model } from "./agent-model";
import { create_skill_reference_tools } from "./agent-skill-reference-tools";
import { load_agent_skills, type AgentSkillDefinition } from "./agent-skills";

const BASE_SYSTEM_PROMPT = `
你是 LinguaGacha 内置 Agent，只能使用提供的领域工具处理当前工程。不得访问文件系统、Shell 或其它外部能力。
始终用用户当前使用的语言回复。读操作可以直接执行；写术语前必须先展示精确方案，并根据完整对话语义确认用户明确批准当前方案，模糊表达不算批准。工具失败时解释原因并给出可重试方案，不声称未完成的写入已经成功。
`.trim();

type AgentBinding = {
  projectPath: string; // loaded 工程身份
  epoch: number; // 同路径重新加载也必须失效旧会话
  qualityRevision: number; // 外部术语写入后拒绝继续消费旧上下文
};

type AgentRuntime = {
  agent: Agent;
  binding: AgentBinding;
  skill: AgentSkillDefinition | null;
  unsubscribe: () => void;
};

type AgentServiceCache = Pick<CacheReadPort, "snapshot"> & {
  readonly items: Pick<CacheReadPort["items"], "readItems">;
};

type AgentServiceOptions = {
  paths: Parameters<typeof load_agent_skills>[0];
  settings: Pick<AppSettingService, "read_setting">;
  sessionState: ProjectSessionState;
  cache: AgentServiceCache;
  qualityRules: Pick<QualityRuleService, "read" | "save_rule_entries">;
  logManager: Pick<LogManager, "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

/**
 * 单个后端 Agent 会话的状态拥有者；页面只通过 snapshot、命令和 SSE 观察它。
 */
export class AgentService {
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly session_state: ProjectSessionState;
  private readonly cache: AgentServiceOptions["cache"];
  private readonly quality_rules: AgentServiceOptions["qualityRules"];
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型状态只绑定当前工程世代和当前 skill
  private state: AgentSessionState = "idle";
  private messages: AgentMessageSnapshot[] = [];
  private tool_statuses: AgentToolStatus[] = [];
  private skills: AgentSkillDefinition[] = [];
  private streaming_assistant_message_id: string | null = null;
  private own_write = false; // 质量写入口同步发布自身事件时，只推进 binding 而不中断当前模型回合
  private disposed = false;

  public constructor(options: AgentServiceOptions) {
    this.paths = options.paths;
    this.settings = options.settings;
    this.session_state = options.sessionState;
    this.cache = options.cache;
    this.quality_rules = options.qualityRules;
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.unsubscribe_project_session = this.session_state.subscribe_change(() =>
      this.invalidate_session(),
    );
  }

  /**
   * 返回仅含不可变投影的公开快照，避免 API 调用方持有会话内部引用。
   */
  public get_snapshot(): AgentSessionSnapshot {
    return {
      state: this.state,
      messages: this.messages.map((message) => ({ ...message })),
      toolStatuses: this.tool_statuses.map((status) => ({ ...status })),
      skills: this.skills.map(({ name, description }) => ({ name, description })),
    };
  }

  /**
   * Skill 只在启动期加载一次；单个坏文件记录诊断但不阻断基础对话。
   */
  public async load_skills(): Promise<void> {
    this.skills = await load_agent_skills(this.paths, this.log_manager);
  }

  /**
   * 校验消息和可选 skill 后异步启动模型回合，HTTP 只等待命令受理。
   */
  public send_message(request: JsonRecord): AgentSessionSnapshot {
    this.assert_not_disposed();
    this.session_state.require_loaded_project_path();
    const text = String(request["text"] ?? "").trim();
    if (text === "") {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_agent_message" },
      });
    }
    const skill_value = request["skill"];
    const skill =
      typeof skill_value === "string"
        ? (this.skills.find((candidate) => candidate.name === skill_value) ?? null)
        : null;
    if (skill_value !== undefined && skill === null) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "invalid_agent_skill", skill: skill_value },
      });
    }

    const runtime = this.ensure_runtime(skill);
    if (runtime.agent.state.isStreaming) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_already_running" },
      });
    }

    this.append_public_message({
      id: uuidv7(),
      role: "user",
      text,
      createdAt: Date.now(),
      complete: true,
    });
    this.set_state("running");
    void this.run_prompt(runtime, text);
    return this.get_snapshot();
  }

  /**
   * 中断当前模型回合；迟到的完成回调因状态已回到 idle 不再覆盖公开状态。
   */
  public stop(): AgentSessionSnapshot {
    this.runtime?.agent.abort();
    this.own_write = false;
    this.set_state("idle");
    return this.get_snapshot();
  }

  /**
   * 丢弃当前工程绑定的对话和运行时，skill 启动清单继续保留。
   */
  public reset(): AgentSessionSnapshot {
    this.invalidate_session();
    return this.get_snapshot();
  }

  /**
   * 项目写入发布后同步核对 quality；Agent 自己的原子写入只推进 binding，不自毁当前复核回合。
   */
  public handle_project_change(event: ProjectChangeEvent): void {
    if (!event.updatedSections.includes("quality") || this.runtime === null) {
      return;
    }
    if (this.own_write) {
      this.runtime.binding = this.read_binding();
      return;
    }
    this.invalidate_session();
  }

  /**
   * 先断开订阅和模型事件，再等待当前模型回合退出。
   */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe_project_session();
    const runtime = this.runtime;
    this.runtime = null;
    runtime?.agent.abort();
    runtime?.unsubscribe();
    await runtime?.agent.waitForIdle();
  }

  /**
   * 复用同一工程绑定的运行时；工程或 skill 变化时只保留仍然有效的会话事实。
   */
  private ensure_runtime(skill: AgentSkillDefinition | null): AgentRuntime {
    const binding = this.read_binding();
    if (this.runtime !== null && !bindings_equal(this.runtime.binding, binding)) {
      this.invalidate_session();
    }
    if (this.runtime === null) {
      this.runtime = this.create_runtime(binding, skill);
    } else if (this.runtime.skill?.name !== skill?.name) {
      this.runtime.skill = skill;
      this.runtime.agent.state.systemPrompt = build_system_prompt(skill);
    }
    return this.runtime;
  }

  /**
   * 创建单个 pi Agent，并把领域工具和事件订阅收口在同一生命周期对象中。
   */
  private create_runtime(binding: AgentBinding, skill: AgentSkillDefinition | null): AgentRuntime {
    const resolved_model = resolve_agent_model(this.settings.read_setting());
    const runtime = {} as AgentRuntime;
    const agent = new Agent({
      initialState: {
        systemPrompt: build_system_prompt(skill),
        model: resolved_model.model,
        thinkingLevel: resolved_model.thinkingLevel,
        tools: [
          ...create_agent_glossary_tools({
            qualityRules: this.quality_rules,
            cache: this.cache,
            beginWrite: () => this.begin_write(),
            endWrite: () => this.end_write(),
          }),
          ...create_agent_corpus_tools(this.cache),
          ...create_skill_reference_tools(() => this.runtime?.skill ?? null),
        ],
        messages: [],
      },
      streamFn: resolved_model.stream,
      toolExecution: "sequential",
    });
    runtime.agent = agent;
    runtime.binding = binding;
    runtime.skill = skill;
    runtime.unsubscribe = agent.subscribe((event) => {
      if (this.runtime === runtime) {
        this.handle_agent_event(event);
      }
    });
    return runtime;
  }

  /**
   * 把模型异常转成稳定 typed event；已经停止或失效的旧运行时不再发布终态。
   */
  private async run_prompt(runtime: AgentRuntime, text: string): Promise<void> {
    try {
      await runtime.agent.prompt(text);
    } catch (error) {
      if (this.runtime === runtime && this.state !== "idle") {
        this.log_manager.error("Agent 模型回合失败", { source: "agent", error });
        this.publish_event({ type: "request_failed" });
      }
    } finally {
      if (this.runtime === runtime && this.state !== "idle") {
        this.set_state("complete");
      }
    }
  }

  /**
   * 将第三方 AgentEvent 收窄为本项目公开的消息与工具状态协议。
   */
  private handle_agent_event(event: AgentEvent): void {
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.streaming_assistant_message_id = uuidv7();
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      const delta = event.assistantMessageEvent.delta;
      if (delta === "") return;
      this.append_assistant_delta(delta);
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.complete_assistant_message(event.message);
      return;
    }
    if (event.type === "tool_execution_start") {
      this.update_tool_status({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      this.update_tool_status({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? "error" : "success",
      });
    }
  }

  /**
   * 追加连续文本增量并发布其写入前 offset，供 renderer 幂等合并。
   */
  private append_assistant_delta(delta: string): void {
    const message_id = this.streaming_assistant_message_id ?? uuidv7();
    this.streaming_assistant_message_id = message_id;
    const existing = this.messages.find((message) => message.id === message_id);
    const offset = existing?.text.length ?? 0;
    if (existing === undefined) {
      this.messages.push({
        id: message_id,
        role: "assistant",
        text: delta,
        createdAt: Date.now(),
        complete: false,
      });
    } else {
      existing.text += delta;
    }
    this.publish_event({
      type: "message_delta",
      messageId: message_id,
      role: "assistant",
      delta,
      offset,
      createdAt: existing?.createdAt ?? Date.now(),
      complete: false,
    });
  }

  /**
   * 以供应商终帧校正累计正文；出现差异时用完整 seed 恢复两端一致。
   */
  private complete_assistant_message(message: AssistantMessage): void {
    const message_id = this.streaming_assistant_message_id ?? uuidv7();
    const text = contentText(message.content, "");
    const existing = this.messages.find((item) => item.id === message_id);
    if (existing === undefined && text !== "") {
      this.messages.push({
        id: message_id,
        role: "assistant",
        text,
        createdAt: message.timestamp,
        complete: true,
      });
      this.publish_event({
        type: "message_delta",
        messageId: message_id,
        role: "assistant",
        delta: text,
        offset: 0,
        createdAt: message.timestamp,
        complete: true,
      });
    } else if (existing !== undefined) {
      if (text !== "" && text !== existing.text) {
        existing.text = text;
        this.publish_seed();
      }
      existing.complete = true;
      this.publish_event({
        type: "message_delta",
        messageId: message_id,
        role: "assistant",
        delta: "",
        offset: existing.text.length,
        createdAt: existing.createdAt,
        complete: true,
      });
    }
    this.streaming_assistant_message_id = null;
  }

  private begin_write(): void {
    this.own_write = true;
  }

  private end_write(): void {
    this.own_write = false;
  }

  private append_public_message(message: AgentMessageSnapshot): void {
    this.messages.push({ ...message });
    this.publish_event({
      type: "message_delta",
      messageId: message.id,
      role: message.role,
      delta: message.text,
      offset: 0,
      createdAt: message.createdAt,
      complete: message.complete,
    });
  }

  private update_tool_status(status: AgentToolStatus): void {
    const index = this.tool_statuses.findIndex((item) => item.toolCallId === status.toolCallId);
    if (index < 0) this.tool_statuses.push(status);
    else this.tool_statuses[index] = status;
    this.publish_event({ type: "tool_status", ...status });
  }

  private set_state(state: AgentSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.publish_event({ type: "session_state", state });
  }

  private publish_event(event: AgentSessionEvent): void {
    this.publish(AGENT_SESSION_EVENT_TOPIC, event);
  }

  private publish_seed(): void {
    this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
  }

  /**
   * 原子失效模型订阅、公开消息和工具状态，并向已挂载页面发送空 seed。
   */
  private invalidate_session(): void {
    const runtime = this.runtime;
    this.runtime = null;
    runtime?.agent.abort();
    runtime?.unsubscribe();
    this.state = "idle";
    this.messages = [];
    this.tool_statuses = [];
    this.streaming_assistant_message_id = null;
    this.own_write = false;
    this.publish_seed();
  }

  /**
   * 会话绑定同时读取工程世代和 quality revision，不能只比较路径。
   */
  private read_binding(): AgentBinding {
    const project_path = this.session_state.require_loaded_project_path();
    const snapshot = this.cache.snapshot();
    return {
      projectPath: project_path,
      epoch: snapshot.epoch,
      qualityRevision: snapshot.sectionRevisions.quality ?? 0,
    };
  }

  private assert_not_disposed(): void {
    if (this.disposed) {
      throw new AppErrors.RuntimeDisposedError();
    }
  }
}

function build_system_prompt(skill: AgentSkillDefinition | null): string {
  if (skill === null) return BASE_SYSTEM_PROMPT;
  const skill_block =
    skill.reference_index === ""
      ? skill.essentials
      : `${skill.essentials}\n\n${skill.reference_index}`;
  return `${BASE_SYSTEM_PROMPT}\n\n${skill_block}`;
}

function bindings_equal(left: AgentBinding | null, right: AgentBinding): boolean {
  return (
    left !== null &&
    left.projectPath === right.projectPath &&
    left.epoch === right.epoch &&
    left.qualityRevision === right.qualityRevision
  );
}
