import { type Model as PiModel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { parse_model_agent_config } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import {
  apply_agent_request_overrides,
  read_model_request_snapshot,
  supports_thinking,
} from "../llm/llm-client-policy";
import { resolve_pi_model } from "../llm/llm-pi";
import { resolve_model_for_usage } from "../model/model-config-resolver";

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

  const snapshot = read_model_request_snapshot(raw_model, user_agent);
  const api_key = snapshot.api_keys[0] ?? "no_key_required";
  const configured_name = String(raw_model["name"] ?? "").trim();
  const request_headers = Object.freeze({ ...snapshot.headers });
  const pi = resolve_pi_model(snapshot, {
    name: configured_name || snapshot.model_id,
    contextWindow: limits.contextWindow,
    maxTokens: limits.maxTokens,
    reasoning: supports_thinking(snapshot),
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
    // Agent 容量已在共享 Pi model 中按当前会话 limits 冻结。
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
