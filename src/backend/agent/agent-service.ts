import {
  Agent,
  formatSkillInvocation,
  uuidv7,
  type AgentEvent,
} from "@earendil-works/pi-agent-core";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import {
  AGENT_SESSION_EVENT_TOPIC,
  format_agent_user_message_text,
  normalize_agent_user_message_parts,
  type AgentEntry,
  type AgentSessionEvent,
  type AgentSessionSnapshot,
  type AgentSessionState,
  type AgentUserMessagePart,
} from "../../shared/agent";
import * as AppErrors from "../../shared/error";
import type { ProjectChangeEvent } from "../../shared/project-event";
import type { AppPathService } from "../app/app-path-service";
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
import { load_agent_system_prompt } from "./agent-system-prompt";

type AgentBinding = {
  projectPath: string; // loaded 工程身份
  epoch: number; // 同路径重新加载也必须失效旧会话
  qualityRevision: number; // 外部术语写入后拒绝继续消费旧上下文
};

type AgentRuntime = {
  agent: Agent;
  binding: AgentBinding;
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
  private runtime: AgentRuntime | null = null; // 模型状态只绑定当前工程世代
  private state: AgentSessionState = "idle";
  private entries: AgentEntry[] = [];
  private skills: AgentSkillDefinition[] = [];
  private system_prompt: string | null = null;
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
      entries: structuredClone(this.entries),
      skills: this.skills.map(({ name, description }) => ({ name, description })),
    };
  }

  /** 启动期原子加载必需的基础 Prompt 和可降级的 skill 清单。 */
  public async load_resources(): Promise<void> {
    const system_prompt = load_agent_system_prompt(this.paths);
    const skills = await load_agent_skills(this.paths, this.log_manager);
    this.system_prompt = system_prompt;
    this.skills = skills;
  }

  /**
   * 完整校验结构化消息后异步启动模型回合，HTTP 只等待命令受理。
   */
  public send_message(request: JsonRecord): AgentSessionSnapshot {
    this.assert_not_disposed();
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

    const runtime = this.ensure_runtime(system_prompt);
    if (runtime.agent.state.isStreaming) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_already_running" },
      });
    }

    this.upsert_entry({
      kind: "user_message",
      id: uuidv7(),
      parts,
      createdAt: Date.now(),
    });
    this.set_state("running");
    void this.run_prompt(runtime, build_agent_prompt(parts, selected_skills));
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
   * 复用同一工程绑定的运行时；工程事实失效时清空整段会话。
   */
  private ensure_runtime(system_prompt: string): AgentRuntime {
    const binding = this.read_binding();
    if (this.runtime !== null && !bindings_equal(this.runtime.binding, binding)) {
      this.invalidate_session();
    }
    if (this.runtime === null) {
      this.runtime = this.create_runtime(binding, system_prompt);
    }
    return this.runtime;
  }

  /**
   * 创建单个 pi Agent，并把领域工具和事件订阅收口在同一生命周期对象中。
   */
  private create_runtime(binding: AgentBinding, system_prompt: string): AgentRuntime {
    const resolved_model = resolve_agent_model(this.settings.read_setting());
    const runtime = {} as AgentRuntime;
    const agent = new Agent({
      initialState: {
        systemPrompt: system_prompt,
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
          ...create_skill_reference_tools((name) => this.resolve_invoked_skill(name)),
        ],
        messages: [],
      },
      streamFn: resolved_model.stream,
      toolExecution: "sequential",
    });
    runtime.agent = agent;
    runtime.binding = binding;
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
   * 将第三方 AgentEvent 收窄为按真实事件顺序追加的公开时间线。
   */
  private handle_agent_event(event: AgentEvent): void {
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.upsert_entry({
        kind: "assistant_message",
        id: uuidv7(),
        text: "",
        complete: false,
        createdAt: event.message.timestamp,
      });
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

  /** 追加连续文本并重新发布完整条目，renderer 只需按 id 覆盖。 */
  private append_assistant_delta(delta: string): void {
    const existing = this.find_open_assistant_entry();
    if (existing === undefined) {
      this.upsert_entry({
        kind: "assistant_message",
        id: uuidv7(),
        text: delta,
        createdAt: Date.now(),
        complete: false,
      });
    } else {
      this.upsert_entry({ ...existing, text: existing.text + delta });
    }
  }

  /** 以供应商终帧校正累计正文并结束当前 assistant 条目。 */
  private complete_assistant_message(message: AssistantMessage): void {
    const text = contentText(message.content, "");
    const existing = this.find_open_assistant_entry();
    if (existing === undefined) {
      // 纯 toolCall assistant 仍需占住真实事件位置；无文本、无工具的空帧才可丢弃。
      if (text === "" && !message.content.some((content) => content.type === "toolCall")) return;
      this.upsert_entry({
        kind: "assistant_message",
        id: uuidv7(),
        text,
        createdAt: message.timestamp,
        complete: true,
      });
      return;
    }
    this.upsert_entry({
      ...existing,
      text: text === "" ? existing.text : text,
      complete: true,
    });
  }

  private begin_write(): void {
    this.own_write = true;
  }

  private end_write(): void {
    this.own_write = false;
  }

  /** reference 工具授权直接由当前公开会话中的显式 skill part 推导。 */
  private resolve_invoked_skill(name: string): AgentSkillDefinition | null {
    const invoked = this.entries.some(
      (entry) =>
        entry.kind === "user_message" &&
        entry.parts.some((part) => part.kind === "skill" && part.name === name),
    );
    return invoked ? (this.skills.find((skill) => skill.name === name) ?? null) : null;
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

  private set_state(state: AgentSessionState): void {
    if (this.state === state) return;
    this.state = state;
    this.publish_event({ type: "session_state", state });
  }

  private publish_event(event: AgentSessionEvent): void {
    this.publish(AGENT_SESSION_EVENT_TOPIC, event);
  }

  /**
   * 原子失效模型订阅和公开时间线，并向已挂载页面发送空 seed。
   */
  private invalidate_session(): void {
    const runtime = this.runtime;
    this.runtime = null;
    runtime?.agent.abort();
    runtime?.unsubscribe();
    this.state = "idle";
    this.entries = [];
    this.own_write = false;
    this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
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

  private require_system_prompt(): string {
    if (this.system_prompt === null) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "agent_resources_not_loaded" },
      });
    }
    return this.system_prompt;
  }

  private assert_not_disposed(): void {
    if (this.disposed) {
      throw new AppErrors.RuntimeDisposedError();
    }
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

function bindings_equal(left: AgentBinding | null, right: AgentBinding): boolean {
  return (
    left !== null &&
    left.projectPath === right.projectPath &&
    left.epoch === right.epoch &&
    left.qualityRevision === right.qualityRevision
  );
}
