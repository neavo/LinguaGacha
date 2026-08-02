import { is_json_record, type JsonRecord } from "../domain/json";
import type { Locale } from "./i18n/types";

/** AgentService 与 renderer 共享的唯一 SSE topic。 */
export const AGENT_SESSION_EVENT_TOPIC = "agent.session_event";

/** skill 展示描述是按应用支持语言补全的 UI 值，不参与模型能力判断。 */
export type AgentSkillDisplayDescriptions = JsonRecord & Record<Locale, string>;

/** 启动期 skill 清单只公开能力选择所需的稳定名称与 UI 描述。 */
export type AgentSkillSnapshot = JsonRecord & {
  name: string;
  displayDescriptions: AgentSkillDisplayDescriptions;
};

/** 用户可见消息的唯一正文形状；skill part 表示用户显式强制调用能力。 */
export type AgentUserMessagePart = JsonRecord &
  ({ kind: "text"; text: string } | { kind: "skill"; name: string });

/** Assistant 可见正文保持供应商确认的 text / thinking 顺序，不公开思考签名。 */
export type AgentAssistantMessagePart = JsonRecord &
  ({ kind: "text"; text: string } | { kind: "thinking"; text: string });

/** 会话只表达当前是否占用运行时；每轮与每个条目的结果由自身 status 持有。 */
export type AgentSessionState = "idle" | "running";

/** 每个时间线条目独立持有结果；会话 state 不再复制轮次终态。 */
export type AgentEntryStatus = "running" | "success" | "error" | "stopped";

/** 当前模型可见上下文的 token 估算与窗口容量。 */
export type AgentContextUsage = JsonRecord & {
  tokens: number; // 当前模型可见历史的估算用量
  contextWindow: number; // 当前对话冻结的上下文总容量
  maxTokens: number; // 当前对话冻结的单次输出上限
};

/** 工具条目保留原始工具名与模型实际收到的完整文本输出；参数不进入公开会话。 */
export type AgentToolEntry = JsonRecord & {
  kind: "tool_call";
  id: string;
  toolName: string;
  status: AgentEntryStatus;
  output: string | null;
  createdAt: number;
};

/** 后端按真实事件顺序追加，renderer 直接按数组渲染的单一时间线条目。 */
export type AgentEntry = JsonRecord &
  (
    | {
        kind: "user_message";
        id: string;
        parts: AgentUserMessagePart[];
        status: AgentEntryStatus;
        createdAt: number;
        endedAt: number | null;
      }
    | {
        kind: "assistant_message";
        id: string;
        parts: AgentAssistantMessagePart[];
        status: AgentEntryStatus;
        createdAt: number;
      }
    | AgentToolEntry
  );

/** GET snapshot、命令响应与 snapshot_seed 共用的完整会话形状。 */
export type AgentSessionSnapshot = JsonRecord & {
  state: AgentSessionState;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  contextUsage: AgentContextUsage | null;
};

/** SSE 以完整条目按 id 覆盖，重复帧天然幂等；断线时由 snapshot_seed 或 GET 恢复。 */
export type AgentSessionEvent = JsonRecord &
  (
    | { type: "entry_upsert"; entry: AgentEntry }
    | { type: "session_state"; state: AgentSessionState }
    | { type: "context_usage"; contextUsage: AgentContextUsage }
    | { type: "snapshot_seed"; snapshot: AgentSessionSnapshot }
  );

/**
 * 在 API 与 SSE 两个不可信 JSON 边界统一收窄 parts，并建立无空文本、无相邻文本的规范形状。
 */
export function normalize_agent_user_message_parts(value: unknown): AgentUserMessagePart[] | null {
  if (!Array.isArray(value)) return null;
  const parts: AgentUserMessagePart[] = [];
  for (const value_part of value) {
    if (!is_json_record(value_part)) return null;
    if (value_part["kind"] === "text" && typeof value_part["text"] === "string") {
      if (value_part["text"] === "") continue;
      const previous = parts.at(-1);
      if (previous?.kind === "text") previous.text += value_part["text"];
      else parts.push({ kind: "text", text: value_part["text"] });
      continue;
    }
    if (
      value_part["kind"] === "skill" &&
      typeof value_part["name"] === "string" &&
      value_part["name"] !== "" &&
      value_part["name"].trim() === value_part["name"]
    ) {
      parts.push({ kind: "skill", name: value_part["name"] });
      continue;
    }
    return null;
  }
  return parts;
}

/** 把结构化消息投影为用户看到的纯文本；该投影不是能力执行判据。 */
export function format_agent_user_message_text(parts: readonly AgentUserMessagePart[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : `@${part.name}`)).join("");
}
