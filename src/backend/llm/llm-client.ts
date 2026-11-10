import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { read_json_integer } from "../../domain/json";

import { to_log_error, type LogError } from "../../shared/error";
import {
  read_model_request_snapshot,
  read_request_timeout_ms,
  type ModelRequestSnapshot,
} from "./llm-request";
import { resolve_one_shot_pi_request } from "./llm-pi";
import { resolve_model_capability } from "./model-capability";
import type { PiModelCatalogReader } from "./pi-model-catalog";
import { DEFAULT_MODEL_AGENT_CONFIG } from "../../domain/model-agent";
import type { LLMRequestBody, LLMClientPort, LLMRequestResult } from "./llm-types";
import { with_http_response_info } from "../network/http-response-info";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import { AppError } from "../../shared/error";
import { observe_chatgpt_request } from "./chatgpt-request";

interface LLMClientOptions {
  auth?: Pick<ChatGPTAuthService, "bind" | "resolve">;
  userAgent: string; // 由应用元信息层注入，LLMClient 不读取 version.txt
  catalog: PiModelCatalogReader;
}

const GOOGLE_CONTENT_REFUSAL_REASONS = [
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
] as const;
// SDK 将内容拒绝与网络故障都归为 `error`，原始原因必须按协议识别。
const CONTENT_REFUSAL_REASONS: Readonly<
  Partial<Record<AssistantMessage["api"], readonly string[]>>
> = {
  "openai-completions": ["content_filter"],
  "openai-responses": ["incomplete.content_filter"],
  "anthropic-messages": ["refusal", "sensitive"],
  "google-generative-ai": GOOGLE_CONTENT_REFUSAL_REASONS,
  "google-vertex": GOOGLE_CONTENT_REFUSAL_REASONS,
};

/** Backend 进程内 OneShot LLM 入口，拥有总时限、取消和结果归一。 */
export class LLMClient implements LLMClientPort {
  private readonly user_agent: string; // 当前 Backend 实例的固定请求身份
  private readonly catalog: PiModelCatalogReader; // 请求开始时解析能力，运行占用期间目录保持稳定。
  private readonly auth: LLMClientOptions["auth"]; // 每次派发时解析本轮绑定的账户凭据。

  /** User-Agent 由组合根注入，避免请求层读取应用资源。 */
  public constructor(options: LLMClientOptions) {
    this.user_agent = options.userAgent;
    this.catalog = options.catalog;
    this.auth = options.auth;
  }

  /** 在单次请求上下文内附加 HTTP 事实，避免依赖 SDK 的错误文本。 */
  public request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult> {
    return with_http_response_info(() => this.execute(body, signal));
  }

