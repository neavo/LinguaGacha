import { describe, expect, it } from "vitest";

import { Model, normalize_model_selection } from "./model";

describe("Model", () => {
  it("从不完整设置生成稳定的模型快照", () => {
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
        presence_penalty: 0,
        presence_penalty_custom_enable: false,
        frequency_penalty: 0,
        frequency_penalty_custom_enable: false,
      },
    });
  });

  it("公开枚举值保持原值，未知值回退到兼容默认值", () => {
    expect(Model.normalize_type("CUSTOM_GOOGLE")).toBe("CUSTOM_GOOGLE");
    expect(Model.normalize_type("unknown")).toBe("PRESET");
    expect(Model.normalize_api_format("Anthropic")).toBe("Anthropic");
    expect(Model.normalize_api_format("unknown")).toBe("OpenAI");
    expect(Model.normalize_thinking_level("HIGH")).toBe("HIGH");
    expect(Model.normalize_thinking_level("unknown")).toBe("OFF");
  });

  it("模型类型决定排序、自定义模板和默认推理能力", () => {
    expect(Model.resolve_type_sort_order("CUSTOM_OPENAI")).toBe(2);
    expect(Model.resolve_type_sort_order("unknown")).toBe(99);
    expect(Model.resolve_template_filename("CUSTOM_ANTHROPIC")).toBe(
      "preset_model_custom_anthropic.json",
    );
    expect(Model.resolve_template_filename("PRESET")).toBeNull();
    expect(Model.api_format_supports_reasoning_by_default("Google")).toBe(true);
    expect(Model.api_format_supports_reasoning_by_default("OpenAI")).toBe(false);
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
