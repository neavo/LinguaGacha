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

/** 单条用户消息按输入顺序最多保留的图片数。 */
export const AGENT_MESSAGE_IMAGE_LIMIT = 10;

/** Renderer、公开 API 与重试入口共用的完整用户消息。图片固定为 WebP 原始 base64。 */
export type AgentMessageInput = JsonRecord & {
  text: string;
  images: string[];
};

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
        images: string[];
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

/** Agent marker 的稳定字面量范围；前后端共用同一转义与重叠规则。 */
export type AgentReferenceRange = Readonly<{
  from: number;
  to: number;
  marker: string;
}>;

/** API、SSE 与 renderer 存储共用的用户正文边界，只裁剪整条消息外缘。 */
export function normalize_agent_user_message_text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** 完整消息允许纯图片，但文本与图片不能同时为空；超出数量上限的图片按顺序静默忽略。 */
export function normalize_agent_message_input(value: unknown): AgentMessageInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["text"] !== "string" || !Array.isArray(record["images"])) return null;
  const text = record["text"].trim();
  const images = record["images"]
    .slice(0, AGENT_MESSAGE_IMAGE_LIMIT)
    .map((image) => (typeof image === "string" ? image.trim() : ""));
  if (images.some((image) => image === "") || (text === "" && images.length === 0)) return null;
  return { text, images };
}

/** 生成不会随 UI locale 改变的显式能力 marker。 */
export function format_agent_skill_reference(name: string): string {
  return `@skill(${name})`;
}

/** 生成只供模型阅读、不触发宿主解析的术语 marker。 */
export function format_agent_term_reference(src: string): string {
  return `@term(${src})`;
}

/** 找出未被反斜线转义的 marker；重叠时由较长 marker 优先占用范围。 */
export function find_agent_reference_ranges(
  text: string,
  markers: readonly string[],
): AgentReferenceRange[] {
  const ranges: AgentReferenceRange[] = [];
  const ordered_markers = [...new Set(markers)].sort((left, right) => right.length - left.length);
  for (const marker of ordered_markers) {
    let from = text.indexOf(marker);
    while (from >= 0) {
      const to = from + marker.length;
      if (
        !agent_reference_is_escaped(text, from) &&
        !ranges.some((range) => from < range.to && to > range.from)
      ) {
        ranges.push({ from, to, marker });
      }
      from = text.indexOf(marker, to);
    }
  }
  return ranges.sort((left, right) => left.from - right.from);
}

/** 奇数个连续反斜线转义 marker，偶数个仍表示一次真实引用。 */
function agent_reference_is_escaped(text: string, from: number): boolean {
  let slash_count = 0;
  for (let index = from - 1; index >= 0 && text[index] === "\\"; index -= 1) slash_count += 1;
  return slash_count % 2 === 1;
}
