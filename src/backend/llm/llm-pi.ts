import {
  type Context,
  type Model as PiModel,
  type ProviderStreamOptions,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import { RequestValidationError } from "../../shared/error";
import {
  apply_one_shot_request_overrides,
  resolve_one_shot_generation_options,
} from "./llm-client-policy";
import type { LLMMessage } from "./llm-types";
import type { ModelRequestSnapshot } from "./policy/policy-types";

// Pi provider 身份用于 adapter 注册，项目 RequestProvider 仍负责结果和覆盖规则。
type PiApi = "openai-completions" | "anthropic-messages" | "google-generative-ai";
type PiProvider = "openai" | "openai-compatible" | "anthropic" | "google";

/** 调用方拥有显示身份与容量，协议字段统一由本模块补齐。 */
type PiModelSettings = Readonly<{
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}>;

/** OneShot 与 Agent 共用的 Pi model 和惰性 API 解析入口。 */
export function resolve_pi_model(
  snapshot: ModelRequestSnapshot,
  settings: PiModelSettings,
): {
  model: PiModel<PiApi>;
  stream: ProviderStreams["stream"];
  streamSimple: ProviderStreams["streamSimple"];
} {
  const api = resolve_pi_api(snapshot.api_format);
  const model: PiModel<PiApi> = {
    id: snapshot.model_id,
    name: settings.name,
    provider: api.provider,
    api: api.api,
    baseUrl: snapshot.base_url,
    reasoning: settings.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: settings.contextWindow,
    maxTokens: settings.maxTokens,
    headers: { ...snapshot.headers },
    // 自定义 OpenAI-compatible 服务只共同保证 system role；OneShot 会继续冻结旧 payload 形状。
    compat: api.api === "openai-completions" ? { supportsDeveloperRole: false } : undefined,
  };
  return { model, stream: api.stream, streamSimple: api.streamSimple };
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
  stream: ProviderStreams["stream"];
} {
  const generation = resolve_one_shot_generation_options(snapshot);
  const resolved = resolve_pi_model(snapshot, {
    name: snapshot.model_id,
    contextWindow: 0,
    maxTokens: generation.maxTokens ?? 0,
    reasoning: false,
  });
  // OneShot 保持迁移前的 max_tokens、stream_options 与无 store 契约，不采用 URL 猜测。
  const model: PiModel<PiApi> =
    resolved.model.api === "openai-completions"
      ? {
          ...resolved.model,
          compat: {
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
    ...(snapshot.provider === "anthropic" ? { interleavedThinking: false } : {}),
    onPayload: (payload) => apply_one_shot_request_overrides(snapshot, payload, signal),
  };
  return {
    model,
    context: build_pi_context(snapshot, messages),
    options,
    stream: resolved.stream,
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

  if (snapshot.provider === "google") {
    const google_messages =
      system_prompt === ""
        ? user_messages
        : [{ role: "user" as const, content: system_prompt, timestamp: 0 }, ...user_messages];
    assert_non_empty_messages(google_messages.length, snapshot.provider);
    return { messages: google_messages };
  }
  if (snapshot.provider === "anthropic") {
    assert_non_empty_messages(user_messages.length, snapshot.provider);
  } else {
    assert_non_empty_messages(
      user_messages.length + (system_prompt === "" ? 0 : 1),
      snapshot.provider,
    );
  }
  return {
    ...(system_prompt === "" ? {} : { systemPrompt: system_prompt }),
    messages: user_messages,
  };
}

/** 空提示词在发起远端请求前按 provider 语义转为稳定校验错误。 */
function assert_non_empty_messages(
  count: number,
  provider: ModelRequestSnapshot["provider"],
): void {
  if (count > 0) return;
  throw new RequestValidationError({
    public_details: { field: "messages" },
    diagnostic_context: { provider_policy: provider, reason: "empty_messages" },
  });
}
