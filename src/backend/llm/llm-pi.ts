import {
  type AssistantMessageEventStream,
  type Context,
  normalizeContext,
  type Model as PiModel,
  type ModelThinkingLevel as PiModelThinkingLevel,
  type ProviderStreams,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { OpenAICompletionsOptions } from "@earendil-works/pi-ai/api/openai-completions";
import type { AnthropicOptions } from "@earendil-works/pi-ai/api/anthropic-messages";

import { AppError } from "../../shared/error";
import { resolve_one_shot_generation_options, type ModelRequestSnapshot } from "./llm-request";
import { apply_one_shot_request_overrides } from "./llm-payload";
import type { LLMMessage } from "./llm-types";
import { resolve_pi_thinking_level, type ResolvedModelCapability } from "./model-capability";

// Pi provider 身份只用于 adapter 与 ModelRuntime 注册，项目策略直接使用 api_format。
export type PiApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
type PiProvider = "openai" | "openai-compatible" | "anthropic" | "google";
const ANTHROPIC_FALLBACK_MAX_TOKENS = 64_000; // 缺少模型规格时仍满足 Messages API 必填上限

/** 共用选项沿用 Pi 正式类型，协议专属字段只在对应请求分支写入。 */
type OneShotOptions = SimpleStreamOptions &
  Pick<OpenAICompletionsOptions, "reasoningEffort"> &
  Pick<AnthropicOptions, "interleavedThinking">;

type OneShotStream = (
  model: PiModel<PiApi>,
  context: Context,
  options?: OneShotOptions,
) => AssistantMessageEventStream;

/** 调用方可覆盖显示身份与容量，缺省容量沿用统一模型规格，协议字段由本模块补齐。 */
type PiModelSettings = Readonly<{
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  fallbackMaxTokens?: number; // 只在调用方和模型规格均未提供容量时使用
  input: PiModel<PiApi>["input"];
}>;

/** 消费调用方唯一解析的能力，构造 Pi 模型与当前请求思考档位。 */
export function resolve_pi_model(
  snapshot: ModelRequestSnapshot,
  capability: ResolvedModelCapability,
  settings: PiModelSettings,
): {
  model: PiModel<PiApi>;
  thinkingLevel: PiModelThinkingLevel;
  stream: ProviderStreams["stream"];
  streamSimple: ProviderStreams["streamSimple"];
} {
  const api = resolve_pi_api(snapshot.api_format);
  const thinking_level = resolve_pi_thinking_level(
    snapshot.thinking_level,
    capability.available_thinking_levels,
  );
  const compat = {
    ...capability.compat,
    // 产品 Chat Completions 指令使用 `system`；Responses 角色由最终载荷策略拥有。
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
    contextWindow: settings.contextWindow ?? capability.context_window ?? 0,
    maxTokens: settings.maxTokens ?? capability.max_tokens ?? settings.fallbackMaxTokens ?? 0,
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
  capability: ResolvedModelCapability,
): {
  model: PiModel<PiApi>;
  context: Context;
  options: OneShotOptions;
  stream: OneShotStream;
} {
  const generation = resolve_one_shot_generation_options(snapshot);
  const resolved = resolve_pi_model(snapshot, capability, {
    name: snapshot.model_id,
    // Anthropic 要求 max_tokens：显式值冻结总 ceiling，自动值使用模型规格或未知模型回退。
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
            supportsStore: false,
            maxTokensField: "max_tokens",
          },
        }
      : resolved.model;
  const options: OneShotOptions = {
    apiKey: snapshot.api_keys[0] ?? "no_key_required",
    cacheRetention: "none",
    headers: { ...snapshot.headers },
    maxRetries: 0,
    signal,
    ...generation,
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
    onPayload: (payload, active_model) =>
      apply_one_shot_request_overrides(snapshot, payload, signal, active_model.compat),
  };
  // Google / Anthropic 由 `streamSimple` 转换思考档位，OpenAI 直接调用以保留自动输出上限语义。
  const provider_stream =
    snapshot.api_format === "Google" || snapshot.api_format === "Anthropic"
      ? resolved.streamSimple
      : resolved.stream;
  return {
    model,
    context: build_pi_context(snapshot, messages),
    options,
    stream: (active_model, context, active_options) =>
      provider_stream(active_model, normalizeContext(context), active_options),
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
