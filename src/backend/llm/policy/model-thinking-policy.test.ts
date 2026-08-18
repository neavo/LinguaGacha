import { describe, expect, it } from "vitest";

import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import {
  resolve_effective_model_thinking_level,
  resolve_model_thinking,
} from "./model-thinking-policy";

describe("模型思考策略", () => {
  it("GLM-5.2 只登记 minimal、high、max 并复用统一向下降挡", () => {
    const resolved = resolve_model_thinking("OpenAI", "vendor/GLM-5.2", "HIGH");

    expect(resolved).toMatchObject({
      payload_kind: "openai_effort",
      effective_level: "high",
      wire_level: "high",
      thinking_level_map: {
        off: null,
        minimal: "minimal",
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    });
  });

  it("GLM-5.3 只登记 low、high、max 并复用统一向下降挡", () => {
    const resolved = resolve_model_thinking("OpenAI", "vendor/GLM-5.3", "XHIGH");

    expect(resolved).toMatchObject({
      payload_kind: "openai_effort",
      effective_level: "high",
      wire_level: "high",
      thinking_level_map: {
        off: null,
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    });
  });

  it.each([
    ["OpenAI", "unknown-model", "HIGH"],
    ["OpenAI", "deepseek-v3", "HIGH"],
    ["OpenAIResponses", "unknown-model", "MAX"],
    ["Google", "gemini-3-pro-preview", "HIGH"],
    ["Google", "gemini-2.5-flash", "HIGH"],
    ["Anthropic", "claude-opus-5", "HIGH"],
    ["SakuraLLM", "gpt-5.5", "MAX"],
  ] satisfies ReadonlyArray<readonly [ModelApiFormat, string, ModelThinkingLevel]>)(
    "%s/%s 不猜测 %s 档思考能力",
    (api_format, model_id, requested) => {
      expect(resolve_model_thinking(api_format, model_id, requested)).toBeNull();
    },
  );

  it("对 Pi catalog 能力保持产品向下降档语义", () => {
    const level_map = {
      off: null,
      minimal: null,
      low: "LOW",
      medium: null,
      high: "HIGH",
    };

    expect(resolve_effective_model_thinking_level(true, level_map, "MEDIUM")).toBe("low");
    expect(resolve_effective_model_thinking_level(true, level_map, "OFF")).toBe("low");
    expect(resolve_effective_model_thinking_level(true, level_map, "MAX")).toBe("high");
    expect(resolve_effective_model_thinking_level(false, level_map, "MAX")).toBe("off");
  });
});
