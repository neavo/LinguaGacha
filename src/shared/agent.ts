import type { JsonRecord } from "../domain/json";
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

/** Assistant 可见正文保持供应商确认的 text / thinking 顺序，不公开思考签名。 */
export type AgentAssistantMessagePart = JsonRecord &
  ({ kind: "text"; text: string } | { kind: "thinking"; text: string });

/** 会话只表达当前是否占用运行时；每轮与每个条目的结果由自身 status 持有。 */
export type AgentSessionState = "idle" | "running";

/** 每个时间线条目独立持有结果；会话 state 不再复制轮次终态。 */
export type AgentEntryStatus = "running" | "success" | "error" | "stopped";

type AgentToolEntryBase = JsonRecord & {
  kind: "tool_call";
  id: string;
  toolName: string;
  input: string;
  createdAt: number;
};

/** 工具条目冻结完整输入；只有 SDK 工具终帧能产生带文本输出的成功或失败终态。 */
export type AgentToolEntry = AgentToolEntryBase &
  (
    | { status: "running" | "stopped"; output: null }
    | { status: "success" | "error"; output: string }
  );

/** 上下文压缩沿用时间线条目状态；压缩不可停止，因此不公开 stopped。 */
export type AgentContextCompactionEntry = JsonRecord & {
  kind: "context_compaction";
  id: string;
  status: Extract<AgentEntryStatus, "running" | "success" | "error">;
  createdAt: number;
};

/** 后端按真实事件顺序追加，renderer 直接按数组渲染的单一时间线条目。 */
export type AgentEntry = JsonRecord &
  (
    | {
        kind: "user_message";
        id: string;
        text: string;
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
    | AgentContextCompactionEntry
  );

/** GET snapshot、命令响应与 snapshot_seed 共用的完整会话形状。 */
export type AgentSessionSnapshot = JsonRecord & {
  state: AgentSessionState;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  contextTokens: number | null; // 当前模型可见历史的估算用量
};

/** SSE 以完整条目按 id 覆盖，重复帧天然幂等；断线时由 snapshot_seed 或 GET 恢复。 */
export type AgentSessionEvent = JsonRecord &
  (
    | { type: "entry_upsert"; entry: AgentEntry }
    | { type: "session_state"; state: AgentSessionState }
    | { type: "context_tokens"; contextTokens: number }
    | { type: "snapshot_seed"; snapshot: AgentSessionSnapshot }
  );

/** API、SSE 与 renderer 存储共用的用户正文边界，只裁剪整条消息外缘。 */
export function normalize_agent_user_message_text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** 生成不会随 UI locale 改变的显式能力 marker。 */
export function format_agent_skill_reference(name: string): string {
  return `@skill(${name})`;
}

/** 生成只供模型阅读、不触发宿主解析的术语 marker。 */
export function format_agent_term_reference(src: string): string {
  return `@term(${src})`;
}
