import type { Model, Api, AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  calculateContextTokens,
  estimateMessageTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import type { ContextView } from "@earendil-works/pi-durable";
import type { AgentContextSnapshot } from "../../shared/agent";

export const AGENT_KEEP_RECENT_TOKENS = 32_000;

/** 条目身份决定用量是否覆盖当前前缀。时间戳相同的摘要与响应也不会误用旧用量。 */
export function read_agent_chat_context(
  view: ContextView,
  model: Model<Api> | null,
  keepRecentTokens = AGENT_KEEP_RECENT_TOKENS,
): AgentContextSnapshot {
  const measured = read_measured_message(view);
  const from = measured === undefined ? 0 : view.messages.lastIndexOf(measured) + 1;
  const tokens =
    (measured === undefined ? 0 : calculateContextTokens(measured.usage)) +
    estimate_agent_messages(view.messages.slice(from));
  const tail = Math.max(0, ...view.entries.map((entry) => entry.id));
  return {
    tokens,
    compactable:
      estimate_agent_messages(view.messages) > keepRecentTokens && tail !== view.head?.id,
    limits:
      model === null
        ? null
        : { context_window: model.contextWindow, max_output_tokens: model.maxTokens },
  };
}

/** SDK 的消息估算同时用于请求样本和动态保留预算，避免两套估算公式。 */
function estimate_agent_messages(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

/** 会话用正常响应校准 SDK 的估算单位，摘要和截断响应沿用最近的有效比例。 */
export class AgentContextBudget {
  private ratio = 1; // 同一请求与响应的供应商用量除以 SDK 估算量
  private modelKey = ""; // 供应商、模型和 API 共同决定校准身份
  private conversationId: number | undefined; // 分支切换后重建当前前缀的样本
  private request: { taskId: number; tokens: number } | undefined; // 生成串行，重试覆盖未返回的样本

  /** SDK 触发使用 `usage`，切点使用字符估算，保留目标须换算为切点单位。 */
  public get keepRecentTokens(): number {
    return Math.max(1, Math.floor(AGENT_KEEP_RECENT_TOKENS / this.ratio));
  }

  /** 同一模型的容量调整保留比例，计量身份变化时清除旧样本。 */
  public configure(model: Pick<Model<Api>, "provider" | "id" | "api">): void {
    const key = `${model.provider}/${model.id}/${model.api}`;
    if (key === this.modelKey) return;
    this.modelKey = key;
    this.ratio = 1;
    this.request = undefined;
  }

  /** 捕获实际发出的请求，响应仅与同一任务的最新尝试配对。 */
  public before_request(taskId: number, messages: readonly Message[]): void {
    this.request = { taskId, tokens: estimate_agent_messages(messages) };
  }

  /** 正常响应更新比例，异常响应只释放样本，供恢复压缩沿用旧比例。 */
  public after_response(taskId: number, message: AssistantMessage): void {
    const request = this.request;
    if (request?.taskId !== taskId) return;
    this.request = undefined;
    if (message.stopReason === "stop" || message.stopReason === "toolUse")
      this.update(
        calculateContextTokens(message.usage),
        request.tokens + estimateMessageTokens(message),
      );
  }

  /** 恢复采用当前分支的有效前缀。编辑使旧总量失效时，运行比例仍可作近似参考。 */
  public restore(view: ContextView, model: Model<Api> | null, conversationId: number): void {
    // 初始化和切换分支/模型才重建，异步快照不能覆盖刚完成响应的比例。
    const sameModel =
      model === null || `${model.provider}/${model.id}/${model.api}` === this.modelKey;
    if (this.conversationId === conversationId && sameModel) return;
    const message = read_measured_message(view, model ?? undefined, true);
    if (model !== null) this.configure(model);
    else if (message !== undefined)
      this.configure({ provider: message.provider, id: message.model, api: message.api });
    if (this.conversationId !== conversationId) {
      this.conversationId = conversationId;
      this.ratio = 1;
      this.request = undefined;
    }
    if (message !== undefined)
      this.update(
        calculateContextTokens(message.usage),
        estimate_agent_messages(view.messages.slice(0, view.messages.lastIndexOf(message) + 1)),
      );
  }

  /** 缺失或非有限用量不能替换最近的有效样本。 */
  private update(usage: number, estimate: number): void {
    const ratio = usage / estimate;
    if (usage > 0 && estimate > 0 && Number.isFinite(ratio)) this.ratio = ratio;
  }
}

/** 后续编辑只有触及已计量前缀才使 usage 失效，时间戳相同也依靠条目身份判断。 */
function read_measured_message(
  view: ContextView,
  model?: Model<Api>,
  normalOnly = false,
): AssistantMessage | undefined {
  const boundary = view.head?.id ?? 0;
  let firstEdited = Number.POSITIVE_INFINITY; // 后续编辑触及的最早身份，其后的响应覆盖了失效前缀
  for (let i = view.entries.length - 1; i >= 0; i--) {
    const entry = view.entries[i]!;
    // 倒序累计编辑目标，单次扫描排除失效响应，较早且未覆盖编辑目标的响应仍可使用。
    for (const edit of entry.edits ?? []) firstEdited = Math.min(firstEdited, edit.target);
    if (entry.id <= boundary || entry.id >= firstEdited) continue;
    const message = view.contributions[i]?.findLast(
      (message): message is AssistantMessage =>
        message.role === "assistant" &&
        calculateContextTokens(message.usage) > 0 &&
        (!normalOnly || message.stopReason === "stop" || message.stopReason === "toolUse") &&
        (model === undefined ||
          (message.model === model.id &&
            message.provider === model.provider &&
            message.api === model.api)),
    );
    if (message !== undefined) return message;
  }
  return undefined;
}
