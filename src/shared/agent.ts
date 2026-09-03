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

/** 公开 assistant 条目使用非空元组；内容可见性由共享归一化入口保证。 */
export type AgentAssistantMessageParts = [
  AgentAssistantMessagePart,
  ...AgentAssistantMessagePart[],
];

/** 会话只表达当前是否占用运行时；每轮与每个条目的结果由自身 status 持有。 */
export type AgentSessionState = "idle" | "running";

/** 每个时间线条目独立持有结果；会话 state 不再复制轮次终态。 */
export type AgentEntryStatus = "running" | "success" | "error" | "stopped";

/** 当前 Agent 会话任务的工程写入确认方式；默认手动，自动持续到会话重置。 */
export type AgentApprovalMode = "manual" | "auto";

/** 待审批写入的结构化变更摘要；按业务种类统计受影响对象数量。 */
export type AgentPendingWriteSummary = Readonly<{
  items: number;
  glossary: number;
  textPreserve: number;
  preReplacement: number;
  postReplacement: number;
  prompts: number;
}>;

/** ask_user 的固定选项；数组顺序只表达推荐展示顺序。 */
export type AgentQuestionOption = JsonRecord & {
  id: string;
  label: string;
};

/** 用户决定固定等待五分钟；后端裁决与 renderer 期限进度共用。 */
export const AGENT_DECISION_TIMEOUT_MS = 5 * 60 * 1_000;

/** 单题固定选项与自定义入口共同保持在四个可见选择以内。 */
export const AGENT_QUESTION_OPTION_MIN = 2;
export const AGENT_QUESTION_OPTION_MAX = 3;

/** 单次工具调用只提出一个问题和二至三个固定选项，自定义答案由 renderer 提供。 */
export type AgentQuestion = JsonRecord & {
  prompt: string;
  description?: string;
  options:
    | [AgentQuestionOption, AgentQuestionOption]
    | [AgentQuestionOption, AgentQuestionOption, AgentQuestionOption];
};

/** Renderer 对当前问题的一次性决定；固定选项、自定义文本与取消互斥。 */
export type AgentQuestionResponse = JsonRecord &
  ({ kind: "option"; optionId: string } | { kind: "custom"; text: string } | { kind: "cancel" });

/** 写入授权使用固定的三种结果，不与普通问题答案共用权限入口。 */
export type AgentWriteApprovalDecision = "reject" | "allow_once" | "allow_session";

/** 当前 Agent 回合至多持有一个需要用户介入的决定。 */
export type AgentPendingDecision = JsonRecord &
  (
    | {
        kind: "question";
        id: string;
        expiresAt: number;
        question: AgentQuestion;
      }
    | {
        kind: "write_approval";
        id: string;
        expiresAt: number;
        summary: AgentPendingWriteSummary;
      }
  );

/** 单条用户消息按输入顺序最多保留的图片数。 */
export const AGENT_MESSAGE_IMAGE_LIMIT = 10;
/** 当前会话最多保留的待发送输入数；renderer 与 AgentService 共用同一产品上限。 */
export const AGENT_INPUT_QUEUE_LIMIT = 5;
/** 用户消息附件只有 renderer 归一的 WebP 与已确认的回复批注两种公开形状。 */
export type AgentMessageAttachment = JsonRecord &
  (
    | { kind: "image"; webpBase64: string }
    | { kind: "response_annotation"; selectedText: string; comment: string }
  );

export type AgentResponseAnnotationAttachment = Extract<
  AgentMessageAttachment,
  { kind: "response_annotation" }
>;

/** Renderer 与公开 message API 共用的完整用户消息；附件数组同时拥有展示顺序。 */
export type AgentMessageInput = JsonRecord & {
  text: string;
  attachments: AgentMessageAttachment[];
};

/** 产品输入队列完全驻留于当前会话内存；sending 表示已交给 Pi、尚未确认消费。 */
export type AgentQueuedInput = AgentMessageInput & {
  id: string;
  status: "queued" | "sending";
  createdAt: number;
};

/** paused 只阻止自动续取；canSendNow 表示当前运行时已经到达 Pi 可 steer 的阶段。 */
export type AgentInputQueueSnapshot = JsonRecord & {
  paused: boolean;
  canSendNow: boolean;
  items: AgentQueuedInput[];
};

