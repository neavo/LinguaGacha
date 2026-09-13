import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";

import { is_json_record, type JsonValue } from "../../domain/json";
import type { AgentAssistantMessagePart } from "../../shared/agent";
import { JsonTool } from "../../shared/utils/json-tool";
import type { LogManager } from "../log/log-manager";
import { project_assistant_message_parts } from "./agent-message";

type AgentLogStatus = "success" | "error" | "stopped";

type AgentToolLogOutput =
  | { kind: "json"; value: JsonValue }
  | { kind: "content"; content: JsonValue[]; details?: JsonValue };

type AgentLogPart = AgentAssistantMessagePart | { kind: "image"; mime_type: string };

/** 操作起止使用 UTC ISO 时间，日志写入时间另由 LogManager 生成。 */
type AgentLogTiming = { started_at: string; ended_at: string };

/** 日志记录实际执行，身份不随公开时间线的修订、停止或重置改变。 */
type AgentLogEvent =
  | ({
      event: "message";
      role: "user" | "assistant";
      parts: AgentLogPart[];
      status: AgentLogStatus;
    } & AgentLogTiming)
  | {
      event: "tool_start";
      tool_call_id: string;
      tool_name: string;
      input: JsonValue;
      started_at: string;
    }
  | ({
      event: "tool_end";
      tool_call_id: string;
      tool_name: string;
      output: AgentToolLogOutput;
      status: "success" | "error";
    } & AgentLogTiming)
  | { event: "run_start"; mode: "prompt" | "queued" | "continue"; started_at: string }
  | ({ event: "run_end"; status: AgentLogStatus } & AgentLogTiming)
  | { event: "compaction_start"; reason: string; started_at: string }
  | ({
      event: "compaction_end";
      status: AgentLogStatus;
      reason: string;
      error?: string;
    } & AgentLogTiming)
  | { event: "stop_requested" }
  | { event: "reset"; reason: string }
  | { event: "revise"; round_id: string; role: "user" }
  | { event: "revise"; round_id: string; role: "assistant"; text: string };

export type AgentLogContent = AgentLogEvent & {
  kind: "agent";
  session_id: string;
  round_id?: string;
  run_id?: string;
};

type AgentLogRun = { run_id: string; round_id: string; started_at: string; stopped: boolean };
type AgentLogMessage = { started_at: string; parts: AgentLogPart[] };

/** 每个 SDK runtime 持有自己的日志归属；只保留未结束操作，不复制公开时间线。 */
export class AgentSessionLog {
  private readonly session_id = uuidv7(); // reset 后的迟到事件仍属于创建它的 runtime
  private run: AgentLogRun | null = null; // 仅活动尝试拥有 round/run 关联与停止意图
  private assistant: AgentLogMessage | null = null; // 缓存尚未结束的可见正文，供停止时结算
  private compaction_started_at: string | null = null; // 手动压缩也可独立于 run 执行
  private readonly tool_start_times = new Map<string, string>(); // 并行工具分别配对终帧

  /** 共用应用日志写入口，记录器只拥有执行关联状态。 */
  public constructor(private readonly log_manager: Pick<LogManager, "append">) {}

  /** continue 保留轮次身份，每次真正执行分配新的 run，耗时不包含失败后的用户等待。 */
  public begin_run(round_id: string, mode: "prompt" | "queued" | "continue"): void {
    this.run = { run_id: uuidv7(), round_id, started_at: new Date().toISOString(), stopped: false };
    this.append({ event: "run_start", mode, started_at: this.run.started_at });
  }

  /** SDK Promise 结算后才记录真实结束，UI 提前停止不会改变此处的时钟。 */
  public finish_run(outcome: AgentLogStatus): void {
    if (this.run === null) return;
    const status = this.run.stopped ? "stopped" : outcome;
    this.finish_assistant(status);
    this.append({
      event: "run_end",
      status,
      started_at: this.run.started_at,
      ended_at: new Date().toISOString(),
    });
    this.run = null;
    // 缺少终帧的工具只保留 start 事实，不能制造输出或完成时间。
    this.tool_start_times.clear();
  }

  /** 保存停止意图，结束时间仍等待 SDK 实际结算。 */
  public request_stop(): void {
    if (this.run === null || this.run.stopped) return;
    this.run.stopped = true;
    this.append({ event: "stop_requested" });
  }

  /** 在 runtime 隔离前追加重置原因，保留旧执行的收尾归属。 */
  public reset(reason: string): void {
    this.request_stop();
    this.append({ event: "reset", reason });
  }

  /** 只修订最新 round；用户新正文由实际发送记录，人工助手正文在此保存。 */
  public revise(round_id: string, role: "user" | "assistant", text: string): void {
    this.append(
      role === "user"
        ? { event: "revise", round_id, role }
        : { event: "revise", round_id, role, text },
    );
  }

