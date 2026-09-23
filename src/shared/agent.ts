import type { ModelAgentLimits } from "../domain/model-agent";
import type { JsonRecord } from "../domain/json";
import type { Locale } from "./i18n/types";
/** AgentService 与 renderer 共享的唯一 SSE topic。 */
export const AGENT_SESSION_EVENT_TOPIC = "agent.session_event";

/** 一次工作区链接激活的完成结果；取消是正常交互。 */
export type AgentWorkspaceLinkResult = Readonly<{ status: "saved" | "opened" | "cancelled" }>;

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

/** 当前模型可见历史及其是否存在可压缩的旧段。 */
export type AgentContextSnapshot = JsonRecord & {
  tokens: number | null; // 尚未建立模型历史时为 null
  limits: ModelAgentLimits | null; // 当前会话实际容量，独立于下一轮模型选择
  compactable: boolean; // 后端按当前 SDK 历史判定手动压缩入口是否可用
};

/** 每个时间线条目独立持有结果；会话 state 不再复制轮次终态。 */
export type AgentEntryStatus = "running" | "success" | "error" | "stopped";

/** 当前 Agent 会话任务的工程写入确认方式；默认手动，自动持续到会话重置。 */
export type AgentApprovalMode = "manual" | "auto";

/** 待审批写入的结构化变更摘要；按业务种类统计受影响对象数量。 */
export type AgentPendingWriteSummary = Readonly<{
  pages: number; // 本批实际变化的 PDF 原页数
  items: number;
  glossary: number;
  textPreserve: number;
  preReplacement: number;
  postReplacement: number;
  prompts: number;
}>;

/** ask_user 的固定选项，按推荐顺序排列。 */
export type AgentQuestionOption = JsonRecord & {
  id: string;
  label: string;
};

/** 单题固定选项与自定义入口共同保持在四个可见选择以内。 */
export const AGENT_QUESTION_OPTION_MIN = 2;
export const AGENT_QUESTION_OPTION_MAX = 3;
/** 问题文本限制同时约束模型载荷与决定页布局，后端和 renderer 共用。 */
export const AGENT_QUESTION_PROMPT_LIMIT = 64;
export const AGENT_QUESTION_DESCRIPTION_LIMIT = 96;
export const AGENT_QUESTION_LABEL_LIMIT = 40;

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
        question: AgentQuestion;
      }
    | {
        kind: "write_approval";
        id: string;
        summary: AgentPendingWriteSummary;
      }
  );

/** 单条用户消息最多发送到视觉通道的图片数。 */
export const AGENT_MESSAGE_IMAGE_LIMIT = 10;
/** 当前会话最多保留的待发送输入数；renderer 与 AgentService 共用同一产品上限。 */
export const AGENT_INPUT_QUEUE_LIMIT = 5;
/** 上传成功后的不可变文件记录，路径只由后端生成。 */
export type AgentFileAttachment = JsonRecord & {
  kind: "file";
  uploadId: string; // 后端生成的会话内身份，提交请求只携带此字段
  name: string; // 用户选择时的原名称，用于展示
  path: string; // 工作区相对路径，保存名已规范化
  size: number; // 实际写入的字节数
  imageMimeType: string | null; // 文件头识别出的受支持图片类型，其余文件为 null
};

/** 图片和普通文件共用引用协议，图片字节只在模型发送边界生成。 */
export type AgentMessageAttachment = JsonRecord &
  (AgentFileAttachment | { kind: "response_annotation"; selectedText: string; comment: string });

export type AgentResponseAnnotationAttachment = Extract<
  AgentMessageAttachment,
  { kind: "response_annotation" }
>;

/** Renderer 与公开 message API 共用的完整用户消息；附件数组同时拥有展示顺序。 */
export type AgentMessageInput = JsonRecord & {
  text: string;
  attachments: AgentMessageAttachment[];
};

/** 提交只携带上传身份，展示元数据由后端重新取得。 */
export function agent_message_request(message: AgentMessageInput): JsonRecord {
  return {
    text: message.text,
    attachments: message.attachments.map((attachment) =>
      attachment.kind === "file" ? { kind: "file", uploadId: attachment.uploadId } : attachment,
    ),
  };
}

