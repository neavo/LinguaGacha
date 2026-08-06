import { scheduler } from "node:timers/promises";

import type { AgentSessionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { is_app_error } from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import type { LogManager } from "../log/log-manager";
import { t_main_log } from "../log/log-text";

type AgentToolFailure = JsonRecord & { code: string };

type AgentToolCallLogRecord =
  | {
      event: "start";
      tool_call_id: string;
      tool_name: string;
      input: unknown;
    }
  | {
      event: "end";
      tool_call_id: string;
      tool_name: string;
      is_error: boolean;
      output: unknown;
    };

/** 模型可见工具错误只承载稳定码和安全修复事实。 */
export class AgentToolError extends Error {
  public readonly details: AgentToolFailure;

  /** Error.message 与 details 共用同一严格 JSON，兼容 SDK 正文与业务测试两种观察面。 */
  public constructor(details: AgentToolFailure, cause?: unknown) {
    super(JsonTool.stringifyStrict(details), cause === undefined ? undefined : { cause });
    this.name = "AgentToolError";
    this.details = details;
  }
}

/** 产品 JSON 工具的模型正文和 details 共用同一严格事实。 */
export function agent_tool_result(details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  };
}

/** AppError 只公开稳定字段，未知异常不向模型泄露内部诊断。 */
function normalize_agent_tool_error(cause: unknown): AgentToolError {
  if (cause instanceof AgentToolError) return cause;
  if (is_app_error(cause)) {
    return new AgentToolError({ code: cause.code, ...cause.public_details }, cause);
  }
  return new AgentToolError({ code: "tool_failed" }, cause);
}

/** 统一保证 SSE 首帧时序，并把非预期执行异常留在应用诊断中。 */
export function wrap_agent_tool_execution(
  tool: ToolDefinition,
  log_manager: Pick<LogManager, "error">,
): ToolDefinition {
  return {
    ...tool,
    execute: async (...args: Parameters<ToolDefinition["execute"]>) => {
      await scheduler.yield();
      try {
        return await tool.execute(...args);
      } catch (cause) {
        if (
          !(cause instanceof AgentToolError) &&
          (!is_app_error(cause) || cause.severity !== "expected")
        ) {
          log_manager.error(t_main_log("app.diagnostic.agent.tool_execution_failed"), {
            source: "agent",
            error: cause,
            context: { tool_call_id: args[0], tool_name: tool.name },
          });
        }
        throw normalize_agent_tool_error(cause);
      }
    },
  };
}

/** SDK 工具起止事件以完整严格 JSON 写入文件，不进入控制台或日志窗口。 */
export function log_agent_tool_event(
  log_manager: Pick<LogManager, "append">,
  event: AgentSessionEvent,
): void {
  let record: AgentToolCallLogRecord;
  let level: "info" | "error";
  if (event.type === "tool_execution_start") {
    record = {
      event: "start",
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      input: event.args,
    };
    level = "info";
  } else if (event.type === "tool_execution_end") {
    record = {
      event: "end",
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      is_error: event.isError,
      output: event.result,
    };
    level = event.isError ? "error" : "info";
  } else {
    return;
  }
  log_manager.append({
    level,
    source: "agent-tool",
    content: { kind: "text", text: JsonTool.stringifyStrict(record) },
    targets: { file: true, console: false, window: false },
  });
}
