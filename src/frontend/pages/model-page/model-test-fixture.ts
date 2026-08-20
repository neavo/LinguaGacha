import type { ModelEntrySnapshot } from "@frontend/pages/model-page/types";

/** 为模型页测试提供完整、可按顶层字段覆盖的公开快照。 */
export function create_model_snapshot(
  overrides: Partial<ModelEntrySnapshot> = {},
): ModelEntrySnapshot {
  return {
    id: "model-1",
    type: "PRESET",
    name: "默认模型",
    api_format: "OpenAI",
    api_url: "https://api.example.test",
    api_key: "secret",
    model_id: "alpha-model",
    available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
    agent: {
      context_window: 0,
      max_output_tokens: 0,
    },
    request: {
      extra_headers: { Authorization: "Bearer token" },
      extra_headers_custom_enable: false,
      extra_body: { temperature: 1 },
      extra_body_custom_enable: false,
    },
    threshold: {
      input_token_limit: 0,
      output_token_limit: 0,
      rpm_limit: 0,
      concurrency_limit: 0,
    },
    thinking: { level: "OFF" },
    generation: {
      temperature: 1,
      temperature_custom_enable: false,
      top_p: 1,
      top_p_custom_enable: false,
    },
    ...overrides,
  };
}
