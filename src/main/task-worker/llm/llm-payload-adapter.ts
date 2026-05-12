import type { ApiJsonValue } from "../../api/api-types";
import { is_output_token_limit_auto, type LinguaGachaModelSnapshot } from "./llm-model-adapter";

const ANTHROPIC_AUTO_MAX_TOKENS_MIN = 8192;
const CLAUDE_THINKING_BUDGETS: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 384,
  MEDIUM: 768,
  HIGH: 1024,
};
const GEMINI_BUDGETS: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
  LOW: 384,
  MEDIUM: 768,
  HIGH: 1024,
};

/**
 * 生成 pi-ai provider options；第三方库只拿供应商通信参数，不拥有 LinguaGacha 策略。
 */
export function build_pi_ai_provider_options(
  snapshot: LinguaGachaModelSnapshot,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const temperature = read_custom_number(snapshot.generation, "temperature");
  if (temperature !== null && should_send_temperature(snapshot)) {
    options["temperature"] = temperature;
  }
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) {
    options["maxTokens"] = max_tokens;
  }
  if (snapshot.api_format === "Google") {
    options["thinking"] = build_google_thinking_option(snapshot);
  }
  if (snapshot.api_format === "Anthropic") {
    const thinking = build_anthropic_thinking_option(snapshot);
    Object.assign(options, thinking);
  }
  return options;
}

/**
 * onPayload 是供应商 payload 修补入口，所有非通用字段都集中在这里。
 */
export function patch_linguagacha_payload(
  payload: unknown,
  snapshot: LinguaGachaModelSnapshot,
): unknown {
  const record = ensure_record(payload);
  if (snapshot.api_format === "Google") {
    patch_google_payload(record, snapshot);
    return record;
  }
  if (snapshot.api_format === "Anthropic") {
    patch_anthropic_payload(record, snapshot);
    return record;
  }
  patch_openai_payload(record, snapshot);
  return record;
}

/**
 * OpenAI-compatible 分支把 extra_body 内容展开到顶层，避免发送字面 extra_body 字段。
 */
function patch_openai_payload(
  payload: Record<string, unknown>,
  snapshot: LinguaGachaModelSnapshot,
): void {
  patch_generation_fields(payload, snapshot.generation, {
    top_p: "top_p",
    presence_penalty: "presence_penalty",
    frequency_penalty: "frequency_penalty",
  });
  const existing_extra_body = ensure_record(payload["extra_body"]);
  delete payload["extra_body"];
  Object.assign(
    payload,
    existing_extra_body,
    build_openai_thinking_body(snapshot),
    snapshot.extra_body,
  );
}

/**
 * 思考挡位映射保留在 TS 边界，避免模型名规则散到任务 runner。
 */
function build_openai_thinking_body(
  snapshot: LinguaGachaModelSnapshot,
): Record<string, ApiJsonValue> {
  const model_id = snapshot.model_id;
  const level = snapshot.thinking_level;
  if (/gpt-5/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "none" : level.toLowerCase() };
  }
  if (/qwen3\.5/iu.test(model_id)) {
    return { enable_thinking: level !== "OFF" };
  }
  if (/doubao-seed-(?:1-6|1-8|2-0)/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "minimal" : level.toLowerCase() };
  }
  if (/deepseek|kimi|glm/iu.test(model_id)) {
    return { thinking: { type: level === "OFF" ? "disabled" : "enabled" } };
  }
  return {};
}

/**
 * Google payload 需要把 generation 字段放入 config，并强制保留安全阈值。
 */
function patch_google_payload(
  payload: Record<string, unknown>,
  snapshot: LinguaGachaModelSnapshot,
): void {
  const config = ensure_record(payload["config"]);
  payload["config"] = config;
  patch_generation_fields(config, snapshot.generation, {
    top_p: "topP",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
  });
  config["safetySettings"] = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ];
  const thinking_config = build_google_thinking_config(snapshot);
  if (thinking_config !== null) {
    config["thinkingConfig"] = thinking_config;
  }
  Object.assign(config, snapshot.extra_body);
}

/**
 * pi-ai 的 Google thinking option 与原始 payload config 使用同一份挡位计算。
 */
function build_google_thinking_option(snapshot: LinguaGachaModelSnapshot): Record<string, unknown> {
  const config = build_google_thinking_config(snapshot);
  if (config === null) {
    return { enabled: false };
  }
  if ("thinkingBudget" in config) {
    return {
      enabled: config["includeThoughts"] !== false,
      budgetTokens: config["thinkingBudget"],
    };
  }
  return {
    enabled: true,
    level: config["thinkingLevel"],
  };
}

/**
 * Gemini 2.5 / 3 系列 thinking 字段不同，模型名判断集中在这里。
 */
