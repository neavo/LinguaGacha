import type { JsonRecord } from "../../domain/json";
import { is_app_error } from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";

/** 模型可见工具错误只承载稳定码和安全修复事实。 */
export class AgentToolError extends Error {
  public readonly details: JsonRecord;

  /** Error.message 与 details 共用同一严格 JSON，兼容 SDK 正文与业务测试两种观察面。 */
  public constructor(details: JsonRecord, cause?: unknown) {
    super(JsonTool.stringifyStrict(details), cause === undefined ? undefined : { cause });
    this.name = "AgentToolError";
    this.details = details;
  }
}

/** 统一保留 AppError 的公开细节，未知错误只暴露原始消息。 */
export function normalize_agent_tool_error(cause: unknown): AgentToolError {
  if (cause instanceof AgentToolError) return cause;
  if (is_app_error(cause)) {
    return new AgentToolError({ code: cause.code, ...cause.public_details }, cause);
  }
  return new AgentToolError(
    {
      code: "tool_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    },
    cause,
  );
}
