import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model as PiModel } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type { JsonRecord } from "../../domain/json";
import { Model } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import { LLMClientPolicy } from "../llm/llm-client-policy";
import { resolve_active_model } from "../model/model-config-resolver";

const AGENT_DEFAULT_MAX_TOKENS = 8192;
const AGENT_CONTEXT_WINDOW = 128_000;

/**
 * 把当前激活模型投影到 pi-agent-core 的运行契约，模型配置仍由既有领域对象解释。
 */
export function resolve_agent_model(config: JsonRecord): {
  model: PiModel<any>;
  thinkingLevel: "off" | "low" | "medium" | "high";
  stream: StreamFn;
} {
  const raw_model = resolve_active_model(config);
  if (raw_model === null) throw new AppErrors.ModelNotFoundError();

  const model = Model.from_json(raw_model, "agent-model");
  const api = resolve_pi_api(model.api_format);
  const headers = model.request.extra_headers_custom_enable
    ? Object.fromEntries(
        Object.entries(model.request.extra_headers).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      )
    : {};
  const configured_max_tokens = model.threshold.output_token_limit;
  const model_max_tokens =
    configured_max_tokens > 0 ? configured_max_tokens : AGENT_DEFAULT_MAX_TOKENS;
  const pi_model: PiModel<any> = {
    id: model.model_id,
    name: model.name || model.model_id,
    api: api.api,
    // SakuraLLM 与既有 sakura transport 使用同一 OpenAI compatible 口径。
    provider: model.api_format === "SakuraLLM" ? "openai-compatible" : api.provider,
    baseUrl: LLMClientPolicy.normalize_api_url(model.api_url, model.api_format),
    reasoning: model.thinking.level !== "OFF",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Math.max(AGENT_CONTEXT_WINDOW, model_max_tokens),
    maxTokens: model_max_tokens,
    headers,
  };
  return {
    model: pi_model,
    thinkingLevel: model.thinking.level.toLocaleLowerCase() as "off" | "low" | "medium" | "high",
    stream: (active_model, context, options) =>
      api.stream.streamSimple(active_model, context, {
        ...options,
        apiKey: model.api_key,
        headers: { ...headers, ...options?.headers },
        ...(configured_max_tokens > 0 ? { maxTokens: configured_max_tokens } : {}),
        ...(model.generation.temperature_custom_enable
          ? { temperature: model.generation.temperature }
          : {}),
      }),
  };
}

/**
 * 将 LinguaGacha 的供应商枚举映射到 pi-ai 的惰性 API 实现。
 */
export function resolve_pi_api(api_format: Model["api_format"]): {
  provider: "openai" | "anthropic" | "google";
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai";
  stream: { streamSimple: StreamFn };
} {
  if (api_format === "Anthropic") {
    return { provider: "anthropic", api: "anthropic-messages", stream: anthropicMessagesApi() };
  }
  if (api_format === "Google") {
    return { provider: "google", api: "google-generative-ai", stream: googleGenerativeAIApi() };
  }
  return { provider: "openai", api: "openai-completions", stream: openAICompletionsApi() };
}
