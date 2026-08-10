import { describe, expect, it } from "vitest";

import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import { resolve_model_thinking } from "./model-thinking-policy";

describe("模型思考策略", () => {
  it.each([
    ["OpenAI", "gpt-5.5", "MAX", "max", "max"],
    ["OpenAIResponses", "gpt-5.5", "MAX", "max", "max"],
    ["Anthropic", "claude-opus-4-6", "MAX", "high", "high"],
    ["OpenAI", "kimi-k3", "MEDIUM", "low", "low"],
    ["OpenAI", "kimi-k3", "MAX", "max", "max"],
    ["OpenAI", "deepseek-v4-flash", "LOW", "high", "high"],
    ["OpenAI", "deepseek-v4-flash", "OFF", "off", "disabled"],
    ["Google", "gemini-3.1-pro-preview", "OFF", "low", "low"],
    ["Google", "gemini-3.1-pro-preview", "MEDIUM", "medium", "medium"],
    ["Google", "gemini-3.1-pro-preview", "MAX", "high", "high"],
  ] as const)("%s/%s 把 %s 解析为 %s(%s)", (api_format, model_id, requested, effective, wire) => {
    expect(resolve_model_thinking(api_format, model_id, requested)).toMatchObject({
      effective_level: effective,
      wire_level: wire,
    });
  });

  it.each([
    ["OpenAI", "unknown-model", "HIGH"],
    ["OpenAIResponses", "unknown-model", "MAX"],
    ["Google", "gemini-3-pro-preview", "HIGH"],
    ["Google", "gemini-2.5-flash", "HIGH"],
    ["SakuraLLM", "gpt-5.5", "MAX"],
  ] satisfies ReadonlyArray<readonly [ModelApiFormat, string, ModelThinkingLevel]>)(
    "%s/%s 不猜测 %s 档思考能力",
    (api_format, model_id, requested) => {
      expect(resolve_model_thinking(api_format, model_id, requested)).toBeNull();
    },
  );
});
