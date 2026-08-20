import type { Api, Model as PiModel } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { Model, type ModelApiFormat, type ModelThinkingLevel } from "../../domain/model";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  adjust_model_thinking_level,
  match_pi_catalog_models,
  resolve_model_capability,
  resolve_pi_thinking_level,
} from "./model-capability";

describe("统一模型能力", () => {
  it("变种 ID 聚合同一 canonical 模型的全部 Pi 容量", () => {
    const capability = resolve_capability("OpenAIResponses", "vendor/gpt-5.6-luna-fast");

    expect(capability.catalog_context_window).toBe(capability.agent_limits.context_window);
    expect(capability.catalog_max_tokens).toBeGreaterThanOrEqual(
      capability.agent_limits.max_output_tokens,
    );
    expect(capability.available_thinking_levels).toContain("MAX");
  });

  it("自动输出取 Pi 上限与产品档位的较小值", () => {
    const small = resolve_capability("OpenAIResponses", "gpt-5");
    const large = resolve_capability("OpenAI", "deepseek-v4-flash");

    expect(small.agent_limits.max_output_tokens).toBe(32_000);
    expect(large.agent_limits.max_output_tokens).toBe(64_000);
  });

  it("用户非零容量覆盖自动值并保留压缩预留", () => {
    const context_window = 100_000;
    const requested_max_output_tokens = 90_000;
    const model = create_model("OpenAI", "deepseek-v4-flash", {
      context_window,
      max_output_tokens: requested_max_output_tokens,
    });

    expect(resolve_model_capability(model)).toMatchObject({
      agent_config: { context_window },
      agent_limits: {
        context_window,
        max_output_tokens: context_window - AGENT_COMPACTION_RESERVE_TOKENS,
      },
    });
  });

  it("应用修正优先补齐 Grok 4.6 与 DeepSeek V4 Pro 的新档位", () => {
    const grok = resolve_capability("OpenAI", "grok-4.6");
    expect(grok.available_thinking_levels).toEqual(["LOW", "MEDIUM", "HIGH", "XHIGH"]);
    expect(grok.agent_limits.max_output_tokens).toBe(64_000);
    expect(resolve_capability("OpenAI", "deepseek-v4-pro").available_thinking_levels).toEqual([
      "OFF",
      "LOW",
      "HIGH",
      "MAX",
    ]);
  });

  it("MiMo V2.5 在两种 OpenAI 协议中只暴露思考开关", () => {
    for (const api_format of ["OpenAI", "OpenAIResponses"] as const) {
      expect(resolve_capability(api_format, "mimo-v2.5-pro").available_thinking_levels).toEqual([
        "OFF",
        "HIGH",
      ]);
    }
    expect(resolve_capability("OpenAI", "mimo-v2-pro").available_thinking_levels).toEqual([
      "OFF",
      "LOW",
    ]);
  });

  it("未知模型不猜测思考能力并使用安全容量", () => {
    const capability = resolve_capability("OpenAIResponses", "unknown-model");

    expect(capability.available_thinking_levels).toEqual([]);
    expect(capability.agent_limits.context_window).toBeGreaterThan(0);
    expect(capability.agent_limits.max_output_tokens).toBeGreaterThan(0);
    expect(capability.agent_limits.max_output_tokens).toBeLessThan(
      capability.agent_limits.context_window,
    );
    expect(resolve_pi_thinking_level("HIGH", capability.available_thinking_levels)).toBe("off");
  });

  it("模型配置归一化时把失效档位调整为更低或最低可用档位", () => {
    expect(adjust_model_thinking_level("MAX", ["OFF", "LOW", "HIGH"])).toBe("HIGH");
    expect(adjust_model_thinking_level("LOW", ["HIGH", "MAX"])).toBe("HIGH");
    expect(adjust_model_thinking_level("HIGH", [])).toBe("OFF");
  });

  it("精确匹配优先，否则选择最长且唯一的分隔变种", () => {
    const catalog = [
      create_catalog_model("gpt-5.6"),
      create_catalog_model("gpt-5.6-luna"),
      create_catalog_model("model-alpha"),
      create_catalog_model("model-bravo"),
    ];

    expect(match_pi_catalog_models("GPT-5.6", catalog).map((model) => model.id)).toEqual([
      "gpt-5.6",
    ]);
    expect(
      match_pi_catalog_models("vendor/gpt-5.6-luna-fast", catalog).map((model) => model.id),
    ).toEqual(["gpt-5.6-luna"]);
    expect(match_pi_catalog_models("gpt-5.60", catalog)).toEqual([]);
    expect(match_pi_catalog_models("model-alpha+model-bravo", catalog)).toEqual([]);
  });
});

function resolve_capability(api_format: ModelApiFormat, model_id: string) {
  return resolve_model_capability(create_model(api_format, model_id));
}

function create_model(
  api_format: ModelApiFormat,
  model_id: string,
  agent = { context_window: 0, max_output_tokens: 0 },
  thinking_level: ModelThinkingLevel = "OFF",
): Model {
  return Model.from_json(
    {
      api_format,
      model_id,
      agent,
      thinking: { level: thinking_level },
    },
    "test-model",
  );
}

function create_catalog_model(id: string): PiModel<Api> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  };
}
