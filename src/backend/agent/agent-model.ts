import type {
  ProviderStreams,
  Model as PiModel,
  ModelThinkingLevel as PiModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { lazyStream } from "@earendil-works/pi-ai/api/lazy";

import type { JsonRecord } from "../../domain/json";
import { Model, normalize_model_selection } from "../../domain/model";
import { normalize_setting_snapshot } from "../../domain/setting";
import * as AppErrors from "../../shared/error";
import { read_model_request_snapshot, type ModelRequestIdentity } from "../llm/llm-request";
import { apply_request_overrides } from "../llm/llm-payload";
import { resolve_model_capability, type PiCatalogModel } from "../llm/model-capability";
import type { PiModelCatalogReader } from "../llm/pi-model-catalog";
import { resolve_pi_model, type PiApi } from "../llm/llm-pi";
import type { ChatGPTAuthService } from "../auth/chatgpt-auth-service";
import { observe_chatgpt_request } from "../llm/chatgpt-request";
import { read_config_model_records, resolve_model_for_usage } from "../model/model-config-resolver";

/** 每次批量调用解析偏好；固定选择使用保存配置，跟随可按模型能力临时降低思考等级。 */
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
  // 能力集合按等级升序排列；`DEFAULT` 表示平台默认，不参与最低等级选择。
  const level = resolve_model_capability(agent_model, catalog).available_thinking_levels.find(
    (candidate) => candidate !== "DEFAULT",
  );
  if (level === undefined) return agent_model;
  // 副本隔离本次翻译等级与 Agent 会话配置。
  return Model.from_json({ ...agent_model.to_json(), thinking: { level } }, agent_model.id);
}

/** 把当前统一请求快照注册到 Pi 模型集合。 */
export function register_agent_model(
  models: MutableModels,
  config: JsonRecord,
  identity: ModelRequestIdentity,
  catalog: PiModelCatalogReader,
  auth?: Pick<ChatGPTAuthService, "bind" | "resolve">,
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
  const provider_name = `LinguaGacha ${pi.model.provider}`;
  // 模型能力与实际载荷各自保持原有边界，用户扩展在最终 onPayload 生效。
  const configured_stream: ProviderStreams["streamSimple"] = (active_model, context, options) =>
    pi.streamSimple(active_model, context, {
      ...options,
      apiKey: api_key,
      headers: { ...snapshot.headers },
      onPayload: (payload, active_model) =>
        apply_request_overrides(snapshot, payload, active_model.compat),
    });
  if (snapshot.auth_type === "oauth") {
    if (auth === undefined) throw new AppErrors.AppError("model.auth_required");
    const session_id = auth.bind();
    const authenticated_stream =
      (stream: ProviderStreams["streamSimple"]): ProviderStreams["streamSimple"] =>
      (active_model, context, options) =>
        lazyStream(active_model, async () => {
          // 压缩或 SDK 重试可能传回旧 apiKey，真实派发点重新解析并覆盖它。
          const credential = await auth
            .resolve(session_id, options?.signal)
            .catch((error: unknown) => {
              // SDK 的重试入口消费 AssistantMessage；只把已分类的临时故障映射为其标准信号。
              if (
                error instanceof AppErrors.AppError &&
                error.diagnostic_context["retryable"] === true
              )
                throw new Error(`${error.diagnostic_context["status"] ?? 503}: ${error.message}`, {
                  cause: error,
                });
              throw error;
            });
          const observation = observe_chatgpt_request(options?.fetch);
          const source = stream(active_model, context, {
            ...options,
            ...credential,
            ...observation.options,
            maxRetries: 0,
            headers: { ...snapshot.headers },
            onPayload: (payload, model) => apply_request_overrides(snapshot, payload, model.compat),
          });
          return (async function* () {
            for await (const event of source) {
              const failure = observation.failure();
              if (event.type === "error" && failure !== null) {
                yield {
                  ...event,
                  error: {
                    ...event.error,
                    errorMessage: [
                      failure.error.diagnostic_context["status"] ??
                        (failure.retryable ? 503 : undefined),
                      failure.error.diagnostic_context["provider_code"],
                      failure.error.message,
                    ]
                      .filter((part) => part !== undefined)
                      .join(": "),
                  },
                };
              } else yield event;
            }
          })();
        });
    models.setProvider(
      createProvider({
        id: pi.model.provider,
        name: "ChatGPT",
        baseUrl: pi.model.baseUrl,
        models: [pi.model],
        auth: {
          apiKey: {
            name: "ChatGPT",
            check: async () => ({ type: "oauth", source: "ChatGPT" }),
            // 请求派发时由应用认证服务解析凭据，SDK 传入的旧 apiKey 不参与解析。
            resolve: async ({ signal }) => ({
              auth: await auth.resolve(session_id, signal),
              source: "ChatGPT",
            }),
          },
        },
        api: {
          stream: authenticated_stream(pi.stream),
          streamSimple: authenticated_stream(pi.streamSimple),
        },
      }),
    );
  } else {
    models.setProvider(
      createProvider({
        id: pi.model.provider,
        name: provider_name,
        baseUrl: pi.model.baseUrl,
        models: [pi.model],
        auth: {
          apiKey: {
            name: provider_name,
            resolve: async () => ({ auth: { apiKey: api_key }, source: "LinguaGacha" }),
          },
        },
        api: { stream: configured_stream, streamSimple: configured_stream },
      }),
    );
  }
  const model = models.getModel(pi.model.provider, snapshot.model_id) as PiModel<PiApi> | undefined;
  if (model === undefined) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: {
        reason: "agent_registered_model_missing",
        provider: pi.model.provider,
        model_id: snapshot.model_id,
      },
    });
  }
  // 保留产品等级供后续批量调用解析，SDK 等级单独供会话运行使用。
  return {
    model,
    thinkingLevel: pi.thinkingLevel,
    model_config: configured_model,
  };
}