/** 产品输入队列完全驻留于当前会话内存；sending 表示正在准备或已交给 Pi、尚未确认消费。 */
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

/** 工具终帧按顺序保留文本块原文；数组为空表示没有文本输出，块间排版由前端负责。 */
export type AgentToolEntry = AgentToolEntryBase &
  (
    | { status: "running" | "stopped"; output: null }
    | { status: "success" | "error"; output: string[] }
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
          | {
              delivery: "round";
              status: AgentEntryStatus;
              endedAt: number | null;
              averageTokensPerSecond: number | null; // 终态生成均速，运行中或没有有效统计时为空。
            }
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

/** 当前回合最近的生成速度。等待期间保留，失败继续先展示已有均速，`null` 表示无数据。 */
export type AgentTokenSpeedSnapshot =
  | (JsonRecord & { roundId: string; tokensPerSecond: number })
  | null;

/** 当前产品对话累计的模型用量，历史修订后仍保留已发生的消耗。 */
export type AgentUsageSnapshot = JsonRecord & {
  input: number; // 普通输入，缓存读取和写入分别计数
  output: number; // 包含供应商计入的思考用量
  cacheRead: number; // 命中缓存的输入
  cacheWrite: number; // 写入缓存的输入
};

/** GET snapshot 与 snapshot_seed 共用的完整会话形状。 */
export type AgentSessionSnapshot = JsonRecord & {
  sessionId: string; // 对话重置与工程切换后改变，草稿据此清理旧文件引用。
  revision: number;
  state: AgentSessionState;
  approvalMode: AgentApprovalMode;
  pendingDecision: AgentPendingDecision | null;
  entries: AgentEntry[];
  skills: AgentSkillSnapshot[];
  inputQueue: AgentInputQueueSnapshot;
  todos: string[]; // 当前对话的有序待办；空数组不占用固定展示位
  context: AgentContextSnapshot;
  usage: AgentUsageSnapshot;
  tokenSpeed: AgentTokenSpeedSnapshot;
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
    | { type: "todo"; todos: string[] }
    | { type: "token_speed"; tokenSpeed: AgentTokenSpeedSnapshot }
    | { type: "context"; context: AgentContextSnapshot }
    | { type: "usage"; usage: AgentUsageSnapshot }
    | { type: "snapshot_seed"; snapshot: AgentSessionSnapshot }
  );

/** SSE 以单调 revision 排序；重复、旧帧与缺口由 renderer 显式处理。 */
export type AgentSessionEvent = AgentSessionEventPayload & { revision: number };

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

/** 请求通过上传身份解析文件，快照边界校验后端返回的完整记录。 */
export function normalize_agent_message_input(
  value: unknown,
  resolve_file?: (id: string) => AgentFileAttachment,
): AgentMessageInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["text"] !== "string" || !Array.isArray(record["attachments"])) return null;
  const text = record["text"].trim();
  const attachments: AgentMessageAttachment[] = [];
  for (const attachment of record["attachments"]) {
    if (typeof attachment !== "object" || attachment === null || Array.isArray(attachment)) {
      return null;
    }
    const attachment_record = attachment as Record<string, unknown>;
    if (attachment_record["kind"] === "file") {
      const id = attachment_record["uploadId"];
      if (typeof id !== "string" || id === "") return null;
      if (resolve_file !== undefined) attachments.push(resolve_file(id));
      else {
        const { name, path, size, imageMimeType } = attachment_record;
        if (
          typeof name !== "string" ||
          typeof path !== "string" ||
          typeof size !== "number" ||
          !Number.isSafeInteger(size) ||
          size < 0 ||
          (imageMimeType !== null && typeof imageMimeType !== "string")
        )
          return null;
        attachments.push({ kind: "file", uploadId: id, name, path, size, imageMimeType });
      }
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
export function normalize_agent_revision_request(
  value: unknown,
  resolve_file?: (id: string) => AgentFileAttachment,
): AgentRevisionRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entry_id = record["entryId"];
  const message = normalize_agent_message_input(record["message"], resolve_file);
  return typeof entry_id !== "string" || entry_id === "" || message === null
    ? null
    : { entryId: entry_id, message };
}
