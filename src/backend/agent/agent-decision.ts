import { is_json_record, type JsonRecord } from "../../domain/json";
import type { Model } from "../../domain/model";
import type {
  AgentPendingDecision,
  AgentPendingWriteSummary,
  AgentQuestion,
  AgentQuestionResponse,
  AgentWriteApprovalDecision,
  AgentTranslationRequest,
} from "../../shared/agent";
import { AGENT_DECISION_TIMEOUT_MS } from "../../shared/agent";
import * as AppErrors from "../../shared/error";

/** ask_user 返回模型轮次的结构化结果，不进入公开 user 消息。 */
export type AgentQuestionResult = JsonRecord &
  (
    | { outcome: "selected"; optionId: string }
    | { outcome: "custom"; text: string }
    | { outcome: "unanswered"; reason: "cancelled" | "expired" }
  );

export type AgentTranslationDecisionResult =
  | { status: "accepted"; model: Model }
  | { status: "not_started"; reason: "cancelled" | "expired" };

/** 决定共用的计时与取消资源；各自结果保持窄类型。 */
type PendingDecisionLifecycle = {
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal: AbortSignal | undefined;
  on_abort: () => void;
};

type PendingQuestion = PendingDecisionLifecycle & {
  public: Extract<AgentPendingDecision, { kind: "question" }>;
  resolve: (result: AgentQuestionResult) => void;
};

type PendingWriteApproval = PendingDecisionLifecycle & {
  public: Extract<AgentPendingDecision, { kind: "write_approval" }>;
  resolve: (decision: AgentWriteApprovalDecision) => void;
};

type PendingTranslation = PendingDecisionLifecycle & {
  public: Extract<AgentPendingDecision, { kind: "batch_translation" }>;
  resolve: (result: AgentTranslationDecisionResult) => void;
  accept: (provider_id: string) => Model; // 同步解析并保存后端配置，失败保留当前决定
};

type PendingDecision = PendingQuestion | PendingWriteApproval | PendingTranslation;

/**
 * 单个 Agent 会话的用户决策协调器；统一拥有期限、竞态、取消与公开 pending 状态。
 */
export class AgentDecisionCoordinator {
  private pending: PendingDecision | null = null; // 当前会话唯一等待项，也是计时与取消资源的所有者

  /** 状态变化由 AgentService 投影为 SSE 与输入能力快照。 */
  public constructor(private readonly on_change: () => void) {}

  /** 返回当前决定的不可变公开投影，避免调用方持有协调器内部引用。 */
  public read_pending(): AgentPendingDecision | null {
    return this.pending === null ? null : structuredClone(this.pending.public);
  }

  /** 服务层只需知道决定是否占用当前会话，不感知具体结果类型。 */
  public get has_pending(): boolean {
    return this.pending !== null;
  }

  /** 发布普通问题，并把裁决结果留在原工具 Promise 中。 */
  public wait_for_question(
    tool_call_id: string,
    question: AgentQuestion,
    signal: AbortSignal | undefined,
  ): Promise<AgentQuestionResult> {
    this.assert_available(signal);
    const public_decision: Extract<AgentPendingDecision, { kind: "question" }> = {
      kind: "question",
      id: tool_call_id,
      expiresAt: Date.now() + AGENT_DECISION_TIMEOUT_MS,
      question: structuredClone(question),
    };
    return new Promise<AgentQuestionResult>((resolve, reject) => {
      let pending!: PendingQuestion;
      const on_abort = () => this.abort(pending);
      const timer = setTimeout(
        () =>
          this.settle(pending, {
            outcome: "unanswered",
            reason: "expired",
          }),
        AGENT_DECISION_TIMEOUT_MS,
      );
      pending = { public: public_decision, resolve, reject, timer, signal, on_abort };
      signal?.addEventListener("abort", on_abort, { once: true });
      this.pending = pending;
      this.on_change();
    });
  }

  /** 发布写入授权，并把超时归一为拒绝。 */
  public wait_for_write_approval(
    tool_call_id: string,
    summary: AgentPendingWriteSummary,
    signal: AbortSignal | undefined,
  ): Promise<AgentWriteApprovalDecision> {
    this.assert_available(signal);
    const public_decision: Extract<AgentPendingDecision, { kind: "write_approval" }> = {
      kind: "write_approval",
      id: tool_call_id,
      expiresAt: Date.now() + AGENT_DECISION_TIMEOUT_MS,
      summary: structuredClone(summary),
    };
    return new Promise<AgentWriteApprovalDecision>((resolve, reject) => {
      let pending!: PendingWriteApproval;
      const on_abort = () => this.abort(pending);
      const timer = setTimeout(() => this.settle(pending, "reject"), AGENT_DECISION_TIMEOUT_MS);
      pending = { public: public_decision, resolve, reject, timer, signal, on_abort };
      signal?.addEventListener("abort", on_abort, { once: true });
      this.pending = pending;
      this.on_change();
    });
  }

  /** 翻译启动决定复用固定期限和上游取消生命周期。 */
  public wait_for_translation(
    tool_call_id: string,
    translation: AgentTranslationRequest,
    signal: AbortSignal,
    accept: PendingTranslation["accept"],
  ): Promise<AgentTranslationDecisionResult> {
    this.assert_available(signal);
    return new Promise((resolve, reject) => {
      let pending!: PendingTranslation;
      const on_abort = () => this.abort(pending);
      const timer = setTimeout(
        () => this.settle(pending, { status: "not_started", reason: "expired" }),
        AGENT_DECISION_TIMEOUT_MS,
      );
      pending = {
        public: {
          kind: "batch_translation",
          id: tool_call_id,
          expiresAt: Date.now() + AGENT_DECISION_TIMEOUT_MS,
          translation: structuredClone(translation),
        },
        resolve,
        accept,
        reject,
        timer,
        signal,
        on_abort,
      };
      signal.addEventListener("abort", on_abort, { once: true });
      this.pending = pending;
      this.on_change();
    });
  }

