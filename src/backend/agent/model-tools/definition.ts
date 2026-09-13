import { scheduler } from "node:timers/promises";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../../domain/json";
import { is_app_error } from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import type { LogManager } from "../../log/log-manager";
import { t_main_log } from "../../log/log-text";

type AgentToolFailure = JsonRecord & { code: string };

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

/** 统一校验模型参数根、保证 SSE 首帧时序，并把非预期执行异常留在应用诊断中。 */
export function prepare_agent_tool(
  tool: ToolDefinition,
  log_manager: Pick<LogManager, "error">,
): ToolDefinition {
  const parameters = tool.parameters as unknown as JsonRecord; // TypeBox symbol 元数据不参与模型可见根结构判断
  if (
    parameters["type"] !== "object" ||
    parameters["anyOf"] !== undefined ||
    parameters["oneOf"] !== undefined ||
    parameters["allOf"] !== undefined
  ) {
    throw new Error(`Agent tool "${tool.name}" parameters must use a plain object root schema`);
  }
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
