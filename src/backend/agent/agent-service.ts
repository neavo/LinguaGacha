import {
  Agent,
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
  uuidv7,
  type AgentEvent,
} from "@earendil-works/pi-agent-core";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import {
  AGENT_SESSION_EVENT_TOPIC,
  format_agent_user_message_text,
  normalize_agent_user_message_parts,
  type AgentAssistantMessagePart,
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
import { AGENT_PROOFREADING_UPDATE_SOURCE, create_agent_item_tools } from "./agent-item-tools";
import { resolve_agent_model } from "./agent-model";
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

type AgentBinding = {
  projectPath: string; // loaded 工程身份
  epoch: number; // 同路径重新加载也必须失效旧会话
  sectionRevisions: Record<(typeof AGENT_PROJECT_SECTIONS)[number], number>; // 工具事实依赖的 revision
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
  userAgent: string;
  sessionState: ProjectSessionState;
  cache: AgentServiceCache;
  qualityRules: Pick<QualityRuleService, "query" | "update">;
  proofreading: Pick<ProofreadingService, "update_items">;
  logManager: Pick<LogManager, "error" | "warning">;
  publish: (topic: string, payload: JsonRecord) => void;
};

/**
 * 单个后端 Agent 会话的状态拥有者；页面只通过 snapshot、命令和 SSE 观察它。
 */
export class AgentService {
  private readonly paths: AgentServiceOptions["paths"];
  private readonly settings: AgentServiceOptions["settings"];
  private readonly user_agent: string;
  private readonly session_state: ProjectSessionState;
  private readonly cache: AgentServiceOptions["cache"];
  private readonly quality_rules: AgentServiceOptions["qualityRules"];
  private readonly proofreading: AgentServiceOptions["proofreading"];
  private readonly log_manager: AgentServiceOptions["logManager"];
  private readonly publish: AgentServiceOptions["publish"];
  private readonly unsubscribe_project_session: () => void;
  private runtime: AgentRuntime | null = null; // 模型状态只绑定当前工程世代
  private session_reset: Promise<void> | null = null; // 旧运行时退出前阻止新消息跨会话并发
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
    this.log_manager = options.logManager;
    this.publish = options.publish;
    this.unsubscribe_project_session = this.session_state.subscribe_change(() =>
      this.reset_session(),
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
    const skills_prompt = formatSkillsForSystemPrompt(skills);
    this.system_prompt =
      skills_prompt === "" ? system_prompt : `${system_prompt}\n\n${skills_prompt}`;
    this.skills = skills;
  }

  /**
   * 完整校验结构化消息后异步启动模型回合，HTTP 只等待命令受理。
   */
  public send_message(request: JsonRecord): AgentSessionSnapshot {
    this.assert_not_disposed();
    if (this.session_reset !== null) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_session_resetting" },
      });
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

    if (this.runtime?.agent.state.isStreaming) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "agent_already_running" },
      });
    }
    const runtime = this.ensure_runtime(system_prompt);

    this.upsert_entry({
      kind: "user_message",
      id: uuidv7(),
      parts,
      createdAt: Date.now(),
      endedAt: null,
    });
    this.set_state("running");
    void this.run_prompt(runtime, build_agent_prompt(parts, selected_skills));
    return this.get_snapshot();
  }

  /** 清空当前对话，并在旧模型回合完全退出后返回最终空快照。 */
  public async reset(): Promise<AgentSessionSnapshot> {
    this.assert_not_disposed();
    await this.reset_session();
    return this.get_snapshot();
  }

  /**
   * 中断当前模型回合；迟到的完成回调因状态已回到 idle 不再覆盖公开状态。
   */
  public stop(): AgentSessionSnapshot {
    this.runtime?.agent.abort();
    this.end_current_round();
    this.set_state("idle");
    return this.get_snapshot();
  }

  /**
   * 相关项目事实变化令旧上下文失效；Agent 自己的原子写入只推进 binding。
   */
  public handle_project_change(event: ProjectChangeEvent): void {
    if (
      this.runtime === null ||
      !event.updatedSections.some((section) =>
        (AGENT_PROJECT_SECTIONS as readonly ProjectDataSection[]).includes(section),
      )
    ) {
      return;
    }
    if (
      event.source === AGENT_QUALITY_RULE_UPDATE_SOURCE ||
      event.source === AGENT_PROOFREADING_UPDATE_SOURCE
    ) {
      this.runtime.binding = this.read_binding();
      return;
    }
    void this.reset_session();
  }

  /**
   * 先断开订阅和模型事件，再等待当前模型回合退出。
   */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe_project_session();
    const runtime = this.runtime;
    const session_reset = this.session_reset;
    this.runtime = null;
    runtime?.agent.abort();
    runtime?.unsubscribe();
    await Promise.all([runtime?.agent.waitForIdle(), session_reset]);
  }

  /**
   * 复用同一工程绑定的运行时；工程事实失效时清空整段会话。
   */
  private ensure_runtime(system_prompt: string): AgentRuntime {
    const binding = this.read_binding();
    if (this.runtime !== null && !bindings_equal(this.runtime.binding, binding)) {
      void this.reset_session();
    }
    if (this.runtime === null) {
      this.runtime = this.create_runtime(binding, system_prompt);
    } else {
      // 空闲回合只替换模型请求能力，消息、工具、公开条目和工程绑定继续复用。
      const resolved_model = resolve_agent_model(this.settings.read_setting(), this.user_agent);
      this.runtime.agent.state.model = resolved_model.model;
      this.runtime.agent.state.thinkingLevel = resolved_model.thinkingLevel;
      this.runtime.agent.streamFunction = resolved_model.stream;
    }
    return this.runtime;
  }

  /**
   * 创建单个 pi Agent，并把领域工具和事件订阅收口在同一生命周期对象中。
   */
  private create_runtime(binding: AgentBinding, system_prompt: string): AgentRuntime {
    const resolved_model = resolve_agent_model(this.settings.read_setting(), this.user_agent);
    const agent = new Agent({
      initialState: {
        systemPrompt: system_prompt,
        model: resolved_model.model,
        thinkingLevel: resolved_model.thinkingLevel,
        tools: [
          ...create_agent_quality_tools({
            qualityRules: this.quality_rules,
            cache: this.cache,
          }),
          ...create_agent_item_tools({
            cache: this.cache,
            proofreading: this.proofreading,
          }),
          ...create_agent_skill_tools(this.skills, (name) =>
            this.is_skill_explicitly_invoked(name),
          ),
        ],
        messages: [],
      },
      streamFn: resolved_model.stream,
      toolExecution: "sequential",
    });
    const unsubscribe = agent.subscribe((event) => {
      if (this.runtime?.agent === agent) {
        this.handle_agent_event(event);
      }
    });
    return { agent, binding, unsubscribe };
  }

  /**
   * 把模型异常转成稳定 typed event；已经停止或失效的旧运行时不再发布终态。
   */
  private async run_prompt(runtime: AgentRuntime, text: string): Promise<void> {
    try {
      await runtime.agent.prompt(text);
    } catch (error) {
      if (this.runtime === runtime && this.state !== "idle") {
        this.report_request_failure(error);
      }
    } finally {
      if (this.runtime === runtime && this.state !== "idle") {
        this.end_current_round();
        this.set_state("complete");
      }
    }
  }

  /**
   * 将第三方 AgentEvent 收窄为按真实事件顺序追加的公开时间线。
   */
  private handle_agent_event(event: AgentEvent): void {
    if (
      event.type === "turn_end" &&
      event.message.role === "assistant" &&
      event.message.stopReason === "error" &&
      this.state !== "idle"
    ) {
      this.report_request_failure(new Error(event.message.errorMessage ?? "Agent 模型回合失败"));
      return;
    }
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent.type === "text_delta" ||
        event.assistantMessageEvent.type === "thinking_delta")
    ) {
      this.upsert_assistant_message(event.assistantMessageEvent.partial, false);
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.upsert_assistant_message(event.message, true);
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

  /** Pi 以终态消息承载模型错误；公开层只发布稳定事件并把诊断留在日志。 */
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

  /**
   * 隔离旧运行时并原子清空公开时间线；流式回合完全退出前共享同一收尾屏障。
   */
  private reset_session(): Promise<void> {
    if (this.session_reset !== null) return this.session_reset;
    const runtime = this.runtime;
    const was_streaming = runtime?.agent.state.isStreaming === true;
    this.runtime = null;
    runtime?.unsubscribe();
    runtime?.agent.abort();
    if (runtime !== null && was_streaming) {
      const reset = runtime.agent.waitForIdle().finally(() => {
        if (this.session_reset === reset) this.session_reset = null;
      });
      this.session_reset = reset;
    }
    this.state = "idle";
    this.entries = [];
    this.publish_event({ type: "snapshot_seed", snapshot: this.get_snapshot() });
    return this.session_reset ?? Promise.resolve();
  }

  /**
   * 会话绑定同时读取工程世代与工具依赖 section revision，不能只比较路径。
   */
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
