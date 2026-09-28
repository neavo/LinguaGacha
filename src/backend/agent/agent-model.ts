import {
  type Model as PiModel,
  type ModelThinkingLevel as PiModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { Model, normalize_model_selection } from "../../domain/model";
import { normalize_setting_snapshot } from "../../domain/setting";
import * as AppErrors from "../../shared/error";
import { read_model_request_snapshot, type ModelRequestIdentity } from "../llm/llm-request";
import { apply_request_overrides } from "../llm/llm-payload";
import { resolve_model_capability, type PiCatalogModel } from "../llm/model-capability";
import type { PiModelCatalogReader } from "../llm/pi-model-catalog";
import { resolve_pi_model, type PiApi } from "../llm/llm-pi";
import { read_config_model_records, resolve_model_for_usage } from "../model/model-config-resolver";

/** 每次批量调用解析偏好；固定选择使用保存配置，跟随可按模型能力临时降低思考档位。 */
export function resolve_agent_batch_translation_model(
  config: JsonRecord,
  agent_model: Model,
  catalog: readonly PiCatalogModel[],
): Model {
  const model_id = normalize_model_selection(config["model_selection"]).agent_batch_translation;
  if (model_id !== null) {
    const model = read_config_model_records(config).find((item) => item["id"] === model_id);
    if (model === undefined) throw new AppErrors.AppError("model.not_found");
    return Model.from_json(model, model_id);
  }
  if (!normalize_setting_snapshot(config).agent_batch_translation_thinking_adaptive_enable)
    return agent_model;
  // 能力集合按档位升序排列；`DEFAULT` 表示平台默认，不参与最低档位选择。
  const level = resolve_model_capability(agent_model, catalog).available_thinking_levels.find(
    (candidate) => candidate !== "DEFAULT",
  );
  if (level === undefined) return agent_model;
  // 副本隔离本次翻译档位与 Agent 会话配置。
  return Model.from_json({ ...agent_model.to_json(), thinking: { level } }, agent_model.id);
}

/** 把当前统一请求快照注册到 coding-agent 模型运行时。 */
export function register_agent_model(
  model_runtime: ModelRuntime,
  config: JsonRecord,
  identity: ModelRequestIdentity,
  catalog: PiModelCatalogReader,
): {
  model: PiModel<PiApi>;
  thinkingLevel: PiModelThinkingLevel;
  model_config: Model;
} {
  const raw_model = resolve_model_for_usage(config, "agent");
  if (raw_model === null) throw new AppErrors.AppError("model.not_found");
  const configured_model = Model.from_json(raw_model, String(raw_model["id"] ?? ""));
  const capability = resolve_model_capability(configured_model, catalog.read_models());
  const snapshot = read_model_request_snapshot(raw_model, identity);
  const api_key = snapshot.api_keys[0] ?? "no_key_required";
  const configured_name = String(raw_model["name"] ?? "").trim();
  const pi = resolve_pi_model(snapshot, capability, {
    name: configured_name || snapshot.model_id,
    contextWindow: capability.agent_limits.context_window,
    maxTokens: capability.agent_limits.max_output_tokens,
    input: ["text", "image"],
  });
  const provider_config = {
    name: `LinguaGacha ${pi.model.provider}`,
    baseUrl: pi.model.baseUrl,
    apiKey: api_key,
    api: pi.model.api,
    authHeader: false,
    models: [pi.model],
    // SDK 压缩可使用独立路由身份，最终请求仍采用产品对话身份及本轮配置。
    streamSimple: (active_model, context, options) =>
      pi.streamSimple(active_model, context, {
        ...options,
        apiKey: api_key,
        headers: { ...snapshot.headers },
        onPayload: (payload, active_model) =>
          apply_request_overrides(snapshot, payload, active_model.compat),
      }),
  } satisfies Parameters<ModelRuntime["registerProvider"]>[1];
  model_runtime.registerProvider(pi.model.provider, provider_config);
  const model = model_runtime.getModel(pi.model.provider, snapshot.model_id) as
    | PiModel<PiApi>
    | undefined;
  if (model === undefined) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: {
        reason: "agent_registered_model_missing",
        provider: pi.model.provider,
        model_id: snapshot.model_id,
      },
    });
  }
  // 保留产品档位供后续批量调用解析，SDK 档位单独供会话运行使用。
  return {
    model,
    thinkingLevel: pi.thinkingLevel,
    model_config: configured_model,
  };
}
