import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { is_json_record } from "../../domain/json";
import {
  normalize_agent_assistant_message_parts,
  type AgentAssistantMessagePart,
  type AgentAssistantMessageParts,
  type AgentEntryStatus,
} from "../../shared/agent";

/** 日志与时间线共用 SDK 结果状态，取消由已提交的诊断码证明。 */
export function read_agent_tool_result_status(
  record: Pick<EntryRecord, "data">,
  message: Pick<ToolResultMessage, "isError">,
): Exclude<AgentEntryStatus, "running"> {
  const diagnostics = is_json_record(record.data) ? record.data["diagnostics"] : undefined;
  if (
    Array.isArray(diagnostics) &&
    diagnostics.some((value) => is_json_record(value) && value["code"] === "aborted")
  )
    return "stopped";
  return message.isError ? "error" : "success";
}

/** 时间线与日志共用可见正文边界，思考签名、脱敏块和工具参数由各自协议拥有。 */
export function project_assistant_message_parts(
  message: AssistantMessage,
): AgentAssistantMessageParts | null {
  const parts: AgentAssistantMessagePart[] = [];
  for (const content of message.content) {
    if (content.type === "text") parts.push({ kind: "text", text: content.text });
    else if (content.type === "thinking" && !content.redacted)
      parts.push({ kind: "thinking", text: content.thinking });
  }
  return normalize_agent_assistant_message_parts(parts);
}
