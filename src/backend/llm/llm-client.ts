import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";
import { read_json_integer } from "../../domain/json";

import { log_error_from_message, to_log_error, type LogError } from "../../shared/error";
import {
  read_model_request_snapshot,
  read_request_timeout_ms,
  type ModelRequestSnapshot,
} from "./llm-request";
import { resolve_one_shot_pi_request } from "./llm-pi";
import type { LLMRequestBody, LLMClientPort, LLMRequestResult } from "./llm-types";
import { with_http_response_info } from "../network/http-response-info";

interface LLMClientOptions {
  userAgent: string; // 由应用元信息层注入，LLMClient 不读取 version.txt
}

/** Backend 进程内 OneShot LLM 入口，拥有总时限、取消和结果归一。 */
export class LLMClient implements LLMClientPort {
  private readonly user_agent: string; // 当前 Backend 实例的固定请求身份

  /** User-Agent 由组合根注入，避免请求层读取应用资源。 */
  public constructor(options: LLMClientOptions) {
    this.user_agent = options.userAgent;
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
    const request = resolve_one_shot_pi_request(snapshot, body.messages, controller.signal);
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
      const message = await request
        .stream(request.model, request.context, request.options)
        .result();
      if (timeout) return empty_llm_result({ timeout: true });
      if (signal.aborted) return empty_llm_result({ cancelled: true });

      const response_result = contentText(message.content, "").trim();
      return normalize_pi_result(snapshot, message, response_result);
    } catch (error) {
      if (timeout) return empty_llm_result({ timeout: true });
      if (signal.aborted) return empty_llm_result({ cancelled: true });
      return empty_llm_result({ request_error: build_request_error(error, snapshot, body) });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort_listener);
    }
  }
}

/** Pi 的终态是成功与否的权威；供应商 raw reason 只用于后续诊断。 */
function normalize_pi_result(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
  response_result: string,
): LLMRequestResult {
  if (
    message.stopReason === "error" ||
    message.stopReason === "aborted" ||
    message.stopReason === "pending"
  ) {
    throw new Error(message.errorMessage ?? "Provider request did not complete normally.");
  }
  const response_think = message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("")
    .trim();
  const usage = normalize_usage(message);
  const finish_error = read_finish_error(snapshot, message);
  return {
    response_think,
    response_result: finish_error === undefined ? response_result : "",
    ...usage,
    cancelled: false,
    timeout: false,
    ...(finish_error === undefined ? {} : { response_error: finish_error }),
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

/** 统一拒绝不完整终态；正常结束的正文由消费方按任务协议校验。 */
function read_finish_error(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
): LogError | undefined {
  const reason_key =
    snapshot.api_format === "Anthropic"
      ? "stop_reason"
      : snapshot.api_format === "OpenAIResponses"
        ? "status"
        : "finish_reason";
  const raw_reason = message.rawStopReason ?? message.stopReason;
  if (message.stopReason === "length") {
    return log_error_from_message("供应商返回长度截断。", {
      [reason_key]: raw_reason,
    });
  }
  if (message.stopReason === "toolUse") {
    return log_error_from_message("供应商返回工具调用，当前任务不支持。", {
      [reason_key]: raw_reason,
    });
  }
  return undefined;
}

/** 请求异常只附加安全的模型与 work-unit 定位字段。 */
function build_request_error(
  error: unknown,
  snapshot: ModelRequestSnapshot,
  body: LLMRequestBody,
): LogError {
  return to_log_error(error, {
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
    ...overrides,
  };
}
