import {
  type AssistantMessageEventStream,
  type Context,
  type Model as PiModel,
  type ModelThinkingLevel as PiModelThinkingLevel,
  type ProviderStreamOptions,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

import { DEFAULT_MODEL_AGENT_CONFIG } from "../../domain/model-agent";
import { AppError } from "../../shared/error";
import {
  apply_one_shot_request_overrides,
  resolve_one_shot_generation_options,
} from "./llm-client-policy";
import type { LLMMessage } from "./llm-types";
import { resolve_model_capability, resolve_pi_thinking_level } from "./model-capability";
import type { ModelRequestSnapshot } from "./policy/policy-types";

// Pi provider 身份只用于 adapter 与 ModelRuntime 注册，项目策略直接使用 api_format。
type PiApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
type PiProvider = "openai" | "openai-compatible" | "anthropic" | "google";
const ANTHROPIC_FALLBACK_MAX_TOKENS = 64_000; // 未命中 catalog 时仍满足 Messages API 必填上限

/** 统一 OneShot 调用形状，A/G 通过它转接 Pi 的 streamSimple。 */
type OneShotStream = (
  model: PiModel<PiApi>,
  context: Context,
  options?: ProviderStreamOptions,
) => AssistantMessageEventStream;

/** 调用方可覆盖显示身份与容量，缺省容量沿用 catalog，协议字段由本模块补齐。 */
type PiModelSettings = Readonly<{
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  fallbackMaxTokens?: number; // 只在调用方和 catalog 均未提供容量时使用
  input: PiModel<PiApi>["input"];
}>;

/** OneShot 与 Agent 共用同一次策略解析生成 Pi 能力映射和实际思考档位。 */
export function resolve_pi_model(
  snapshot: ModelRequestSnapshot,
  settings: PiModelSettings,
): {
  model: PiModel<PiApi>;
  thinkingLevel: PiModelThinkingLevel;
  stream: ProviderStreams["stream"];
  streamSimple: ProviderStreams["streamSimple"];
} {
  const api = resolve_pi_api(snapshot.api_format);
  const capability = resolve_model_capability({
    api_format: snapshot.api_format,
    model_id: snapshot.model_id,
    agent: DEFAULT_MODEL_AGENT_CONFIG,
  });
  const thinking_level = resolve_pi_thinking_level(
    snapshot.thinking_level,
    capability.available_thinking_levels,
  );
  const compat = {
    ...capability.compat,
    // 自定义 OpenAI-compatible 服务只共同保证 system role；OneShot 会继续冻结旧 payload 形状。
    ...(api.api === "openai-completions" ? { supportsDeveloperRole: false } : {}),
  };
  const model: PiModel<PiApi> = {
    id: snapshot.model_id,
    name: settings.name,
    provider: api.provider,
    api: api.api,
    baseUrl: snapshot.base_url,
    reasoning: capability.reasoning,
    ...(capability.thinking_level_map === undefined
      ? {}
      : { thinkingLevelMap: { ...capability.thinking_level_map } }),
    input: settings.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: settings.contextWindow ?? capability.catalog_context_window ?? 0,
    maxTokens:
      settings.maxTokens ?? capability.catalog_max_tokens ?? settings.fallbackMaxTokens ?? 0,
    headers: { ...snapshot.headers },
    ...(Object.keys(compat).length === 0 ? {} : { compat }),
  };
  return {
    model,
    thinkingLevel: thinking_level,
    stream: api.stream,
    streamSimple: api.streamSimple,
  };
}

/** 组装一次 OneShot Pi 请求；应用级超时仍由 LLMClient 独立拥有。 */
export function resolve_one_shot_pi_request(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
  signal: AbortSignal,
): {
  model: PiModel<PiApi>;
  context: Context;
  options: ProviderStreamOptions;
  stream: OneShotStream;
} {
  const generation = resolve_one_shot_generation_options(snapshot);
  const resolved = resolve_pi_model(snapshot, {
    name: snapshot.model_id,
    // Anthropic 要求 max_tokens：显式值冻结总 ceiling，自动值使用 catalog 或未知模型回退。
    ...(snapshot.api_format !== "Anthropic"
      ? {}
      : generation.maxTokens === undefined
        ? { fallbackMaxTokens: ANTHROPIC_FALLBACK_MAX_TOKENS }
        : { maxTokens: generation.maxTokens }),
    input: ["text"],
  });
  // Chat Completions 保持既有 payload；Responses 直接使用 Pi 的原生 Items 与 store:false 契约。
  const model: PiModel<PiApi> =
    resolved.model.api === "openai-completions"
      ? {
          ...resolved.model,
          compat: {
            ...resolved.model.compat,
            supportsDeveloperRole: false,
            supportsStore: false,
            supportsUsageInStreaming: true,
            maxTokensField: "max_tokens",
          },
        }
      : resolved.model;
  const options: ProviderStreamOptions = {
    apiKey: snapshot.api_keys[0] ?? "no_key_required",
    cacheRetention: "none",
    headers: { ...snapshot.headers },
    maxRetries: 0,
    signal,
    ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
    ...(generation.maxTokens === undefined ? {} : { maxTokens: generation.maxTokens }),
    ...((snapshot.api_format === "OpenAI" || snapshot.api_format === "OpenAIResponses") &&
    resolved.model.reasoning &&
    resolved.thinkingLevel !== "off"
      ? { reasoningEffort: resolved.thinkingLevel }
      : {}),
    ...((snapshot.api_format === "Google" || snapshot.api_format === "Anthropic") &&
    resolved.model.reasoning &&
    resolved.thinkingLevel !== "off"
      ? { reasoning: resolved.thinkingLevel }
      : {}),
    ...(snapshot.api_format === "Anthropic" ? { interleavedThinking: false } : {}),
    onPayload: (payload) => apply_one_shot_request_overrides(snapshot, payload, signal),
  };
  const stream: OneShotStream =
    snapshot.api_format === "Google" || snapshot.api_format === "Anthropic"
      ? (active_model, context, active_options) =>
          resolved.streamSimple(
            active_model,
            context,
            active_options as SimpleStreamOptions | undefined,
          )
      : (active_model, context, active_options) =>
          resolved.stream(active_model, context, active_options);
  return {
    model,
    context: build_pi_context(snapshot, messages),
    options,
    stream,
  };
}

/** 产品 API 枚举只在这里绑定 Pi provider 身份与惰性 adapter。 */
function resolve_pi_api(api_format: ModelRequestSnapshot["api_format"]): {
  provider: PiProvider;
  api: PiApi;
  stream: ProviderStreams["stream"];
  streamSimple: ProviderStreams["streamSimple"];
} {
  if (api_format === "SakuraLLM") {
    return { provider: "openai-compatible", api: "openai-completions", ...openAICompletionsApi() };
  }
  if (api_format === "Anthropic") {
    return { provider: "anthropic", api: "anthropic-messages", ...anthropicMessagesApi() };
  }
  if (api_format === "Google") {
    return { provider: "google", api: "google-generative-ai", ...googleGenerativeAIApi() };
  }
  if (api_format === "OpenAIResponses") {
    return { provider: "openai", api: "openai-responses", ...openAIResponsesApi() };
  }
  return { provider: "openai", api: "openai-completions", ...openAICompletionsApi() };
}

/** 保留现有 OneShot 提示词语义：Google 把 system 当首条 user，其余协议单独传 system。 */
function build_pi_context(snapshot: ModelRequestSnapshot, messages: LLMMessage[]): Context {
  const system_prompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const user_messages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .map((content) => ({ role: "user" as const, content, timestamp: 0 }));

  if (snapshot.api_format === "Google") {
    const google_messages =
      system_prompt === ""
        ? user_messages
        : [{ role: "user" as const, content: system_prompt, timestamp: 0 }, ...user_messages];
    assert_non_empty_messages(google_messages.length, snapshot.api_format);
    return { messages: google_messages };
  }
  if (snapshot.api_format === "Anthropic") {
    assert_non_empty_messages(user_messages.length, snapshot.api_format);
  } else {
    assert_non_empty_messages(
      user_messages.length + (system_prompt === "" ? 0 : 1),
      snapshot.api_format,
    );
  }
  return {
    ...(system_prompt === "" ? {} : { systemPrompt: system_prompt }),
    messages: user_messages,
  };
}

/** 空提示词在发起远端请求前按 API 格式语义转为稳定校验错误。 */
function assert_non_empty_messages(
  count: number,
  api_format: ModelRequestSnapshot["api_format"],
): void {
  if (count > 0) return;
  throw new AppError("request.validation_failed", {
    public_details: { field: "messages" },
    diagnostic_context: { api_format, reason: "empty_messages" },
  });
}