  /** 订阅早于公开状态筛选；重置后的旧 SDK 终帧仍写入旧会话。 */
  public handle_event(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "user") {
          const time = new Date().toISOString();
          const content = event.message.content;
          const parts: AgentLogPart[] =
            typeof content === "string"
              ? [{ kind: "text", text: content }]
              : content.map((part): AgentLogPart => {
                  if (part.type === "text") return { kind: "text", text: part.text };
                  return { kind: "image", mime_type: part.mimeType };
                });
          this.append({
            event: "message",
            role: "user",
            parts,
            status: "success",
            started_at: time,
            ended_at: time,
          });
        } else if (event.message.role === "assistant") {
          this.assistant = {
            started_at: new Date().toISOString(),
            parts: project_assistant_message_parts(event.message) ?? [],
          };
        }
        break;
      case "message_update":
        if (event.message.role === "assistant" && this.assistant !== null)
          this.assistant.parts =
            project_assistant_message_parts(event.message) ?? this.assistant.parts;
        break;
      case "message_end":
        // SDK 对早期失败也先补发 start，只封口已观察到的消息。
        if (event.message.role === "assistant" && this.assistant !== null) {
          const parts = project_assistant_message_parts(event.message);
          if (parts !== null) this.assistant.parts = parts;
          this.finish_assistant(
            event.message.stopReason === "aborted"
              ? "stopped"
              : event.message.stopReason === "error"
                ? "error"
                : "success",
          );
        }
        break;
      case "tool_execution_start": {
        const started_at = new Date().toISOString();
        this.tool_start_times.set(event.toolCallId, started_at);
        this.append({
          event: "tool_start",
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          input: json_snapshot(event.args),
          started_at,
        });
        break;
      }
      case "tool_execution_end": {
        const started_at = this.tool_start_times.get(event.toolCallId);
        if (started_at === undefined) break; // 已结算的终帧不重复写入；未观察到 start 时也不猜开始时间。
        this.tool_start_times.delete(event.toolCallId);
        this.append({
          event: "tool_end",
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          started_at,
          output: normalize_agent_tool_log_output(event.result),
          // 停止意图由 run 独立记录，工具仍保留 SDK 确认的实际结果。
          status: event.isError ? "error" : "success",
          ended_at: new Date().toISOString(),
        });
        break;
      }
      case "compaction_start":
        this.compaction_started_at = new Date().toISOString();
        this.append({
          event: "compaction_start",
          reason: event.reason,
          started_at: this.compaction_started_at,
        });
        break;
      case "compaction_end":
        if (this.compaction_started_at !== null) {
          this.append({
            event: "compaction_end",
            reason: event.reason,
            started_at: this.compaction_started_at,
            ended_at: new Date().toISOString(),
            status: event.aborted
              ? "stopped"
              : event.result !== undefined && event.errorMessage === undefined
                ? "success"
                : "error",
            ...(event.errorMessage === undefined ? {} : { error: event.errorMessage }),
          });
          this.compaction_started_at = null;
        }
        break;
    }
  }

  /** 终帧与中断收尾共用出口，工具专用空消息不生成正文记录。 */
  private finish_assistant(status: AgentLogStatus): void {
    const assistant = this.assistant;
    this.assistant = null;
    if (assistant === null || assistant.parts.length === 0) return;
    this.append({
      event: "message",
      role: "assistant",
      ...assistant,
      status,
      ended_at: new Date().toISOString(),
    });
  }

  /** 附加会话身份并写入日志窗口，正文不进入终端。 */
  private append(event: AgentLogEvent): void {
    const content: AgentLogContent = {
      kind: "agent",
      ...event,
      session_id: this.session_id,
      ...(this.run === null ? {} : { round_id: this.run.round_id, run_id: this.run.run_id }),
    };
    this.log_manager.append({
      level: "status" in event && event.status === "error" ? "error" : "info",
      source: "agent",
      content,
      targets: { console: false, window: true },
    });
  }
}

/** 只去掉 agent_tool_result 的可逐字重建副本；网页等独有 details 仍完整保留。 */
export function normalize_agent_tool_log_output(result: {
  content: readonly unknown[];
  details?: unknown;
}): AgentToolLogOutput {
  // SDK 工具结果固定由 content 和可选 details 组成，JSON 快照保留其中的原始内容块。
  const content = json_snapshot(result.content) as JsonValue[];
  const details = result.details === undefined ? undefined : json_snapshot(result.details);
  const first = content[0];
  if (
    content.length === 1 &&
    is_json_record(first) &&
    first["type"] === "text" &&
    Object.keys(first).length === 2 &&
    details !== undefined &&
    first["text"] === JsonTool.stringifyStrict(details)
  )
    return { kind: "json", value: details };
  return { kind: "content", content, ...(details === undefined ? {} : { details }) };
}

/** 输入与结果是 SDK JSON 载荷，序列化同时冻结引用，完整正文不经过诊断裁剪。 */
function json_snapshot(value: unknown): JsonValue {
  return JsonTool.parseStrict<JsonValue>(JsonTool.stringifyStrict(value));
}
