import { describe, expect, it } from "vitest";

import { Model } from "./model";

describe("model 基础模型", () => {
  it("序列化请求、阈值和生成参数的公开状态", () => {
    const model = Model.from_json(
      {
        id: "roundtrip-model",
        type: "CUSTOM_OPENAI",
        name: "Roundtrip",
        api_format: "OpenAI",
        api_url: "https://example.com",
        api_key: "secret",
        model_id: "gpt-demo",
        request: {
          extra_headers: { "X-Test": "1" },
          extra_headers_custom_enable: true,
          extra_body: { temperature: 0.2 },
          extra_body_custom_enable: true,
        },
        threshold: {
          input_token_limit: 2048,
          output_token_limit: 8192,
          rpm_limit: 60,
          concurrency_limit: 4,
        },
        generation: {
          temperature: 0.2,
          temperature_custom_enable: true,
          top_p: 0.8,
          top_p_custom_enable: true,
          presence_penalty: 0.3,
          presence_penalty_custom_enable: true,
          frequency_penalty: 0.4,
          frequency_penalty_custom_enable: true,
        },
      },
      "fallback-id",
    );

    expect(model.to_json()).toMatchObject({
      request: {
        extra_headers: { "X-Test": "1" },
        extra_headers_custom_enable: true,
        extra_body: { temperature: 0.2 },
        extra_body_custom_enable: true,
      },
      threshold: {
        input_token_limit: 2048,
        output_token_limit: 8192,
        rpm_limit: 60,
        concurrency_limit: 4,
      },
      generation: {
        temperature: 0.2,
        temperature_custom_enable: true,
        top_p: 0.8,
        top_p_custom_enable: true,
        presence_penalty: 0.3,
        presence_penalty_custom_enable: true,
        frequency_penalty: 0.4,
        frequency_penalty_custom_enable: true,
      },
    });
  });

  it("非法 thinking 档位回退为关闭推理", () => {
    const model = Model.from_json(
      {
        id: "thinking-model",
        thinking: { level: "not-supported" },
      },
      "fallback-id",
    );

    expect(model.to_json()["thinking"]).toEqual({ level: "OFF" });
  });

  it("从模型映射构造嵌套配置并修复非法类型", () => {
    const model = Model.from_json(
      {
        name: "demo-model",
        type: "bad-type",
        api_format: "OpenAI",
        api_url: "https://example.com",
        api_key: "secret",
        model_id: "gpt-demo",
        request: {
          extra_headers: { "X-Trace": "1" },
          extra_headers_custom_enable: true,
        },
        threshold: {
          input_token_limit: 1024,
          concurrency_limit: 2,
        },
        thinking: { level: "HIGH" },
        generation: {
          temperature: 0.1,
          top_p_custom_enable: true,
        },
      },
      "generated-id",
    );

    expect(model.to_json()).toMatchObject({
      id: "generated-id",
      type: "PRESET",
      request: {
        extra_headers: { "X-Trace": "1" },
        extra_headers_custom_enable: true,
      },
      threshold: {
        input_token_limit: 1024,
        output_token_limit: 4096,
        rpm_limit: 0,
        concurrency_limit: 2,
      },
      thinking: { level: "HIGH" },
      generation: {
        temperature: 0.1,
        top_p_custom_enable: true,
      },
    });
  });

  it("输出完整模型快照并暴露预设与自定义判断", () => {
    const model = Model.from_json(
      {
        id: "custom-openai",
        type: "CUSTOM_OPENAI",
        name: "Custom OpenAI",
        api_format: "OpenAI",
        api_url: "https://example.com",
        api_key: "secret",
        model_id: "gpt-demo",
        request: {
          extra_body: { stream: true },
          extra_body_custom_enable: true,
        },
        threshold: { rpm_limit: 120 },
        thinking: { level: "MEDIUM" },
        generation: { temperature: 0.25 },
      },
      "fallback-id",
    );

    expect(model.to_json()).toEqual({
      id: "custom-openai",
      type: "CUSTOM_OPENAI",
      name: "Custom OpenAI",
      api_format: "OpenAI",
      api_url: "https://example.com",
      api_key: "secret",
      model_id: "gpt-demo",
      request: {
        extra_headers: {},
        extra_headers_custom_enable: false,
        extra_body: { stream: true },
        extra_body_custom_enable: true,
      },
      threshold: {
        input_token_limit: 512,
        output_token_limit: 4096,
        rpm_limit: 120,
        concurrency_limit: 0,
      },
      thinking: { level: "MEDIUM" },
      generation: {
        temperature: 0.25,
        temperature_custom_enable: false,
        top_p: 0.95,
        top_p_custom_enable: false,
        presence_penalty: 0,
        presence_penalty_custom_enable: false,
        frequency_penalty: 0,
        frequency_penalty_custom_enable: false,
      },
    });
    expect(model.is_custom()).toBe(true);
    expect(model.is_preset()).toBe(false);
  });

  it("规范化模型类型、API 格式和 thinking 档位", () => {
    expect(Model.normalize_type("CUSTOM_GOOGLE")).toBe("CUSTOM_GOOGLE");
    expect(Model.normalize_type("bad")).toBe("PRESET");
    expect(Model.normalize_api_format("Anthropic")).toBe("Anthropic");
    expect(Model.normalize_api_format("bad")).toBe("OpenAI");
    expect(Model.normalize_thinking_level("HIGH")).toBe("HIGH");
    expect(Model.normalize_thinking_level("bad")).toBe("OFF");
  });

  it("从基础映射派生排序和模板文件", () => {
    expect(Model.resolve_type_sort_order("CUSTOM_OPENAI")).toBe(2);
    expect(Model.resolve_type_sort_order("bad")).toBe(99);
    expect(Model.resolve_template_filename("CUSTOM_ANTHROPIC")).toBe(
      "preset_model_custom_anthropic.json",
    );
    expect(Model.resolve_template_filename("PRESET")).toBeNull();
  });
});
