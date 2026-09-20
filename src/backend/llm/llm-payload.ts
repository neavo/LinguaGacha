import { is_json_record } from "../../domain/json";
import type { ModelApiFormat } from "../../domain/model";
import { AppError } from "../../shared/error";
import {
  read_custom_number,
  resolve_max_tokens_for_request,
  type ModelRequestSnapshot,
} from "./llm-request";

/** 单次翻译补齐 Pi 选项无法表达的产品生成规则，再合并公共扩展策略。 */
export function apply_one_shot_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
  signal: AbortSignal,
): Record<string, unknown> {
  const top_p = read_custom_number(snapshot.generation, "top_p");
  if (snapshot.api_format === "Google") {
    const record = read_pi_record(payload, "Google");
    const config = { ...read_pi_record(record["config"], "Google", "config") };
    if (top_p !== null) config["topP"] = top_p;
    const max_tokens = resolve_max_tokens_for_request(snapshot);
    if (max_tokens === null) delete config["maxOutputTokens"];
    else config["maxOutputTokens"] = max_tokens;
    config["safetySettings"] = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ];
    return {
      ...record,
      config: { ...apply_google_extensions(config, snapshot), abortSignal: signal },
    };
  }
  if (snapshot.api_format === "Anthropic") {
    const source = { ...read_pi_record(payload, "Anthropic") };
    if (top_p !== null && !is_anthropic_thinking_enabled(source["thinking"]))
      source["top_p"] = top_p;
    return apply_anthropic_extensions(source, snapshot);
  }
  return apply_request_overrides(snapshot, payload);
}

/** 按协议合并用户扩展，保留结构化思考配置和产品指令角色。 */
export function apply_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
): Record<string, unknown> {
  const record = read_pi_record(payload, snapshot.api_format);
  if (snapshot.api_format === "Google") {
    return {
      ...record,
      config: apply_google_extensions(
        read_pi_record(record["config"], "Google", "config"),
        snapshot,
      ),
    };
  }
  if (snapshot.api_format === "Anthropic") return apply_anthropic_extensions(record, snapshot);
  if (snapshot.api_format === "OpenAIResponses") {
    const input = record["input"];
    if (!Array.isArray(input)) throw invalid_pi_payload("OpenAIResponses", "input");
    // 产品 Responses 指令固定使用 `developer`，补偿 Pi 仍将角色绑定 `reasoning` 的行为。
    // https://github.com/earendil-works/pi/issues/7445：上游满足该契约后才可删除。
    return {
      ...record,
      input: input.map((item) =>
        is_json_record(item) && item["role"] === "system" ? { ...item, role: "developer" } : item,
      ),
      ...snapshot.extra_body,
    };
  }
  return { ...record, ...snapshot.extra_body };
}

/** Pi 生成的思考设置具有结构化配置的优先级，扩展可补充其余字段。 */
function apply_google_extensions(
  config: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...config, ...snapshot.extra_body };
  if (config["thinkingConfig"] !== undefined) result["thinkingConfig"] = config["thinkingConfig"];
  return result;
}

/** 思考与 effort 由结构化配置拥有，扩展只补其余输出设置。 */
function apply_anthropic_extensions(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload, ...snapshot.extra_body };
  const native_thinking = payload["thinking"];
  if (native_thinking !== undefined) {
    result["thinking"] = native_thinking;
    const output_config = is_json_record(result["output_config"])
      ? { ...result["output_config"] }
      : {};
    delete output_config["effort"];
    if (is_json_record(payload["output_config"]))
      Object.assign(output_config, payload["output_config"]);
    if (Object.keys(output_config).length === 0) delete result["output_config"];
    else result["output_config"] = output_config;
  }
  if (is_anthropic_thinking_enabled(native_thinking)) {
    delete result["temperature"];
    delete result["top_p"];
  }
  return result;
}

/** Pi 用 `disabled` 表示关闭，其余思考对象采用开启规则。 */
function is_anthropic_thinking_enabled(value: unknown): boolean {
  return is_json_record(value) && value["type"] !== "disabled";
}

/** `onPayload` 是唯一 SDK 载荷边界，结构失配保留协议与字段诊断。 */
function read_pi_record(
  value: unknown,
  api_format: ModelApiFormat,
  field?: string,
): Record<string, unknown> {
  if (!is_json_record(value)) throw invalid_pi_payload(api_format, field);
  return value;
}

/** 把 SDK 载荷失配归为内部契约错误，并保留字段定位。 */
function invalid_pi_payload(api_format: ModelApiFormat, field?: string): AppError {
  return new AppError("runtime.internal_invariant", {
    diagnostic_context: {
      reason: "invalid_model_request_payload",
      api_format,
      ...(field === undefined ? {} : { field }),
    },
  });
}
