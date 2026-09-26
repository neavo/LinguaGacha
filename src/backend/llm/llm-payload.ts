import type { Api, Model as PiModel } from "@earendil-works/pi-ai";
import { is_json_record } from "../../domain/json";
import type { ModelApiFormat } from "../../domain/model";
import { AppError } from "../../shared/error";
import {
  read_custom_number,
  resolve_max_tokens_for_request,
  type ModelRequestSnapshot,
} from "./llm-request";

type PiCompat = PiModel<Api>["compat"];

/** 单次请求仅增加生成设置，思考与用户扩展和 Agent 共用同一入口。 */
export function apply_one_shot_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
  signal: AbortSignal,
  compat?: PiCompat,
): Record<string, unknown> {
  return apply_request_overrides(snapshot, payload, compat, signal);
}

/** 清理自动思考控制后合并生成设置和用户扩展；`one_shot_signal` 标识单次请求。 */
export function apply_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
  compat?: PiCompat,
  one_shot_signal?: AbortSignal,
): Record<string, unknown> {
  const record = { ...read_pi_record(payload, snapshot.api_format) };
  if (snapshot.thinking_level === "DEFAULT")
    remove_thinking_controls(record, snapshot.api_format, compat);
  const top_p =
    one_shot_signal === undefined ? null : read_custom_number(snapshot.generation, "top_p");
  if (snapshot.api_format === "Google") {
    const config = { ...read_pi_record(record["config"], "Google", "config") };
    if (one_shot_signal !== undefined) {
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
    }
    return {
      ...record,
      config: {
        ...apply_google_extensions(config, snapshot),
        ...(one_shot_signal === undefined ? {} : { abortSignal: one_shot_signal }),
      },
    };
  }
  if (snapshot.api_format === "Anthropic") {
    if (top_p !== null && !is_anthropic_thinking_enabled(record["thinking"]))
      record["top_p"] = top_p;
    return apply_anthropic_extensions(record, snapshot);
  }
  if (snapshot.api_format === "OpenAIResponses") {
    const input = record["input"];
    if (!Array.isArray(input)) throw invalid_pi_payload("OpenAIResponses", "input");
    // 产品 Responses 指令固定使用 `developer`，补偿 Pi 仍将角色绑定 `reasoning` 的行为。
    // https://github.com/earendil-works/pi/issues/7445：上游满足该契约后才可删除。
    record["input"] = input.map((item) =>
      is_json_record(item) && item["role"] === "system" ? { ...item, role: "developer" } : item,
    );
  }
  return { ...record, ...snapshot.extra_body };
}

/** 清理 SDK 自动生成的思考控制，用户扩展随后合并。 */
function remove_thinking_controls(
  record: Record<string, unknown>,
  format: ModelApiFormat,
  compat: PiCompat,
): void {
  if (format === "Google") {
    const config = { ...read_pi_record(record["config"], format, "config") };
    delete config["thinkingConfig"];
    record["config"] = config;
    return;
  }
  if (format === "Anthropic") {
    delete record["thinking"];
    remove_nested_fields(record, "output_config", ["effort"]);
    return;
  }
  for (const key of ["reasoning", "reasoning_effort", "thinking", "enable_thinking"])
    delete record[key];
  if (format === "OpenAIResponses") return;
  const budget_field =
    compat && "thinkingTokenBudgetField" in compat ? compat.thinkingTokenBudgetField : undefined;
  delete record[budget_field ?? "thinking_token_budget"];
  const kwargs = compat && "chatTemplateKwargs" in compat ? compat.chatTemplateKwargs : undefined;
  const args = compat && "chatTemplateArgs" in compat ? compat.chatTemplateArgs : undefined;
  for (const [field, template] of [
    ["chat_template_kwargs", kwargs],
    ["chat_template_args", args],
  ] as const) {
    const keys = ["enable_thinking", "preserve_thinking"];
    for (const [key, value] of Object.entries(template ?? {})) {
      // Pi 的对象模板值表示思考变量；标量值承载普通配置。
      if (is_json_record(value)) keys.push(key);
    }
    remove_nested_fields(record, field, keys);
  }
}

/** 复制嵌套对象后清理指定字段，保留 SDK 原始载荷及其余输出选项。 */
function remove_nested_fields(
  record: Record<string, unknown>,
  field: string,
  keys: readonly string[],
): void {
  if (!is_json_record(record[field])) return;
  const value = { ...record[field] };
  for (const key of keys) delete value[key];
  if (Object.keys(value).length === 0) delete record[field];
  else record[field] = value;
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
