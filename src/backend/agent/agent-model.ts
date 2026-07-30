import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model as PiModel } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type { JsonRecord } from "../../domain/json";
import type { ModelApiFormat } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import { LLMClientPolicy } from "../llm/llm-client-policy";
import { resolve_active_model } from "../model/model-config-resolver";

const AGENT_CONTEXT_WINDOW = 256_000;
const AGENT_MAX_OUTPUT_TOKENS = 64_000;

/**
 * 把统一请求快照投影到 pi-agent-core，供应商字段继续由 LLM policy 解释。
 */
export function resolve_agent_model(
  config: JsonRecord,
  user_agent: string,
): {
  model: PiModel<any>;
  thinkingLevel: "off" | "low" | "medium" | "high";
  stream: StreamFn;
} {
  const raw_model = resolve_active_model(config);
  if (raw_model === null) throw new AppErrors.ModelNotFoundError();

  const policy = new LLMClientPolicy(user_agent);
  const snapshot = policy.read_model_snapshot(raw_model);
  const api = resolve_pi_api(snapshot.api_format);
  const configured_name = String(raw_model["name"] ?? "").trim();
  const pi_model: PiModel<any> = {
    id: snapshot.model_id,
    name: configured_name || snapshot.model_id,
    api: api.api,
    provider: api.provider,
    baseUrl: snapshot.base_url,
    reasoning: policy.supports_thinking(snapshot),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // 模型页 generation 与 token threshold 只属于 OneShot；Agent 使用独立固定容量。
    contextWindow: AGENT_CONTEXT_WINDOW,
    maxTokens: AGENT_MAX_OUTPUT_TOKENS,
    headers: snapshot.headers,
  };
  return {
    model: pi_model,
    thinkingLevel: snapshot.thinking_level.toLowerCase() as "off" | "low" | "medium" | "high",
    stream: (active_model, context, options) =>
      api.stream.streamSimple(active_model, context, {
        ...options,
        apiKey: snapshot.api_keys[0],
        onPayload: (payload) => policy.apply_request_overrides(snapshot, payload),
      }),
  };
}

/**
 * 将 LinguaGacha 的供应商枚举映射到 pi-ai 的惰性 API 实现。
 */
export function resolve_pi_api(api_format: ModelApiFormat): {
  provider: "openai" | "openai-compatible" | "anthropic" | "google";
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai";
  stream: { streamSimple: StreamFn };
} {
  if (api_format === "SakuraLLM") {
    return {
      provider: "openai-compatible",
      api: "openai-completions",
      stream: openAICompletionsApi(),
    };
  }
  if (api_format === "Anthropic") {
    return { provider: "anthropic", api: "anthropic-messages", stream: anthropicMessagesApi() };
  }
  if (api_format === "Google") {
    return { provider: "google", api: "google-generative-ai", stream: googleGenerativeAIApi() };
  }
  return { provider: "openai", api: "openai-completions", stream: openAICompletionsApi() };
}
