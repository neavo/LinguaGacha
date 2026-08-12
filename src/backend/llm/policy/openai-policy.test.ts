import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_openai_completions_one_shot_request_overrides,
  apply_openai_completions_request_overrides,
  apply_openai_responses_one_shot_request_overrides,
  apply_openai_responses_request_overrides,
  apply_sakura_one_shot_request_overrides,
  build_openai_thinking_payload,
  normalize_openai_sdk_base_url,
} from "./openai-policy";

describe("OpenAI 请求规则", () => {
  it.each([
    [" https://api.example.com/v1/chat/completions/ ", "https://api.example.com/v1"],
    ["https://api.example.com/v1/responses/", "https://api.example.com/v1"],
  ] as const)("base URL %s 只保留接口根", (source, expected) => {
    expect(normalize_openai_sdk_base_url(source)).toBe(expected);
  });

  it("Chat Completions 补齐 top_p，并让 extra_body 保持最终优先级", () => {
    const payload = apply_openai_completions_one_shot_request_overrides(
      { model: "gpt-5-mini", max_tokens: 4096, reasoning_effort: "medium" },
      create_snapshot({
        generation: {
          top_p_custom_enable: true,
          top_p: 0.9,
        },
        extra_body: { max_tokens: 123, reasoning_effort: "high", custom_flag: true },
      }),
    );

    expect(payload).toMatchObject({
      model: "gpt-5-mini",
      max_tokens: 123,
      reasoning_effort: "high",
      top_p: 0.9,
      custom_flag: true,
    });
  });

  it("Responses 保留 Pi payload、只补 top_p，并让 extra_body 最终覆盖", () => {
    const payload = apply_openai_responses_one_shot_request_overrides(
      {
        input: [
          { role: "system", content: "rules" },
          { role: "user", content: "hello" },
        ],
        store: false,
        reasoning: { effort: "medium" },
      },
      create_snapshot({
        api_format: "OpenAIResponses",
        model_id: "gpt-5.5",
        thinking_level: "MEDIUM",
        generation: {
          top_p_custom_enable: true,
          top_p: 0.8,
        },
        extra_body: { store: true, reasoning: { effort: "high" }, custom_flag: true },
      }),
    );

    expect(payload).toEqual({
      input: [
        { role: "developer", content: "rules" },
        { role: "user", content: "hello" },
      ],
      store: true,
      reasoning: { effort: "high" },
      top_p: 0.8,
      custom_flag: true,
    });
  });

  it("Responses Agent 保留 Pi Items 与 tools，并清除未匹配模型的 Pi reasoning", () => {
    const source = {
      input: [{ role: "system", content: "rules" }, { type: "message" }],
      tools: [{ type: "function", name: "lookup" }],
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
    };

    expect(
      apply_openai_responses_request_overrides(
        source,
        create_snapshot({
          api_format: "OpenAIResponses",
          model_id: "custom-model",
          thinking_level: "HIGH",
          extra_body: { custom_flag: true },
        }),
      ),
    ).toEqual({
      input: [{ role: "developer", content: "rules" }, { type: "message" }],
      tools: source.tools,
      include: source.include,
      custom_flag: true,
    });
    expect(source.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("Sakura 只复用 Chat Completions 生成字段，不注入模型族 thinking", () => {
    const payload = apply_sakura_one_shot_request_overrides(
      { messages: [] },
      create_snapshot({
        api_format: "SakuraLLM",
        model_id: "gpt-5-mini",
        generation: { top_p_custom_enable: true, top_p: 0.8 },
        extra_body: { custom_flag: true },
      }),
    );

    expect(payload).toEqual({ messages: [], top_p: 0.8, custom_flag: true });
  });

  it("Chat Completions 覆盖清除 Pi 思考字段且不修改输入", () => {
    const source = {
      messages: [{ role: "user", content: "こんにちは" }],
      reasoning_effort: "medium",
      reasoning: { effort: "medium" },
      thinking: { type: "enabled" },
      enable_thinking: true,
      chat_template_kwargs: { enable_thinking: true },
    };
    const payload = apply_openai_completions_request_overrides(
      source,
      create_snapshot({
        model_id: "custom-model",
        thinking_level: "MEDIUM",
        extra_body: { reasoning_effort: "high", custom_flag: true },
      }),
    );

    expect(payload).toMatchObject({
      messages: source.messages,
      reasoning_effort: "high",
      custom_flag: true,
    });
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("enable_thinking");
    expect(payload).not.toHaveProperty("chat_template_kwargs");
    expect(source).toHaveProperty("reasoning_effort", "medium");
  });

  it("GPT 最高档原样下传 max", () => {
    expect(build_openai_thinking_payload("OpenAI", "gpt-5.5", "MAX")).toEqual({
      reasoning_effort: "max",
    });
  });

  it.each([
    ["OpenAI", "vendor/GROK-preview", "XHIGH", { reasoning_effort: "xhigh" }],
    ["OpenAIResponses", "vendor/GROK-preview", "XHIGH", { reasoning: { effort: "xhigh" } }],
    ["OpenAI", "glm-5.1", "MAX", { thinking: { type: "enabled" } }],
    ["OpenAI", "deepseek-v4-flash", "OFF", { thinking: { type: "disabled" } }],
    [
      "OpenAI",
      "deepseek-v4-flash",
      "MEDIUM",
      { thinking: { type: "enabled" }, reasoning_effort: "low" },
    ],
    [
      "OpenAI",
      "deepseek-v4-flash",
      "MAX",
      { thinking: { type: "enabled" }, reasoning_effort: "max" },
    ],
    ["OpenAIResponses", "deepseek-v4-pro", "MEDIUM", { reasoning: { effort: "low" } }],
    ["OpenAIResponses", "deepseek-v4-pro", "MAX", { reasoning: { effort: "max" } }],
  ] as const)("%s/%s 为 %s 生成对应协议字段", (api_format, model_id, level, expected) => {
    expect(build_openai_thinking_payload(api_format, model_id, level)).toEqual(expected);
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    api_format: "OpenAI",
    api_keys: ["key"],
    base_url: "https://api.example.com/v1",
    model_id: "gpt-5-mini",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
