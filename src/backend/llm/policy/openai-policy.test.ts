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
        model_id: "gpt-5.6-luna",
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

  it("Responses Agent 保留 Pi Items 与 tools，并由项目规则重建 reasoning", () => {
    const source = {
      input: [{ role: "system", content: "rules" }, { type: "message" }],
      tools: [{ type: "function", name: "lookup" }],
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high" },
    };

    expect(
      apply_openai_responses_request_overrides(
        source,
        create_snapshot({
          api_format: "OpenAIResponses",
          model_id: "gpt-5.6-luna",
          thinking_level: "HIGH",
          extra_body: { custom_flag: true },
        }),
      ),
    ).toEqual({
      ...source,
      input: [{ role: "developer", content: "rules" }, { type: "message" }],
      reasoning: { effort: "high" },
      custom_flag: true,
    });
    expect(source.reasoning).toEqual({ effort: "high" });
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
        model_id: "kimi-k3",
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

  it.each([
    ["OFF", "low"],
    ["LOW", "low"],
    ["MEDIUM", "low"],
    ["HIGH", "high"],
  ] as const)("Kimi K3 将 %s 映射到 reasoning_effort=%s", (level, effort) => {
    expect(build_openai_thinking_payload("OpenAI", "kimi-k3", level)).toEqual({
      reasoning_effort: effort,
    });
  });

  it.each([
    ["OFF", { thinking: { type: "disabled" } }],
    ["LOW", { thinking: { type: "enabled" }, reasoning_effort: "low" }],
    ["MEDIUM", { thinking: { type: "enabled" }, reasoning_effort: "low" }],
    ["HIGH", { thinking: { type: "enabled" }, reasoning_effort: "high" }],
  ] as const)("DeepSeek V4 Flash/Pro 保持 %s 挡映射", (level, expected) => {
    expect(build_openai_thinking_payload("OpenAI", "deepseek-v4-flash", level)).toEqual(expected);
    expect(build_openai_thinking_payload("OpenAI", "deepseek-v4-pro", level)).toEqual(expected);
  });

  it("区分其余已支持与未匹配的 Chat Completions 模型族", () => {
    expect(build_openai_thinking_payload("OpenAI", "gpt-5.6-luna", "OFF")).toEqual({
      reasoning_effort: "none",
    });
    expect(build_openai_thinking_payload("OpenAI", "qwen2.5-plus", "OFF")).toBeNull();
    expect(build_openai_thinking_payload("OpenAI", "doubao-seed-1-5", "OFF")).toEqual({
      reasoning_effort: "minimal",
    });
    expect(build_openai_thinking_payload("OpenAI", "mimo-v1-flash", "OFF")).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it.each([
    ["OFF", { reasoning: { effort: "none" } }],
    ["LOW", { reasoning: { effort: "low" } }],
    ["MEDIUM", { reasoning: { effort: "medium" } }],
    ["HIGH", { reasoning: { effort: "high" } }],
  ] as const)("GPT-5.6 Responses 将 %s 映射为项目 reasoning 字段", (level, expected) => {
    expect(build_openai_thinking_payload("OpenAIResponses", "openai/gpt-5.6-luna", level)).toEqual(
      expected,
    );
  });

  it.each(["qwen2.5-plus", "custom-reasoning-model"])(
    "Responses 不为未收录模型 %s 猜测思考字段",
    (model_id) => {
      expect(build_openai_thinking_payload("OpenAIResponses", model_id, "HIGH")).toBeNull();
    },
  );
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
