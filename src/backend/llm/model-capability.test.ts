import type { Api, Model as PiModel } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { Model, type ModelApiFormat } from "../../domain/model";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  adjust_model_thinking_level,
  match_pi_catalog_models,
  resolve_model_capability,
  resolve_pi_thinking_level,
} from "./model-capability";

describe("统一模型能力", () => {
  it.each(["OpenAI", "OpenAIResponses"] as const)(
    "%s 修正按名称边界匹配并投影可用思考档位",
    (api_format) => {
      for (const model_id of ["deepseek-flash", "vendor/deepseek-flash:fast"]) {
        expect(resolve_capability(api_format, model_id).available_thinking_levels).toEqual([
          "OFF",
          "LOW",
          "HIGH",
          "MAX",
        ]);
      }
      expect(
        resolve_capability(api_format, "deepseek-flashlight").available_thinking_levels,
      ).toEqual([]);
      expect(resolve_capability(api_format, "deepseek-flashlight").context_window).toBeNull();
    },
  );

  it("容量聚合后应用修正与输出上限，思考能力独立按协议解析", async () => {
    vi.resetModules();
    vi.doMock("@earendil-works/pi-ai/providers/all", () => ({
      getBuiltinProviders: () => ["deepseek"],
      getBuiltinModels: () => [
        {
          ...create_catalog_model("deepseek-flash"),
          contextWindow: 128_000,
          maxTokens: 8_000,
        },
        { ...create_catalog_model("catalog-model"), contextWindow: 128_000, maxTokens: 16_000 },
        { ...create_catalog_model("catalog-model"), contextWindow: 600_000, maxTokens: 8_000 },
      ],
    }));
    try {
      const { resolve_model_capability: resolve } = await import("./model-capability");
      expect(resolve(create_model("OpenAIResponses", "vendor/catalog-model:fast"))).toMatchObject({
        context_window: 600_000,
        max_tokens: 16_000,
        agent_limits: { context_window: 600_000, max_output_tokens: 16_000 },
      });
      expect(resolve(create_model("OpenAIResponses", "deepseek-flash"))).toMatchObject({
        context_window: 1_000_000,
        max_tokens: 384_000,
        agent_limits: { context_window: 1_000_000, max_output_tokens: 64_000 },
      });
      expect(resolve(create_model("Anthropic", "deepseek-flash"))).toMatchObject({
        context_window: 1_000_000,
        max_tokens: 384_000,
        reasoning: false,
        available_thinking_levels: [],
      });
    } finally {
      vi.doUnmock("@earendil-works/pi-ai/providers/all");
      vi.resetModules();
    }
  });

  it.each(["OpenAI", "OpenAIResponses"] as const)(
    "%s 豆包提供关闭思考与三个独立思考档位",
    (api_format) => {
      const capability = resolve_capability(api_format, "doubao-seed-evolving");

      expect(capability.available_thinking_levels).toEqual(["OFF", "LOW", "MEDIUM", "HIGH"]);
    },
  );

  it("自动输出取 Pi 上限与产品档位的较小值", () => {
    const small = resolve_capability("OpenAIResponses", "gpt-5");
    const large = resolve_capability("OpenAI", "deepseek-v4-flash");

    expect(small.agent_limits.max_output_tokens).toBe(32_000);
    expect(large.agent_limits.max_output_tokens).toBe(64_000);
  });

  it("用户非零容量覆盖自动值并保留压缩预留", () => {
    const context_window = 100_000;
    const requested_max_output_tokens = 90_000;
    const model = create_model("OpenAI", "deepseek-flash", {
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

  it.each(["OpenAI", "OpenAIResponses"] as const)(
    "%s DeepSeek V4 Pro 消费原生目录的档位与历史消息要求",
    (api_format) => {
      const deepseek = resolve_capability(api_format, "deepseek-v4-pro");
      expect(deepseek.available_thinking_levels).toEqual(["OFF", "HIGH", "MAX"]);
      expect(deepseek.compat).toMatchObject({
        thinkingFormat: "deepseek",
        requiresReasoningContentOnAssistantMessages: true,
      });
    },
  );

  it("MiMo V2.5 按协议消费 Pi 目录的思考能力与历史消息要求", () => {
    for (const model_id of ["mimo-v2.5", "mimo-v2.5-pro"]) {
      const completions = resolve_capability("OpenAI", model_id);
      expect(completions.available_thinking_levels).toEqual(["OFF", "LOW"]);
      expect(completions.compat).toMatchObject({
        thinkingFormat: "deepseek",
        requiresReasoningContentOnAssistantMessages: true,
      });
      expect(resolve_capability("OpenAIResponses", model_id).available_thinking_levels).toEqual([
        "OFF",
        "LOW",
        "MEDIUM",
        "HIGH",
      ]);
    }
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

/** 以默认用户配置观察公开能力结果。 */
function resolve_capability(api_format: ModelApiFormat, model_id: string) {
  return resolve_model_capability(create_model(api_format, model_id));
}

/** 构造能力解析输入，自动容量与显式容量使用同一归一入口。 */
function create_model(
  api_format: ModelApiFormat,
  model_id: string,
  agent = { context_window: 0, max_output_tokens: 0 },
): Model {
  return Model.from_json(
    {
      api_format,
      model_id,
      agent,
    },
    "test-model",
  );
}

/** 提供独立于供应商目录更新的匹配样本。 */
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
