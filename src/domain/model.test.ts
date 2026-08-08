import { describe, expect, it } from "vitest";

import { is_json_record } from "./json";
import { AGENT_COMPACTION_RESERVE_TOKENS, DEFAULT_MODEL_AGENT_CONFIG } from "./model-agent";
import { MODEL_TYPES, Model, normalize_model_selection } from "./model";

describe("Model", () => {
  it("从不完整及旧设置生成稳定的模型快照", () => {
    const model = Model.from_json(
      {
        name: "demo-model",
        type: "unknown",
        api_format: "unknown",
        request: {
          extra_headers: { "X-Trace": "1" },
          extra_headers_custom_enable: 1,
        },
        threshold: {
          input_token_limit: "1024",
          output_token_limit: "invalid",
          concurrency_limit: 2,
        },
        thinking: { level: "unknown" },
        generation: {
          temperature: 0.1,
          top_p_custom_enable: true,
          presence_penalty: 0.4,
          presence_penalty_custom_enable: true,
          frequency_penalty: 0.5,
          frequency_penalty_custom_enable: true,
        },
      },
      "generated-id",
    );

    expect(model.to_json()).toEqual({
      id: "generated-id",
      type: "PRESET",
      name: "demo-model",
      api_format: "OpenAI",
      api_url: "",
      api_key: "no_key_required",
      model_id: "",
      agent: DEFAULT_MODEL_AGENT_CONFIG,
      request: {
        extra_headers: { "X-Trace": "1" },
        extra_headers_custom_enable: true,
        extra_body: {},
        extra_body_custom_enable: false,
      },
      threshold: {
        input_token_limit: 1024,
        output_token_limit: 4096,
        rpm_limit: 0,
        concurrency_limit: 2,
      },
      thinking: { level: "OFF" },
      generation: {
        temperature: 0.1,
        temperature_custom_enable: false,
        top_p: 0.95,
        top_p_custom_enable: true,
      },
    });
  });

  it("Agent 容量合法时完整往返，超限时调小输出，损坏时整组恢复默认", () => {
    const available_output_tokens = 10_000;
    const adjusted_context_window = AGENT_COMPACTION_RESERVE_TOKENS + available_output_tokens;
    const model = Model.from_json(
      {
        agent: { context_window: 400_000, max_output_tokens: 50_000 },
      },
      "valid-agent",
    );
    const serialized_agent = model.to_json()["agent"];
    expect(serialized_agent).toEqual({ context_window: 400_000, max_output_tokens: 50_000 });
    if (!is_json_record(serialized_agent)) throw new Error("Agent 容量未序列化为对象");
    serialized_agent["context_window"] = 1;
    expect(model.to_json()["agent"]).toEqual({
      context_window: 400_000,
      max_output_tokens: 50_000,
    });
    expect(
      Model.from_json(
        {
          agent: {
            context_window: adjusted_context_window,
            max_output_tokens: adjusted_context_window,
          },
        },
        "adjusted-agent",
      ).to_json()["agent"],
    ).toEqual({
      context_window: adjusted_context_window,
      max_output_tokens: available_output_tokens,
    });
    expect(
      Model.from_json(
        {
          agent: { context_window: AGENT_COMPACTION_RESERVE_TOKENS, max_output_tokens: 1 },
        },
        "dirty-agent",
      ).to_json()["agent"],
    ).toEqual(DEFAULT_MODEL_AGENT_CONFIG);
  });

  it("公开枚举值保持原值，未知值回退到兼容默认值", () => {
    expect(Model.normalize_type("CUSTOM_GOOGLE")).toBe("CUSTOM_GOOGLE");
    expect(Model.normalize_type("CUSTOM_OPENAI_RESPONSES")).toBe("CUSTOM_OPENAI_RESPONSES");
    expect(Model.normalize_type("unknown")).toBe("PRESET");
    expect(Model.normalize_api_format("Anthropic")).toBe("Anthropic");
    expect(Model.normalize_api_format("OpenAIResponses")).toBe("OpenAIResponses");
    expect(Model.normalize_api_format("unknown")).toBe("OpenAI");
    expect(Model.normalize_thinking_level("HIGH")).toBe("HIGH");
    expect(Model.normalize_thinking_level("unknown")).toBe("OFF");
  });

  it("模型类型注册表统一决定排序、自定义模板和思考配置", () => {
    expect(Model.custom_types()).toEqual(MODEL_TYPES.slice(1));
    expect(Model.resolve_type_sort_order("CUSTOM_OPENAI_RESPONSES")).toBe(3);
    expect(Model.resolve_type_sort_order("unknown")).toBe(99);
    expect(Model.resolve_template_filename("CUSTOM_OPENAI_RESPONSES")).toBe(
      "preset_model_custom_openai_responses.json",
    );
    expect(Model.resolve_template_filename("CUSTOM_ANTHROPIC")).toBe(
      "preset_model_custom_anthropic.json",
    );
    expect(Model.resolve_template_filename("PRESET")).toBeNull();
    expect(Model.api_format_supports_thinking_configuration("OpenAIResponses")).toBe(true);
    expect(Model.api_format_supports_thinking_configuration("SakuraLLM")).toBe(false);
  });

  it("模型用途选择只保留规范化后的三个模型 ID", () => {
    expect(
      normalize_model_selection({
        translation: " translation-model ",
        analysis: 7,
        agent: "agent-model",
        unknown: "ignored",
      }),
    ).toEqual({
      translation: "translation-model",
      analysis: "",
      agent: "agent-model",
    });
  });
});