  /** 同步保存成功才结算决定；失败保留等待与原始期限供用户重试。 */
  public resolve_translation(request: JsonRecord): void {
    const pending = this.require_pending(request, "batch_translation");
    if (Date.now() >= pending.public.expiresAt) {
      this.settle(pending, { status: "not_started", reason: "expired" });
      throw new AppErrors.AppError("runtime.busy");
    }
    pending.signal?.throwIfAborted();
    const response = request["response"];
    if (!is_json_record(response)) throw validation_error("agent_translation_response_invalid");
    if (response["kind"] === "cancel") {
      if (Object.keys(response).length !== 1)
        throw validation_error("agent_translation_response_invalid");
      this.settle(pending, { status: "not_started", reason: "cancelled" });
      return;
    }
    if (
      response["kind"] !== "provider" ||
      Object.keys(response).length !== 2 ||
      typeof response["providerId"] !== "string" ||
      !pending.public.translation.providers.some(
        (provider) => provider.id === response["providerId"],
      )
    ) {
      throw validation_error("agent_translation_response_invalid");
    }
    const model = pending.accept(response["providerId"]);
    this.settle(pending, { status: "accepted", model });
  }

  /** 仅当前普通问题接受结构化回答，过期身份不会影响现有等待。 */
  public resolve_question(request: JsonRecord): void {
    const pending = this.require_pending(request, "question");
    const response = normalize_question_response(request["response"], pending.public.question);
    this.settle(pending, question_result(response));
  }

  /** 仅当前写入授权接受固定权限结果。 */
  public resolve_write_approval(request: JsonRecord): void {
    const pending = this.require_pending(request, "write_approval");
    const decision = request["decision"];
    if (decision !== "reject" && decision !== "allow_once" && decision !== "allow_session") {
      throw validation_error("agent_write_approval_decision_invalid");
    }
    this.settle(pending, decision);
  }

  /** reset、工程切换和 dispose 让正在等待的工具随当前运行时一并取消。 */
  public reset(): void {
    const pending = this.pending;
    if (pending === null) return;
    this.clear(pending);
    setImmediate(() =>
      pending.reject(
        new AppErrors.AppError("runtime.cancelled", {
          diagnostic_context: { resource: "agent_decision" },
        }),
      ),
    );
  }

  /** 同一会话只允许一个等待中的决定，并沿用上游取消信号。 */
  private assert_available(signal: AbortSignal | undefined): void {
    signal?.throwIfAborted();
    if (this.pending !== null) throw new AppErrors.AppError("runtime.busy");
  }

  /** 身份与种类共同锁定当前决定，避免迟到命令裁决后续问题。 */
  private require_pending<TKind extends AgentPendingDecision["kind"]>(
    request: JsonRecord,
    kind: TKind,
  ): Extract<PendingDecision, { public: { kind: TKind } }> {
    const pending = this.pending;
    if (pending === null || pending.public.kind !== kind || request["id"] !== pending.public.id) {
      throw new AppErrors.AppError("runtime.busy");
    }
    return pending as Extract<PendingDecision, { public: { kind: TKind } }>;
  }

  /** 所有决定共用先清状态、后恢复工具的原子结算顺序。 */
  private settle<TResult>(
    pending: PendingDecisionLifecycle & { resolve: (result: TResult) => void },
    result: TResult,
  ): void {
    if (this.pending !== pending) return;
    this.clear(pending);
    // pending 清除先经 SSE 到达 renderer，工具在下一轮事件循环继续，不显示处理中状态。
    setImmediate(() => pending.resolve(result));
  }

  /** Abort 与 reset 都拒绝原工具 Promise，不伪造用户裁决。 */
  private abort(pending: PendingDecision): void {
    if (this.pending !== pending) return;
    this.clear(pending);
    setImmediate(() =>
      pending.reject(pending.signal?.reason ?? new Error("Agent decision aborted")),
    );
  }

  /** 清理计时器和信号订阅后再公开空状态。 */
  private clear(pending: PendingDecisionLifecycle): void {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.on_abort);
    this.pending = null;
    this.on_change();
  }
}

/** 在当前问题上下文中校验并规范 renderer 返回的一次性答案。 */
function normalize_question_response(
  value: unknown,
  question: AgentQuestion,
): AgentQuestionResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation_error("agent_question_response_invalid");
  }
  const response = value as Record<string, unknown>;
  if (response["kind"] === "cancel") return { kind: "cancel" };
  if (response["kind"] === "option") {
    const option_id = response["optionId"];
    if (
      typeof option_id !== "string" ||
      !question.options.some((option) => option.id === option_id)
    ) {
      throw validation_error("agent_question_option_invalid");
    }
    return { kind: "option", optionId: option_id };
  }
  if (response["kind"] === "custom" && typeof response["text"] === "string") {
    const text = response["text"].trim();
    if (text !== "") return { kind: "custom", text };
  }
  throw validation_error("agent_question_response_invalid");
}

/** 把公开回答协议投影为模型可见的稳定工具结果。 */
function question_result(response: AgentQuestionResponse): AgentQuestionResult {
  if (response.kind === "cancel") return { outcome: "unanswered", reason: "cancelled" };
  if (response.kind === "custom") return { outcome: "custom", text: response.text };
  return { outcome: "selected", optionId: response.optionId };
}

/** 决定载荷统一使用请求校验错误，并保留可诊断原因。 */
function validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", {
    diagnostic_context: { reason },
  });
}
