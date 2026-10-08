import type { LogAppendPayload, LogLevel } from "../../shared/log";
import { to_log_error } from "../../shared/error";
import {
  uuidv7,
  type Message,
  type AssistantMessage,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { is_json_record, type JsonValue } from "../../domain/json";
import type { AgentAssistantMessagePart } from "../../shared/agent";
import { JsonTool } from "../../shared/utils/json-tool";
import type { LogManager } from "../log/log-manager";
import { project_assistant_message_parts, read_agent_tool_result_status } from "./agent-message";

export type AgentStopReason = "user" | "reset" | "project_change" | "shutdown";
export type AgentLogStatus = "success" | "error" | "stopped";
type AgentLogEnd = {
  status: AgentLogStatus;
  stop_reason?: AgentStopReason;
  error?: unknown;
  level?: LogLevel;
};

/** 日志消费已经观察到的执行事实，独立于 SDK 的公开事件适配与界面终态。 */
export type AgentLogInput =
  | { type: "message_start" | "message_end"; message: Message; stop_reason?: AgentStopReason }
  | {
      type: "message_update";
      message: AssistantMessage;
    }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "compaction_start"; reason: string; task_id: number }
  | ({
      type: "compaction_end";
      reason: string;
      task_id: number;
    } & Omit<AgentLogEnd, "status"> & { status: AgentLogStatus | "skipped" });

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
      stop_reason?: AgentStopReason;
      parts: AgentLogPart[];
      status: AgentLogStatus;
      duration_ms?: number; // SDK 请求耗时，包含首段等待。
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
      status: AgentLogStatus;
      stop_reason?: AgentStopReason;
      duration_ms?: number; // SDK 执行耗时，不含排队与提交。
    } & AgentLogTiming)
  | {
      event: "tool_diagnostic";
      task_id: number;
      tool_call_id: string;
      tool_name: string;
      ended_at: string;
    }
  | { event: "run_start"; mode: "prompt" | "queued" | "continue"; started_at: string }
  | ({
      event: "run_end";
      status: AgentLogStatus;
      stop_reason?: AgentStopReason;
      failure?: { operation: "compaction"; task_id: number };
    } & AgentLogTiming)
  | { event: "compaction_start"; reason: string; task_id: number; started_at: string }
  | ({
      event: "compaction_end";
      status: AgentLogStatus | "skipped";
      reason: string;
      task_id: number;
      stop_reason?: AgentStopReason;
    } & AgentLogTiming)
  | { event: "stop_requested"; stop_reason: AgentStopReason }
  | {
      event: "operation_end";
      operation: "input_prepare" | "compaction" | "cleanup";
      status: "error";
      ended_at: string;
    }
  | { event: "reset"; reason: string }
  | { event: "revise"; round_id: string; role: "user" }
  | { event: "revise"; round_id: string; role: "assistant"; text: string };

export type AgentLogContent = AgentLogEvent & {
  kind: "agent";
  runtime_id: string;
  chat_id: string;
  round_id?: string;
  run_id?: string;
};

type AgentLogRun = { run_id: string; round_id: string; started_at: string };
type AgentLogMessage = { started_at: string; parts: AgentLogPart[] };
type AgentToolLogDiagnostic = Pick<AgentLogEnd, "error" | "level" | "stop_reason"> & {
  toolCallId: string;
  toolName: string;
};

/** 每个 SDK runtime 持有执行归属和待写诊断，随会话刷新及关闭完成落盘。 */
export class AgentRuntimeLog {
  private readonly pending: LogAppendPayload[] = []; // 接收时冻结身份与诊断，提交回调之外统一落盘
  private readonly runtime_id = uuidv7(); // reset 后的迟到事件仍属于创建它的 runtime
  private run: AgentLogRun | null = null; // 仅活动尝试拥有 round/run 关联
  private assistant: AgentLogMessage | null = null; // 缓存尚未结束的可见正文，供停止时结算
  private readonly compaction_start_times = new Map<number, string>(); // 原生任务配对起止，手动压缩独立于 run
  private readonly tool_start_times = new Map<string, string>(); // 并行工具分别配对终帧
  private readonly tool_diagnostics = new Map<number, AgentToolLogDiagnostic>(); // SDK `taskId` 关联未入历史的宿主诊断，回执消费或收尾释放

