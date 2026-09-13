import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  normalize_agent_assistant_message_parts,
  type AgentAssistantMessagePart,
  type AgentAssistantMessageParts,
} from "../../shared/agent";

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
