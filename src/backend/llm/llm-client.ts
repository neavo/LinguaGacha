import { contentText, type AssistantMessage } from "@earendil-works/pi-ai";

import { JsonTool } from "../../shared/utils/json-tool";
import { log_error_from_message, to_log_error, type LogError } from "../../shared/error";
import { read_model_request_snapshot, read_request_timeout_ms } from "./llm-client-policy";
import { LLMClientDegradationDetector } from "./llm-client-degradation-detector";
import { resolve_one_shot_pi_request } from "./llm-pi";
import type { LLMRequestBody, LLMClientPort, LLMRequestResult } from "./llm-types";
import type { ModelRequestSnapshot } from "./policy/policy-types";

interface LLMClientOptions {
  userAgent: string; // 由应用元信息层注入，LLMClient 不读取 version.txt
}

/** Backend 进程内 OneShot LLM 入口，拥有总时限、取消、退化和结果归一。 */
export class LLMClient implements LLMClientPort {
  private readonly user_agent: string; // 当前 Backend 实例的固定请求身份

  /** User-Agent 由组合根注入，避免请求层读取应用资源。 */
  public constructor(options: LLMClientOptions) {
    this.user_agent = options.userAgent;
  }

  /** 单次解析模型快照，并把取消、总时限和 Pi 流统一收敛为 LLMRequestResult。 */
  public async request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult> {
    const snapshot = read_model_request_snapshot(body.model, this.user_agent);
    const controller = new AbortController();
    const request = resolve_one_shot_pi_request(snapshot, body.messages, controller.signal);
    // AbortController 只传递中止；三个标记保留触发原因并决定最终结果优先级。
    let timeout = false;
    let cancelled = false;
    let degraded = false;
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, read_request_timeout_ms(body.config_snapshot));
    const abort_listener = (): void => {
      cancelled = true;
      controller.abort();
    };
    signal.addEventListener("abort", abort_listener, { once: true });
    try {
      if (signal.aborted) {
        return empty_llm_result({ cancelled: true });
      }
      const stream = request.stream(request.model, request.context, request.options);
      const final_message = stream.result(); // 先持有终态，再消费 delta 做实时退化检测
      const detector = new LLMClientDegradationDetector();
      for await (const event of stream) {
        if (event.type === "text_delta" && detector.feed(event.delta)) {
          degraded = true;
          controller.abort();
        }
      }
      const message = await final_message;
      if (timeout) return empty_llm_result({ timeout: true });
      if (cancelled || signal.aborted) return empty_llm_result({ cancelled: true });
      if (degraded) return empty_llm_result({ degraded: true });

      const response_result = contentText(message.content, "").trim();
      if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
        return empty_llm_result({ degraded: true });
      }
      return normalize_pi_result(snapshot, message, response_result);
    } catch (error) {
      if (timeout) return empty_llm_result({ timeout: true });
      if (cancelled || signal.aborted) return empty_llm_result({ cancelled: true });
      if (degraded) return empty_llm_result({ degraded: true });
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
    throw new Error(message.errorMessage ?? "供应商请求未正常结束。");
  }
  const response_think = message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("")
    .trim();
  const usage = normalize_usage(snapshot, message);
  const finish_error = read_finish_error(snapshot, message);
  const normalized_result =
    snapshot.api_format === "SakuraLLM" && response_result !== "" && finish_error === undefined
      ? convert_sakura_response(response_result)
      : response_result;
  return {
    response_think,
    response_result: finish_error === undefined ? normalized_result : "",
    ...usage,
    cancelled: false,
    timeout: false,
    degraded: false,
    ...(finish_error === undefined ? {} : { request_error: finish_error }),
  };
}

/** 把 Pi 的缓存与思考拆分计数还原为项目既有的供应商统计口径。 */
function normalize_usage(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
): Pick<LLMRequestResult, "input_tokens" | "output_tokens"> {
  if (snapshot.api_format === "Google") {
    return {
      input_tokens: message.usage.input + message.usage.cacheRead,
      output_tokens: Math.max(0, message.usage.output - (message.usage.reasoning ?? 0)),
    };
  }
  if (snapshot.api_format === "Anthropic") {
    return { input_tokens: message.usage.input, output_tokens: message.usage.output };
  }
  return {
    input_tokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
    output_tokens: message.usage.output,
  };
}

/** 只保留任务层已定义的长度截断与工具调用错误；Google 延续原有正文语义。 */
function read_finish_error(
  snapshot: ModelRequestSnapshot,
  message: AssistantMessage,
): LogError | undefined {
  if (snapshot.api_format === "Google") return undefined;
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

/** Sakura 仍向 ResponseDecoder 暴露逐行 JSON map，而不另建 transport。 */
function convert_sakura_response(response_result: string): string {
  const rows: Record<string, string> = {};
  for (const [index, line] of response_result.trim().split(/\r?\n/u).entries()) {
    rows[String(index)] = line.trim();
  }
  return JsonTool.stringifyStrict(rows);
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
    output_tokens: 0,
    cancelled: false,
    timeout: false,
    degraded: false,
    ...overrides,
  };
}