  /** 共用应用日志写入口，记录器只拥有执行关联状态。 */
  public constructor(
    private readonly log_manager: Pick<LogManager, "append">,
    private readonly chat_id: string,
  ) {}

  /** continue 保留轮次身份，每次真正执行分配新的 run，耗时不包含失败后的用户等待。 */
  public begin_run(round_id: string, mode: "prompt" | "queued" | "continue"): void {
    this.run = { run_id: uuidv7(), round_id, started_at: new Date().toISOString() };
    this.append({ event: "run_start", mode, started_at: this.run.started_at });
  }

  /** SDK Promise 结算后才记录真实结束，UI 提前停止不会改变此处的时钟。 */
  public finish_run(
    status: AgentLogStatus,
    details: Pick<AgentLogEnd, "stop_reason" | "error"> & {
      failure?: { operation: "compaction"; task_id: number };
    } = {},
  ): void {
    this.finish_tools();
    if (this.run === null) return;
    this.finish_assistant(status, details.stop_reason);
    this.append(
      {
        event: "run_end",
        status,
        ...(details.stop_reason === undefined ? {} : { stop_reason: details.stop_reason }),
        ...(details.failure === undefined ? {} : { failure: details.failure }),
        started_at: this.run.started_at,
        ended_at: new Date().toISOString(),
      },
      details,
    );
    this.run = null;
  }

  /** 执行拥有者已经受理停止，手动压缩也记录请求。 */
  public request_stop(stop_reason: AgentStopReason): void {
    this.append({ event: "stop_requested", stop_reason });
  }

  /** 在 runtime 隔离前追加重置原因，保留旧执行的收尾归属。 */
  public reset(reason: string): void {
    this.append({ event: "reset", reason });
  }

  /** 只修订最新 `round`。用户新正文由实际发送记录，人工助手正文在此保存。 */
  public revise(round_id: string, role: "user" | "assistant", text: string): void {
    this.append(
      role === "user"
        ? { event: "revise", round_id, role }
        : { event: "revise", round_id, role, text },
    );
  }

  /** 捕获时固定原始异常和停止来源，等待 SDK 提交回执关联。 */
  public record_tool_diagnostic(task_id: number, diagnostic: AgentToolLogDiagnostic): void {
    this.tool_diagnostics.set(task_id, {
      ...diagnostic,
      ...(diagnostic.error === undefined ? {} : { error: to_log_error(diagnostic.error) }),
    });
  }

  /** 所有工具终态从已提交结果结算，包括未进入执行体的校验失败和取消。 */
  public record_tool_result(
    record: Pick<EntryRecord, "byTaskId" | "data">,
    message: ToolResultMessage,
    stop_reason?: AgentStopReason,
  ): void {
    const diagnostic =
      record.byTaskId === undefined ? undefined : this.tool_diagnostics.get(record.byTaskId);
    if (record.byTaskId !== undefined) this.tool_diagnostics.delete(record.byTaskId);
    const started_at = this.tool_start_times.get(message.toolCallId);
    if (started_at === undefined) return; // 恢复时可能只观察到旧任务回执，不补造本次执行。
    this.tool_start_times.delete(message.toolCallId);
    const status = read_agent_tool_result_status(record, message);
    const stopped_by = diagnostic?.stop_reason ?? stop_reason;
    this.append(
      {
        event: "tool_end",
        tool_call_id: message.toolCallId,
        tool_name: message.toolName,
        started_at,
        ended_at: new Date(message.timestamp).toISOString(),
        output: normalize_agent_tool_log_output(message),
        status,
        ...(status !== "stopped" || stopped_by === undefined ? {} : { stop_reason: stopped_by }),
        ...(message.durationMs === undefined ? {} : { duration_ms: message.durationMs }),
      },
      { ...diagnostic, level: diagnostic?.level ?? "info" },
    );
  }