  /** 解析模型快照，将取消、总时限和 Pi 终态收敛为请求结果。 */
  private async execute(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult> {
    const snapshot = read_model_request_snapshot(body.model, {
      user_agent: this.user_agent,
      session_id: body.run_id,
    });
    const controller = new AbortController();
    const capability = resolve_model_capability(
      {
        api_format: snapshot.api_format,
        api_url: snapshot.endpoint.base_url,
        model_id: snapshot.model_id,
        agent: DEFAULT_MODEL_AGENT_CONFIG,
      },
      this.catalog.read_models(),
    );
    // 外部信号记录用户取消，独立超时标记保留同时发生时的结果优先级。
    let timeout = false;
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, read_request_timeout_ms(body.config_snapshot));
    const abort_listener = (): void => {
      controller.abort();
    };
    signal.addEventListener("abort", abort_listener, { once: true });
    try {
      if (signal.aborted) {
        return empty_llm_result({ cancelled: true });
      }
      const request = resolve_one_shot_pi_request(
        snapshot,
        body.messages,
        controller.signal,
        capability,
      );
      let payload_error: AppError | null = null;
      const on_payload = request.options.onPayload;
      request.options.onPayload = async (payload, model) => {
        try {
          return await on_payload?.(payload, model);
        } catch (error) {
          if (error instanceof AppError) payload_error = error;
          throw error;
        }
      };
      const observation = snapshot.auth_type === "oauth" ? observe_chatgpt_request() : null;
      if (snapshot.auth_type === "oauth") {
        if (this.auth === undefined) throw new AppError("model.auth_required");
        const auth = await this.auth.resolve(
          body.auth_session ?? this.auth.bind(),
          controller.signal,
        );
        if (auth.apiKey === undefined) throw new AppError("model.auth_required");
        request.options.apiKey = auth.apiKey;
        Object.assign(request.options, observation!.options);
      }
      const message = await request
        .stream(request.model, request.context, request.options)
        .result();
      if (timeout) return empty_llm_result({ timeout: true });
      if (signal.aborted) return empty_llm_result({ cancelled: true });
      if (payload_error !== null)
        return empty_llm_result({
          request_error: build_llm_error(payload_error, snapshot, body, message),
          retryable: false,
        });
      const failure = observation?.failure();
      if (failure)
        return empty_llm_result({
          request_error: build_llm_error(failure.error, snapshot, body, message),
          retryable: failure.retryable,
        });

      return normalize_pi_result(snapshot, message, body);
    } catch (error) {
      if (timeout) return empty_llm_result({ timeout: true });
      if (signal.aborted) return empty_llm_result({ cancelled: true });
      return empty_llm_result({
        request_error: build_llm_error(error, snapshot, body),
        ...(error instanceof AppError &&
        (error.code !== "model.provider_failed" || error.diagnostic_context["retryable"] === false)
          ? { retryable: false }
          : {}),
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort_listener);
    }
  }
}

/** 明确的内容拒绝进入内容处理，其余 Pi 请求失败继续交由调度器恢复。 */
function normalize_pi_result(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
  body: LLMRequestBody,
): LLMRequestResult {
  const finish_error = read_finish_error(message);
  if (
    finish_error === undefined &&
    (message.stopReason === "error" ||
      message.stopReason === "aborted" ||
      message.stopReason === "pending")
  ) {
    return empty_llm_result({
      request_error: build_llm_error(
        new Error(message.errorMessage ?? "Provider request did not complete normally."),
        snapshot,
        body,
        message,
      ),
    });
  }
  const response_think = message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("")
    .trim();
  const usage = normalize_usage(message);
  return {
    response_think,
    response_result: finish_error === undefined ? contentText(message.content, "").trim() : "",
    ...usage,
    usage_complete: false, // SDK 会为缺失用量补零，归一结果无法证明原始回执完整。
    cancelled: false,
    timeout: false,
    ...(finish_error === undefined
      ? {}
      : {
          response_error: build_llm_error(finish_error, snapshot, body, message),
        }),
  };
}

/** 统一把 Pi usage 归一为输入、思考和输出三个互斥口径。 */
function normalize_usage(
  message: AssistantMessage,
): Pick<LLMRequestResult, "input_tokens" | "reasoning_tokens" | "output_tokens"> {
  // 兼容接口可能返回数字字符串，逐项归一后才能安全累计用量。
  const input_tokens = read_usage_tokens(message.usage.input);
  const cache_read_tokens = read_usage_tokens(message.usage.cacheRead);
  const cache_write_tokens = read_usage_tokens(message.usage.cacheWrite);
  const provider_output_tokens = read_usage_tokens(message.usage.output);
  const reasoning_tokens = Math.min(
    provider_output_tokens,
    read_usage_tokens(message.usage.reasoning),
  );
  return {
    input_tokens: input_tokens + cache_read_tokens + cache_write_tokens,
    reasoning_tokens,
    output_tokens: provider_output_tokens - reasoning_tokens,
  };
}

/** 缺失或不可用统计按零计入已知用量，不影响响应正文的处理。 */
function read_usage_tokens(value: unknown): number {
  return Math.max(0, read_json_integer(value, 0));
}

/** 只识别协议内的明确拒绝值，宽泛或未知原因保留请求失败语义。 */
function read_finish_error(message: AssistantMessage): string | undefined {
  if (
    message.rawStopReason !== undefined &&
    CONTENT_REFUSAL_REASONS[message.api]?.includes(message.rawStopReason)
  ) {
    return message.errorMessage ?? "供应商拒绝生成当前内容。";
  }
  if (message.stopReason === "length") {
    return "供应商返回长度截断。";
  }
  if (message.stopReason === "toolUse") {
    return "供应商返回工具调用，当前任务不支持。";
  }
  return undefined;
}

/** 失败只附加安全的模型、work-unit 定位与已取得的 SDK 终态。 */
function build_llm_error(
  error: unknown,
  snapshot: ModelRequestSnapshot,
  body: LLMRequestBody,
  message?: AssistantMessage,
): LogError {
  return to_log_error(error, {
    ...(error instanceof AppError ? error.diagnostic_context : {}),
    ...(message === undefined
      ? {}
      : {
          api: message.api,
          stopReason: message.stopReason,
          ...(message.rawStopReason === undefined ? {} : { rawStopReason: message.rawStopReason }),
        }),
    api_format: snapshot.api_format,
    ...(snapshot.model_id === "" ? {} : { model_id: snapshot.model_id }),
    run_id: body.run_id,
    work_unit_id: body.work_unit_id,
  });
}

/** 所有无结果分支共用完整默认值，调用方无需猜测缺失布尔字段。 */
function empty_llm_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
  return {
    response_think: "",
    response_result: "",
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    cancelled: false,
    timeout: false,
    usage_complete: false,
    ...overrides,
  };
}
