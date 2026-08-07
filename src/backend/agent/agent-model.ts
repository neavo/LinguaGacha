import { type Model as PiModel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { Model } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import {
  apply_agent_request_overrides,
  model_supports_pi_reasoning,
  read_model_request_snapshot,
} from "../llm/llm-client-policy";
import { resolve_pi_model } from "../llm/llm-pi";
import { resolve_model_for_usage } from "../model/model-config-resolver";

type AgentApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

/** 把当前统一请求快照注册到 coding-agent 模型运行时。 */
export function register_agent_model(
  model_runtime: ModelRuntime,
  config: JsonRecord,
  user_agent: string,
): {
  model: PiModel<AgentApi>;
  thinkingLevel: "off" | "low" | "medium" | "high";
} {
  const raw_model = resolve_model_for_usage(config, "agent");
  if (raw_model === null) throw new AppErrors.ModelNotFoundError();
  const configured_model = Model.from_json(raw_model, String(raw_model["id"] ?? ""));
  const snapshot = read_model_request_snapshot(raw_model, user_agent);
  const api_key = snapshot.api_keys[0] ?? "no_key_required";
  const configured_name = String(raw_model["name"] ?? "").trim();
  const request_headers = Object.freeze({ ...snapshot.headers });
  const pi = resolve_pi_model(snapshot, {
    name: configured_name || snapshot.model_id,
    contextWindow: configured_model.agent_limits.context_window,
    maxTokens: configured_model.agent_limits.max_output_tokens,
    reasoning: model_supports_pi_reasoning(snapshot),
  });
  // ModelRuntime 会合并 SDK 请求选项；最终密钥、请求头和 payload 仍以项目快照为准。
  const force_request_policy = <TOptions extends object>(options?: TOptions) => ({
    ...options,
    apiKey: api_key,
    headers: { ...request_headers },
    onPayload: (payload: unknown) => apply_agent_request_overrides(snapshot, payload),
  });
  const provider_config = {
    name: `LinguaGacha ${pi.model.provider}`,
    baseUrl: pi.model.baseUrl,
    apiKey: api_key,
    api: pi.model.api,
    headers: { ...request_headers },
    authHeader: false,
    models: [pi.model],
    streamSimple: (active_model, context, options) =>
      pi.streamSimple(active_model, context, force_request_policy(options)),
  } satisfies Parameters<ModelRuntime["registerProvider"]>[1];
  model_runtime.registerProvider(pi.model.provider, provider_config);
  const model = model_runtime.getModel(pi.model.provider, snapshot.model_id) as
    | PiModel<AgentApi>
    | undefined;
  if (model === undefined) {
    throw new AppErrors.InternalInvariantError({
      diagnostic_context: {
        reason: "agent_registered_model_missing",
        provider: pi.model.provider,
        model_id: snapshot.model_id,
      },
    });
  }
  return {
    model,
    thinkingLevel: snapshot.thinking_level.toLowerCase() as "off" | "low" | "medium" | "high",
  };
}