function build_google_thinking_config(
  snapshot: LinguaGachaModelSnapshot,
): Record<string, unknown> | null {
  const model_id = snapshot.model_id;
  const level = snapshot.thinking_level;
  if (/gemini-3-pro/iu.test(model_id)) {
    return {
      thinkingLevel: level === "HIGH" ? "HIGH" : "LOW",
      includeThoughts: true,
    };
  }
  if (/gemini-3\.1-pro/iu.test(model_id)) {
    return {
      thinkingLevel: level === "HIGH" ? "HIGH" : level === "MEDIUM" ? "MEDIUM" : "LOW",
      includeThoughts: true,
    };
  }
  if (/gemini-3(?:\.1)?-flash/iu.test(model_id)) {
    return {
      thinkingLevel: level === "OFF" ? "MINIMAL" : level,
      includeThoughts: true,
    };
  }
  if (/gemini-2\.5-pro/iu.test(model_id)) {
    return {
      thinkingBudget: level === "OFF" ? 128 : GEMINI_BUDGETS[level],
      includeThoughts: true,
    };
  }
  if (/gemini-2\.5-flash/iu.test(model_id)) {
    return {
      thinkingBudget: level === "OFF" ? 0 : GEMINI_BUDGETS[level],
      includeThoughts: level !== "OFF",
    };
  }
  return null;
}

/**
 * Anthropic 只接受顶层字段；thinking 开启时不能同时带 temperature / top_p。
 */
function patch_anthropic_payload(
  payload: Record<string, unknown>,
  snapshot: LinguaGachaModelSnapshot,
): void {
  patch_generation_fields(payload, snapshot.generation, { top_p: "top_p" });
  const existing_extra_body = ensure_record(payload["extra_body"]);
  delete payload["extra_body"];
  Object.assign(payload, existing_extra_body, snapshot.extra_body);
  delete payload["presence_penalty"];
  delete payload["frequency_penalty"];
  const thinking = build_anthropic_thinking_payload(snapshot);
  if (thinking !== null) {
    payload["thinking"] = thinking;
  }
  if (snapshot.thinking_level !== "OFF" && thinking !== null) {
    delete payload["temperature"];
    delete payload["top_p"];
  }
}

/**
 * pi-ai 的 Anthropic thinking option 复用 thinking 预算，保持双入口一致。
 */
function build_anthropic_thinking_option(
  snapshot: LinguaGachaModelSnapshot,
): Record<string, unknown> {
  const thinking = build_anthropic_thinking_payload(snapshot);
  if (thinking === null || thinking["type"] === "disabled") {
    return { thinkingEnabled: false };
  }
  return {
    thinkingEnabled: true,
    thinkingBudgetTokens: thinking["budget_tokens"],
    thinkingDisplay: "summarized",
  };
}

/**
 * Claude thinking 只覆盖支持预算字段的型号，其他型号不注入额外参数。
 */
function build_anthropic_thinking_payload(
  snapshot: LinguaGachaModelSnapshot,
): Record<string, unknown> | null {
  if (
    !/claude-3-7-sonnet|claude-opus-4-\d|claude-haiku-4-\d|claude-sonnet-4-\d/iu.test(
      snapshot.model_id,
    )
  ) {
    return null;
  }
  if (snapshot.thinking_level === "OFF") {
    return { type: "disabled" };
  }
  return {
    type: "enabled",
    budget_tokens: CLAUDE_THINKING_BUDGETS[snapshot.thinking_level],
  };
}

/**
 * 自动 token 时只给 Anthropic 保守下限，其它供应商交给远端默认。
 */
function resolve_max_tokens_for_request(snapshot: LinguaGachaModelSnapshot): number | null {
  if (!is_output_token_limit_auto(snapshot.output_token_limit)) {
    return Math.max(1, snapshot.output_token_limit);
  }
  if (snapshot.api_format === "Anthropic") {
    return Math.max(ANTHROPIC_AUTO_MAX_TOKENS_MIN, snapshot.pi_model.contextWindow);
  }
  return null;
}

/**
 * Anthropic thinking 开启时温度由供应商规则控制，adapter 不发送温度字段。
 */
function should_send_temperature(snapshot: LinguaGachaModelSnapshot): boolean {
  return snapshot.api_format !== "Anthropic" || snapshot.thinking_level === "OFF";
}

/**
 * generation 字段只有 custom_enable 为真才写入 payload。
 */
function patch_generation_fields(
  payload: Record<string, unknown>,
  generation: Record<string, ApiJsonValue>,
  field_map: Record<string, string>,
): void {
  for (const [source_key, target_key] of Object.entries(field_map)) {
    const value = read_custom_number(generation, source_key);
    if (value !== null) {
      payload[target_key] = value;
    }
  }
}

/**
 * 自定义数值读取失败时返回 null，让调用方保持字段缺省。
 */
function read_custom_number(generation: Record<string, ApiJsonValue>, key: string): number | null {
  if (generation[`${key}_custom_enable`] !== true) {
    return null;
  }
  const value = Number(generation[key]);
  return Number.isFinite(value) ? value : null;
}

/**
 * payload patch 总是操作浅拷贝对象，避免修改第三方库传入的共享引用。
 */
function ensure_record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
