import { type Model as PiModel, type ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { parse_model_agent_config, type ModelApiFormat } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import { LLMClientPolicy } from "../llm/llm-client-policy";
import { resolve_model_for_usage } from "../model/model-config-resolver";

type AgentProviderId = "openai" | "openai-compatible" | "anthropic" | "google";
type AgentApi = "openai-completions" | "anthropic-messages" | "google-generative-ai";

/** Provider 与 AgentSession 共用的当前对话容量快照。 */
export type AgentModelLimits = Readonly<{
  contextWindow: number; // 当前对话冻结的上下文总容量
  maxTokens: number; // 当前对话冻结的单次输出与压缩预留容量
}>;

/**
 * 把统一请求快照注册到当前 coding-agent 模型运行时；已有对话可覆盖并冻结容量。
 */
export function register_agent_model(
  model_runtime: ModelRuntime,
  config: JsonRecord,
  user_agent: string,
  frozen_limits?: AgentModelLimits,
): {
  model: PiModel<AgentApi>;
  thinkingLevel: "off" | "low" | "medium" | "high";
} {
  const raw_model = resolve_model_for_usage(config, "agent");
  if (raw_model === null) throw new AppErrors.ModelNotFoundError();
  const agent_config = parse_model_agent_config(raw_model["agent"]);
  if (agent_config === null) {
    throw new AppErrors.InternalInvariantError({
      diagnostic_context: { reason: "invalid_normalized_agent_model_config" },
    });
  }
  const limits =
    frozen_limits ??
    Object.freeze({
      contextWindow: agent_config.context_window,
      maxTokens: agent_config.max_output_tokens,
    });

  const policy = new LLMClientPolicy(user_agent);
  const snapshot = policy.read_model_snapshot(raw_model);
  const api = resolve_pi_api(snapshot.api_format);
  const api_key = snapshot.api_keys[0] ?? "no_key_required";
  const configured_name = String(raw_model["name"] ?? "").trim();
  const request_headers = Object.freeze({ ...snapshot.headers });
  // ModelRuntime 会合并 SDK 请求选项；最终密钥、请求头和 payload 仍以项目快照为准。
  const force_request_policy = <TOptions extends object>(options?: TOptions) => ({
    ...options,
    apiKey: api_key,
    headers: { ...request_headers },
    onPayload: (payload: unknown) => policy.apply_request_overrides(snapshot, payload),
  });
  const provider_config = {
    name: `LinguaGacha ${api.provider}`,
    baseUrl: snapshot.base_url,
    apiKey: api_key,
    api: api.api,
    headers: { ...request_headers },
    authHeader: false,
    models: [
      {
        id: snapshot.model_id,
        name: configured_name || snapshot.model_id,
        api: api.api,
        baseUrl: snapshot.base_url,
        reasoning: policy.supports_thinking(snapshot),
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        // Agent 容量在新对话创建时冻结；换模只刷新请求能力。
        contextWindow: limits.contextWindow,
        maxTokens: limits.maxTokens,
        headers: { ...request_headers },
        // developer 不是 OpenAI-compatible 的共同能力，统一保持 system 角色基线。
        compat: api.api === "openai-completions" ? { supportsDeveloperRole: false } : undefined,
      },
    ],
    streamSimple: (active_model, context, options) =>
      api.streamSimple(active_model, context, force_request_policy(options)),
  } satisfies Parameters<ModelRuntime["registerProvider"]>[1];
  model_runtime.registerProvider(api.provider, provider_config);
  const model = model_runtime.getModel(api.provider, snapshot.model_id) as
    | PiModel<AgentApi>
    | undefined;
  if (model === undefined) {
    throw new AppErrors.InternalInvariantError({
      diagnostic_context: {
        reason: "agent_registered_model_missing",
        provider: api.provider,
        model_id: snapshot.model_id,
      },
    });
  }
  return {
    model,
    thinkingLevel: snapshot.thinking_level.toLowerCase() as "off" | "low" | "medium" | "high",
  };
}

/**
 * 将 LinguaGacha 的供应商枚举映射到 pi-ai 的惰性 API 实现。
 */
function resolve_pi_api(api_format: ModelApiFormat): {
  provider: AgentProviderId;
  api: AgentApi;
  streamSimple: ProviderStreams["streamSimple"];
} {
  if (api_format === "SakuraLLM") {
    return {
      provider: "openai-compatible",
      api: "openai-completions",
      streamSimple: openAICompletionsApi().streamSimple,
    };
  }
  if (api_format === "Anthropic") {
    return {
      provider: "anthropic",
      api: "anthropic-messages",
      streamSimple: anthropicMessagesApi().streamSimple,
    };
  }
  if (api_format === "Google") {
    return {
      provider: "google",
      api: "google-generative-ai",
      streamSimple: googleGenerativeAIApi().streamSimple,
    };
  }
  return {
    provider: "openai",
    api: "openai-completions",
    streamSimple: openAICompletionsApi().streamSimple,
  };
}
