import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { TSchema } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import { is_app_error, type AppError } from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";

/** 工具直接采用 durable 的参数与调用上下文；副作用默认不可安全重放。 */
export function define_agent_tool<TParams extends TSchema, TDetails extends JsonValue = JsonValue>(
  definition: ToolRegistration<TParams, TDetails>,
) {
  const parameters = definition.parameters as unknown as JsonRecord; // 根 Schema 只校验模型可见的 JSON 字段
  if (
    parameters["type"] !== "object" ||
    parameters["anyOf"] !== undefined ||
    parameters["oneOf"] !== undefined ||
    parameters["allOf"] !== undefined
  ) {
    throw new Error(
      `Agent tool "${definition.name}" parameters must use a plain object root schema`,
    );
  }
  // 产品工具已经拥有输出额度；SDK 再次裁剪会破坏结构化 JSON 和图片说明。
  return defineTool({
    replay: "unsafe",
    outputLimits: { maxBytes: Number.MAX_SAFE_INTEGER, maxLines: Number.MAX_SAFE_INTEGER },
    ...definition,
  });
}

type AgentToolFailure = JsonRecord & { code: string };

/** 模型可见工具错误只承载稳定码和安全修复事实。 */
export class AgentToolError extends Error {
  public readonly details: AgentToolFailure;

  /** Error.message 与 details 共用同一严格 JSON，兼容 SDK 正文与业务测试两种观察面。 */
  public constructor(
    details: AgentToolFailure,
    cause?: unknown,
    public readonly severity: AppError["severity"] = "expected", // 诊断等级只供宿主使用，不进入模型回执
  ) {
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
export function normalize_agent_tool_error(cause: unknown): AgentToolError {
  if (cause instanceof AgentToolError) return cause;
  if (is_app_error(cause)) {
    return new AgentToolError({ code: cause.code, ...cause.public_details }, cause, cause.severity);
  }
  return new AgentToolError({ code: "tool_failed" }, cause, "fault");
}

/** 取消必须对应调用信号或明确取消码，停止期间的其它故障仍属于失败。 */
export function is_agent_cancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true &&
    (error === signal.reason ||
      (error instanceof Error && error.name === "AbortError" && error.cause === signal.reason) ||
      (is_app_error(error) &&
        (error.code === "runtime.cancelled" ||
          (error.code === "request.validation_failed" &&
            error.diagnostic_context["reason"] === "agent_message_invalidated"))))
  );
}
