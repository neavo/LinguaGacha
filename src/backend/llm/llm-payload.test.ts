import { describe, expect, it } from "vitest";

import { apply_request_overrides, apply_one_shot_request_overrides } from "./llm-payload";
import type { ModelRequestSnapshot } from "./llm-request";

describe("Pi 载荷的产品规则", () => {
  it("通用扩展保留原生字段并覆盖同名参数", () => {
    const source = {
      messages: [],
      top_p: 0.8,
      reasoning_effort: "medium",
      thinking: { type: "enabled" },
    };
    const snapshot = create_snapshot({
      extra_body: { top_p: 0.6, reasoning_effort: "high", custom: true },
    });
    const expected = { ...source, top_p: 0.6, reasoning_effort: "high", custom: true };
    expect(apply_request_overrides(snapshot, source)).toEqual(expected);
    expect(source.reasoning_effort).toBe("medium");
  });

  it("Responses 统一指令角色并保留 Items、工具和推理连续性", () => {
    const source = {
      input: [
        { role: "system", content: "rules" },
        { role: "user", content: "hello" },
      ],
      tools: [{ type: "function", name: "lookup" }],
      reasoning: { effort: "medium", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    };
    const snapshot = create_snapshot({
      api_format: "OpenAIResponses",
      extra_body: { reasoning: { effort: "high" } },
    });
    const expected = {
      ...source,
      input: [{ role: "developer", content: "rules" }, source.input[1]],
      reasoning: { effort: "high" },
    };
    expect(apply_request_overrides(snapshot, source)).toEqual(expected);
    expect(source.input[0]?.role).toBe("system");
  });

  it("Anthropic 扩展保留原生思考并合并输出格式，开启思考时清理采样字段", () => {
    const source = {
      messages: [],
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      temperature: 0.4,
    };
    const snapshot = create_snapshot({
      api_format: "Anthropic",
      generation: { top_p_custom_enable: true, top_p: 0.8 },
      extra_body: {
        thinking: { type: "enabled", budget_tokens: 4096 },
        output_config: { effort: "low", format: { type: "json_schema" } },
        top_p: 0.9,
      },
    });
    const expected = {
      messages: [],
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema" } },
    };
    expect(apply_request_overrides(snapshot, source)).toEqual(expected);
    expect(
      apply_one_shot_request_overrides(snapshot, source, new AbortController().signal),
    ).toEqual(expected);
  });

  it("Anthropic 显式关闭思考时删除扩展 effort，保留其余输出配置与采样参数", () => {
    const result = apply_one_shot_request_overrides(
      create_snapshot({
        api_format: "Anthropic",
        generation: { top_p_custom_enable: true, top_p: 0.8 },
        extra_body: { output_config: { effort: "high", format: { type: "json_schema" } } },
      }),
      { thinking: { type: "disabled" } },
      new AbortController().signal,
    );
    expect(result).toEqual({
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema" } },
      top_p: 0.8,
    });
  });

  it("Anthropic 未生成思考设置时允许用户扩展接管", () => {
    const extra_body = { thinking: { type: "adaptive" }, output_config: { effort: "high" } };
    expect(
      apply_request_overrides(create_snapshot({ api_format: "Anthropic", extra_body }), {}),
    ).toEqual(extra_body);
  });

  it.each([0, 2048])("Google 单次输出上限 %s、采样、安全设置和取消信号按产品约定生效", (limit) => {
    const signal = new AbortController().signal;
    const result = apply_one_shot_request_overrides(
      create_snapshot({
        api_format: "Google",
        output_token_limit: limit,
        generation: { top_p_custom_enable: true, top_p: 0.8 },
        extra_body: {
          thinkingConfig: { thinkingBudget: 777 },
          abortSignal: "bad",
          responseMimeType: "application/json",
        },
      }),
      {
        contents: [],
        config: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "HIGH" } },
      },
      signal,
    );
    expect(result).toMatchObject({
      contents: [],
      config: {
        topP: 0.8,
        thinkingConfig: { thinkingLevel: "HIGH" },
        abortSignal: signal,
        responseMimeType: "application/json",
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ],
      },
    });
    if (limit === 0) expect(result).not.toHaveProperty("config.maxOutputTokens");
    else expect(result).toHaveProperty("config.maxOutputTokens", limit);
  });

  it("Google Agent 保留 SDK 工具、思考和生成预算", () => {
    const source = {
      contents: [],
      config: {
        tools: [{ functionDeclarations: [] }],
        toolConfig: { mode: "AUTO" },
        thinkingConfig: { thinkingLevel: "HIGH" },
        maxOutputTokens: 8192,
      },
    };
    expect(
      apply_request_overrides(
        create_snapshot({
          api_format: "Google",
          extra_body: { thinkingConfig: { thinkingBudget: 777 }, custom: true },
        }),
        source,
      ),
    ).toEqual({ ...source, config: { ...source.config, custom: true } });
  });

  it.each([
    ["OpenAI", null],
    ["Google", { contents: [] }],
    ["OpenAIResponses", { input: null }],
  ] as const)("拒绝 %s 的无效 SDK 载荷", (api_format, payload) => {
    expect(() => apply_request_overrides(create_snapshot({ api_format }), payload)).toThrow(
      "runtime.internal_invariant",
    );
  });
  it("保持默认移除自动思考控制，再应用用户扩展", () => {
    const source = { messages: [], reasoning: { effort: "low" }, reasoning_effort: "low" };
    const snapshot = create_snapshot({
      thinking_level: "DEFAULT",
      extra_body: { reasoning_effort: "high" },
    });
    expect(apply_request_overrides(snapshot, source)).toEqual({
      messages: [],
      reasoning_effort: "high",
    });
    expect(source.reasoning).toEqual({ effort: "low" });
  });

  it("保持默认仅清理嵌套控制项，保留其他选项和用户扩展", () => {
    const snapshot = create_snapshot({ thinking_level: "DEFAULT" });
    expect(
      apply_request_overrides(
        snapshot,
        {
          messages: [],
          chat_template_args: { effort: "high", tool_format: "json" },
          thinking_budget_tokens: 1024,
        },
        {
          chatTemplateArgs: { effort: { $var: "thinking.effort" }, tool_format: "json" },
          thinkingTokenBudgetField: "thinking_budget_tokens",
        },
      ),
    ).toEqual({ messages: [], chat_template_args: { tool_format: "json" } });
    expect(
      apply_request_overrides(
        { ...snapshot, api_format: "Anthropic", extra_body: { thinking: { type: "adaptive" } } },
        {
          thinking: { type: "disabled" },
          output_config: { effort: "high", format: { type: "json_schema" } },
        },
      ),
    ).toEqual({
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema" } },
    });
    expect(
      apply_request_overrides(
        {
          ...snapshot,
          api_format: "Google",
          extra_body: { thinkingConfig: { thinkingBudget: 777 } },
        },
        {
          contents: [],
          config: { thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json" },
        },
      ),
    ).toEqual({
      contents: [],
      config: { thinkingConfig: { thinkingBudget: 777 }, responseMimeType: "application/json" },
    });
  });
});

/** 构造请求的最小输入，用例只覆盖相关字段。 */
function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    api_format: "OpenAI",
    api_keys: ["key"],
    base_url: "https://example.test",
    model_id: "custom-model",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