/** 最新轮次修订同时携带目标身份与完整替换内容。 */
export type AgentRevisionRequest = JsonRecord & {
  entryId: string;
  message: AgentMessageInput;
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

/** round 与 steer 共用的不可变用户消息字段。 */
type AgentUserEntryBase = AgentMessageInput & {
  kind: "user_message";
  id: string;
  createdAt: number;
};

/** 后端按真实事件顺序追加，renderer 直接按数组渲染的单一时间线条目。 */
export type AgentEntry = JsonRecord &
  (
    | (AgentUserEntryBase &
        (
          | { delivery: "round"; status: AgentEntryStatus; endedAt: number | null }
          | { delivery: "steer"; status: "success"; endedAt: number }
        ))
    | {
        kind: "assistant_message";
        id: string;
        parts: AgentAssistantMessageParts;
        status: AgentEntryStatus;
        createdAt: number;
      }
    | AgentToolEntry
    | AgentContextCompactionEntry
  );

/** GET snapshot 与 snapshot_seed 共用的完整会话形状。 */
export type AgentSessionSnapshot = JsonRecord & {
  revision: number;
  state: AgentSessionState;
  approvalMode: AgentApprovalMode;
  pendingDecision: AgentPendingDecision | null;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  inputQueue: AgentInputQueueSnapshot;
  taskProgress: string[]; // 当前动态队列的全部待办标签；空数组不占用固定展示位
  contextTokens: number | null; // 当前模型可见历史的估算用量
};

/** 写命令只确认后端受理到的事件边界，公开事实继续由事件同步。 */
export type AgentCommandAck = Readonly<{
  revision: number;
}>;

/** AgentService 发布前的事件事实；单调 revision 只由统一发布入口分配。 */
export type AgentSessionEventPayload = JsonRecord &
  (
    | { type: "entry_upsert"; entry: AgentEntry }
    | { type: "session_state"; state: AgentSessionState }
    | { type: "approval_mode"; approvalMode: AgentApprovalMode }
    | { type: "pending_decision"; pendingDecision: AgentPendingDecision | null }
    | { type: "input_queue"; inputQueue: AgentInputQueueSnapshot }
    | { type: "task_progress"; taskProgress: string[] }
    | { type: "context_tokens"; contextTokens: number }
    | { type: "snapshot_seed"; snapshot: AgentSessionSnapshot }
  );

/** SSE 以单调 revision 排序；重复、旧帧与缺口由 renderer 显式处理。 */
export type AgentSessionEvent = AgentSessionEventPayload & { revision: number };

/** Agent marker 的稳定字面量范围；前后端共用同一转义与重叠规则。 */
export type AgentReferenceRange = Readonly<{
  from: number;
  to: number;
  marker: string;
}>;

/** 校验公开 assistant parts，删除纯空白并合并相邻同类，同时保留可见正文原值。 */
export function normalize_agent_assistant_message_parts(
  value: unknown,
): AgentAssistantMessageParts | null {
  if (!Array.isArray(value)) return null;
  const parts: AgentAssistantMessagePart[] = [];
  for (const value_part of value) {
    if (typeof value_part !== "object" || value_part === null || Array.isArray(value_part)) {
      return null;
    }
    const record = value_part as Record<string, unknown>;
    const kind = record["kind"];
    const text = record["text"];
    if ((kind !== "text" && kind !== "thinking") || typeof text !== "string") return null;
    if (text.trim() === "") continue;
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  }
  const [first, ...rest] = parts;
  return first === undefined ? null : [first, ...rest];
}

/** API、SSE 与 renderer 存储共用的用户正文边界，只裁剪整条消息外缘。 */
export function normalize_agent_user_message_text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** 完整消息允许纯附件；按顺序规范两种附件，并忽略图片上限之外的图片。 */
export function normalize_agent_message_input(value: unknown): AgentMessageInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["text"] !== "string" || !Array.isArray(record["attachments"])) return null;
  const text = record["text"].trim();
  const attachments: AgentMessageAttachment[] = [];
  let image_count = 0;
  for (const attachment of record["attachments"]) {
    if (typeof attachment !== "object" || attachment === null || Array.isArray(attachment)) {
      return null;
    }
    const attachment_record = attachment as Record<string, unknown>;
    if (attachment_record["kind"] === "image") {
      if (image_count >= AGENT_MESSAGE_IMAGE_LIMIT) continue;
      if (typeof attachment_record["webpBase64"] !== "string") return null;
      const webp_base64 = attachment_record["webpBase64"].trim();
      if (webp_base64 === "") return null;
      attachments.push({ kind: "image", webpBase64: webp_base64 });
      image_count += 1;
      continue;
    }
    if (attachment_record["kind"] === "response_annotation") {
      if (
        typeof attachment_record["selectedText"] !== "string" ||
        typeof attachment_record["comment"] !== "string"
      ) {
        return null;
      }
      const selected_text = attachment_record["selectedText"].trim();
      const comment = attachment_record["comment"].trim();
      if (selected_text === "") return null;
      attachments.push({ kind: "response_annotation", selectedText: selected_text, comment });
      continue;
    }
    return null;
  }
  return text === "" && attachments.length === 0 ? null : { text, attachments };
}

/** 修订请求复用完整消息边界，assistant 的纯文本限制由拥有角色事实的后端校验。 */
export function normalize_agent_revision_request(value: unknown): AgentRevisionRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entry_id = record["entryId"];
  const message = normalize_agent_message_input(record["message"]);
  return typeof entry_id !== "string" || entry_id === "" || message === null
    ? null
    : { entryId: entry_id, message };
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