  /** 提交失败时仅保存未消费的原始诊断，不能把执行返回当成已完成回执。 */
  public finish_tools(): void {
    for (const [task_id, diagnostic] of this.tool_diagnostics) {
      if (diagnostic.error === undefined) continue;
      this.append(
        {
          event: "tool_diagnostic",
          task_id,
          tool_call_id: diagnostic.toolCallId,
          tool_name: diagnostic.toolName,
          ended_at: new Date().toISOString(),
        },
        diagnostic,
      );
    }
    this.tool_diagnostics.clear();
    // 缺少终帧的工具只保留 start 事实，不能制造输出或完成时间。
    this.tool_start_times.clear();
  }

  /** 订阅早于公开状态筛选，重置后的旧 SDK 终帧仍写入旧会话。 */
  public handle_event(event: AgentLogInput): void {
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
            event.stop_reason,
            event.message.durationMs,
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
      case "compaction_start": {
        const started_at = new Date().toISOString();
        this.compaction_start_times.set(event.task_id, started_at);
        this.append({
          event: "compaction_start",
          reason: event.reason,
          task_id: event.task_id,
          started_at,
        });
        break;
      }
      case "compaction_end": {
        const started_at = this.compaction_start_times.get(event.task_id);
        if (started_at === undefined) break;
        this.compaction_start_times.delete(event.task_id);
        this.append(
          {
            event: "compaction_end",
            reason: event.reason,
            task_id: event.task_id,
            started_at,
            ended_at: new Date().toISOString(),
            status: event.status,
            ...(event.stop_reason === undefined ? {} : { stop_reason: event.stop_reason }),
          },
          event,
        );
        break;
      }
    }
  }

  /** 终帧与中断收尾共用出口，工具专用空消息不生成正文记录。 */
  private finish_assistant(
    status: AgentLogStatus,
    stop_reason?: AgentStopReason,
    duration_ms?: number,
  ): void {
    const assistant = this.assistant;
    this.assistant = null;
    if (assistant === null || assistant.parts.length === 0) return;
    this.append({
      event: "message",
      role: "assistant",
      ...assistant,
      status,
      ...(status === "stopped" && stop_reason !== undefined ? { stop_reason } : {}),
      ended_at: new Date().toISOString(),
      ...(duration_ms === undefined ? {} : { duration_ms }),
    });
  }

  /** 没有原生任务终帧的准备与清理失败仍携带所属会话和执行身份。 */
  public report_failure(
    operation: "input_prepare" | "compaction" | "cleanup",
    error: unknown,
  ): void {
    this.append(
      { event: "operation_end", operation, status: "error", ended_at: new Date().toISOString() },
      {
        error,
        level: operation === "cleanup" ? "warning" : "error",
      },
    );
  }

  /** 会话在提交回调之外刷新或关闭时，按接收顺序写出日志。 */
  public flush(): void {
    for (const payload of this.pending.splice(0)) this.log_manager.append(payload);
  }

  /** 接收时固定会话身份与载荷，`flush()` 时统一写出。 */
  private append(
    event: AgentLogEvent,
    diagnostic: { error?: unknown; level?: LogLevel } = {},
  ): void {
    const content: AgentLogContent = {
      kind: "agent",
      ...event,
      runtime_id: this.runtime_id,
      chat_id: this.chat_id,
      ...(this.run === null ? {} : { round_id: this.run.round_id, run_id: this.run.run_id }),
    };
    // 预期工具失败可归为 `info`，控制台输出以最终等级为准。
    const level =
      diagnostic.level ?? ("status" in event && event.status === "error" ? "error" : "info");
    this.pending.push({
      level,
      ...(diagnostic.error === undefined ? {} : { error: to_log_error(diagnostic.error) }),
      source: "agent",
      content,
      targets: {
        console: level === "warning" || level === "error" || level === "fatal",
        window: true,
      },
    });
  }
}

/** 只去掉 agent_tool_result 的可逐字重建副本；网页等独有 details 仍完整保留。 */
export function normalize_agent_tool_log_output(result: {
  content: readonly unknown[];
  details?: unknown;
}): AgentToolLogOutput {
  // 文本块保留原文，图片块仅保留媒体类型，避免诊断日志复制图片字节。
  const content = json_snapshot(
    result.content.map((part) => {
      if (is_json_record(part) && part["type"] === "image")
        return { type: "image", mimeType: part["mimeType"] };
      return part;
    }),
  ) as JsonValue[];
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
