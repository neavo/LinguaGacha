import type { ModelThinkingLevel } from "../../../domain/model";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import { invalid_pi_payload, patch_top_p } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

const OPENAI_ENDPOINT_SUFFIX_PATTERN = /\/(?:chat\/completions|responses)$/iu;
const OPENAI_THINKING_FIELDS = [
  "reasoning_effort",
  "reasoning",
  "thinking",
  "enable_thinking",
  "chat_template_kwargs",
] as const;

/** OpenAI SDK 会自行拼接端点，配置只保留 API 根地址。 */
export function normalize_openai_sdk_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(OPENAI_ENDPOINT_SUFFIX_PATTERN, "");
}

/** Chat Completions OneShot 补齐 Pi options 未承载的生成字段。 */
export function apply_openai_completions_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return apply_openai_completions_request_overrides(result, snapshot);
}

/** Responses OneShot 只补当前协议支持且 Pi options 未承载的 top_p。 */
export function apply_openai_responses_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return apply_openai_responses_request_overrides(result, snapshot);
}

/** Sakura 复用 Chat Completions wire 结构，但不应用 OpenAI 模型族思考字段。 */
export function apply_sakura_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return Object.assign(result, snapshot.extra_body);
}

/** Chat Completions 模型族字段由项目策略生成，extra_body 保持最终优先级。 */
export function apply_openai_completions_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  return apply_openai_thinking_request_overrides("OpenAI", payload, snapshot);
}

/** Responses 保留 Pi 生成的 Items 与 tools，项目统一应用指令角色和模型族思考字段。 */
export function apply_openai_responses_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const input = payload["input"];
  if (!Array.isArray(input)) {
    throw invalid_pi_payload("OpenAIResponses", "input");
  }
  const result = {
    ...payload,
    input: input.map((item) =>
      is_json_record(item) && item["role"] === "system" ? { ...item, role: "developer" } : item,
    ),
  };
  return apply_openai_thinking_request_overrides("OpenAIResponses", result, snapshot);
}

/** OpenAI Chat Completions 与 Responses 的模型族差异统一收敛为最终请求字段。 */
export function build_openai_thinking_payload(
  api_format: "OpenAI" | "OpenAIResponses",
  model_id: string,
  level: ModelThinkingLevel,
): JsonRecord | null {
  if (api_format === "OpenAI") {
    // https://developers.openai.com/api/docs/guides/reasoning?api-mode=chat
    if (/gpt/iu.test(model_id)) {
      return { reasoning_effort: level === "OFF" ? "none" : level.toLowerCase() };
    }

    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    if (/grok/iu.test(model_id)) {
      return { reasoning_effort: level === "OFF" ? "low" : level.toLowerCase() };
    }

    // https://docs.volcengine.com/docs/82379/1449737?lang=zh#fc5eac89
    if (/doubao-seed/iu.test(model_id)) {
      return { reasoning_effort: level === "OFF" ? "minimal" : level.toLowerCase() };
    }

    // https://platform.kimi.com/docs/guide/use-thinking-models
    if (/kimi-k3/iu.test(model_id)) {
      return { reasoning_effort: level === "HIGH" ? "high" : "low" };
    }

    // https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    if (/deepseek-v4/iu.test(model_id)) {
      return level === "OFF"
        ? { thinking: { type: "disabled" } }
        : {
            thinking: { type: "enabled" },
            reasoning_effort: level === "MEDIUM" ? "low" : level.toLowerCase(),
          };
    }

    // 其他已知兼容模型只声明思考开关，不猜测供应商档位字段。
    if (/glm|kimi|mimo|deepseek/iu.test(model_id)) {
      return { thinking: { type: level === "OFF" ? "disabled" : "enabled" } };
    }
  }

  if (api_format === "OpenAIResponses") {
    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    if (/grok/iu.test(model_id)) {
      return {
        reasoning: {
          effort: level === "OFF" ? "low" : level.toLowerCase(),
        },
      };
    }

    // https://docs.volcengine.com/docs/82379/1449737?lang=zh#fc5eac89
    if (/doubao-seed/iu.test(model_id)) {
      return {
        reasoning: {
          effort: level === "OFF" ? "minimal" : level.toLowerCase(),
        },
      };
    }

    // https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    if (/deepseek-v4/iu.test(model_id)) {
      return {
        reasoning: {
          effort: level === "OFF" ? "none" : level === "MEDIUM" ? "low" : level.toLowerCase(),
        },
      };
    }

    // https://mimo.mi.com/docs/zh-CN/api/chat/responses
    if (/mimo/iu.test(model_id)) {
      return {
        reasoning: {
          effort: level === "OFF" ? "none" : level.toLowerCase(),
        },
      };
    }

    // https://developers.openai.com/api/docs/guides/reasoning
    if (/gpt/iu.test(model_id)) {
      return {
        reasoning: {
          effort: level === "OFF" ? "none" : level.toLowerCase(),
          ...(level === "OFF" ? {} : { summary: "auto" }),
        },
      };
    }
  }

  return null;
}

/** 清除 Pi 的思考字段后应用项目模型规则；显式 extra_body 始终最后覆盖。 */
function apply_openai_thinking_request_overrides(
  api_format: "OpenAI" | "OpenAIResponses",
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  for (const field of OPENAI_THINKING_FIELDS) {
    delete result[field];
  }
  const thinking = build_openai_thinking_payload(
    api_format,
    snapshot.model_id,
    snapshot.thinking_level,
  );
  if (thinking !== null) {
    Object.assign(result, thinking);
  }
  return Object.assign(result, snapshot.extra_body);
}
