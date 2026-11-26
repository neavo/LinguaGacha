import type { EffectiveModelRequest } from "../../domain/model";
import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { is_json_record, read_json_integer } from "../../domain/json";

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
const GOOGLE_PROMPT_BLOCK_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "IMAGE_SAFETY",
  "MODEL_ARMOR",
  "JAILBREAK",
]);
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

  /** 只汇总本次推理的 HTTP 事实，供批量调度器判断密钥冷却。 */
  public async request(
    body: LLMRequestBody,
    signal: AbortSignal,
    on_effective_model?: (model: EffectiveModelRequest) => void,
  ): Promise<LLMRequestResult> {
    const base_fetch = globalThis.fetch;
    let http_response: HttpResponseInfo | undefined;
    const request_fetch: typeof fetch = async (input, init) => {
      const response = await base_fetch(input, init);
      http_response = read_http_response(response);
      return response;
    };
    const result = await this.execute(body, signal, request_fetch, on_effective_model);
    return { ...result, ...http_response };
  }

  /** 解析模型快照，将取消、总时限和 Pi 终态收敛为请求结果。 */
  private async execute(
    body: LLMRequestBody,
    signal: AbortSignal,
    request_fetch: typeof fetch,
    on_effective_model?: (model: EffectiveModelRequest) => void,
  ): Promise<LLMRequestResult> {
    const snapshot = read_model_request_snapshot(body.model, {
      user_agent: this.user_agent,
      session_id: body.run_id,
    });
    const deadline = new AbortController();
    const request_signal = AbortSignal.any([signal, deadline.signal]);
    const capability = resolve_model_capability(
      {
        api_format: snapshot.api_format,
        api_url: snapshot.endpoint.base_url,
        model_id: snapshot.model_id,
        agent: DEFAULT_MODEL_AGENT_CONFIG,
      },
      this.catalog.read(),
    );
    const timer = setTimeout(() => deadline.abort(), read_request_timeout_ms(body.config_snapshot));
    try {
      if (signal.aborted) {
        return empty_llm_result({ cancelled: true });
      }
      const request = resolve_one_shot_pi_request(
        snapshot,
        body.messages,
        request_signal,
        capability,
        on_effective_model,
      );
      request.options.fetch = request_fetch;
      let prompt_blocked = false;
      if (request.model.api === "google-generative-ai" || request.model.api === "google-vertex") {
        request.options.onProviderStreamEvent = (event) => {
          prompt_blocked ||= is_google_prompt_block(event);
        };
      }
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
      const observation =
        snapshot.auth_type === "oauth" ? observe_chatgpt_request(request_fetch) : null;
      if (observation !== null) {
        if (this.auth === undefined) throw new AppError("model.auth_required");
        const auth = await this.auth.resolve(body.auth_session ?? this.auth.bind(), request_signal);
        if (auth.apiKey === undefined) throw new AppError("model.auth_required");
        request.options.apiKey = auth.apiKey;
        Object.assign(request.options, observation.options);
      }
      const message = await request
        .stream(request.model, request.context, request.options)
        .result();
      if (deadline.signal.aborted) return empty_llm_result({ timeout: true }); // 同时取消时以总时限为准
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

      return normalize_pi_result(snapshot, message, body, prompt_blocked);
    } catch (error) {
      if (deadline.signal.aborted) return empty_llm_result({ timeout: true });
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
    }
  }
}

type HttpResponseInfo = Pick<
  LLMRequestResult,
  "http_status" | "http_received_at" | "retry_after_ms"
>;

/** 每个响应整体替换上一次的事实，冷却时间从收到该响应时算起。 */
function read_http_response(response: Response): HttpResponseInfo {
  const received_at = Date.now();
  const raw = response.headers.get("retry-after")?.trim() ?? "";
  const delay = /^\d+$/.test(raw)
    ? Number(raw) * 1000
    : /^(?:[A-Za-z]{3,9}, |[A-Za-z]{3} )/.test(raw)
      ? Date.parse(raw) - received_at
      : NaN;
  return {
    http_status: response.status,
    http_received_at: received_at,
    ...(Number.isFinite(delay) && delay > 0 ? { retry_after_ms: delay } : {}),
  };
}

/** Google 可以只返回提示词拦截信息，此时 Pi 没有候选终止原因。 */
function is_google_prompt_block(event: unknown): boolean {
  if (!is_json_record(event) || !is_json_record(event["promptFeedback"])) return false;
  const reason = event["promptFeedback"]["blockReason"];
  return typeof reason === "string" && GOOGLE_PROMPT_BLOCK_REASONS.has(reason);
}

/** 明确的内容拒绝进入内容处理，其余 Pi 请求失败继续交由调度器恢复。 */
function normalize_pi_result(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
  body: LLMRequestBody,
  prompt_blocked: boolean,
): LLMRequestResult {
  const finish_error = read_finish_error(message, prompt_blocked);
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
function read_finish_error(message: AssistantMessage, prompt_blocked: boolean): string | undefined {
  const reason = message.rawStopReason;
  const refused =
    reason === undefined
      ? prompt_blocked && message.stopReason === "error"
      : CONTENT_REFUSAL_REASONS[message.api]?.includes(reason);
  if (refused) {
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
