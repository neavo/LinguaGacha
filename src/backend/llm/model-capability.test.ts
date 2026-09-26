import { describe, expect, it } from "vitest";

import { Model, type ModelApiFormat } from "../../domain/model";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "../../domain/model-agent";
import {
  type PiCatalogModel,
  adjust_model_thinking_level,
  match_pi_catalog_models,
  resolve_model_capability,
  resolve_pi_thinking_level,
} from "./model-capability";

describe("统一模型能力", () => {
  it("容量聚合后应用产品输出上限，思考能力独立按协议解析", () => {
    const catalog: PiCatalogModel[] = [
      {
        ...create_catalog_model("small-model"),
        contextWindow: 128_000,
        maxTokens: 8_000,
      },
      { ...create_catalog_model("catalog-model"), contextWindow: 128_000, maxTokens: 16_000 },
      { ...create_catalog_model("catalog-model"), contextWindow: 600_000, maxTokens: 8_000 },
      { ...create_catalog_model("small-window"), contextWindow: 128_000, maxTokens: 96_000 },
      { ...create_catalog_model("large-window"), contextWindow: 1_000_000, maxTokens: 256_000 },
    ];
    expect(
      resolve_model_capability(
        create_model("OpenAIResponses", "vendor/catalog-model:fast"),
        catalog,
      ),
    ).toMatchObject({
      context_window: 600_000,
      max_tokens: 16_000,
      agent_limits: { context_window: 600_000, max_output_tokens: 16_000 },
    });
    expect(
      resolve_model_capability(create_model("OpenAIResponses", "small-model"), catalog),
    ).toMatchObject({
      context_window: 128_000,
      max_tokens: 8_000,
      agent_limits: { context_window: 128_000, max_output_tokens: 8_000 },
    });
    expect(
      resolve_model_capability(create_model("Anthropic", "small-model"), catalog),
    ).toMatchObject({
      context_window: 128_000,
      max_tokens: 8_000,
      reasoning: false,
      available_thinking_levels: ["DEFAULT"],
    });
    const small = resolve_model_capability(
      create_model("OpenAIResponses", "small-window"),
      catalog,
    );
    const large = resolve_model_capability(
      create_model("OpenAIResponses", "large-window"),
      catalog,
    );
    expect(large.agent_limits.max_output_tokens).toBeGreaterThan(
      small.agent_limits.max_output_tokens,
    );
    expect(small.agent_limits.max_output_tokens).toBeLessThanOrEqual(small.max_tokens!);
    expect(large.agent_limits.max_output_tokens).toBeLessThanOrEqual(large.max_tokens!);
  });

  it.each(["OpenAI", "OpenAIResponses"] as const)(
    "%s 豆包提供关闭思考与三个独立思考档位",
    (api_format) => {
      const capability = resolve_capability(api_format, "doubao-seed-evolving");

      expect(capability.available_thinking_levels).toEqual([
        "DEFAULT",
        "OFF",
        "LOW",
        "MEDIUM",
        "HIGH",
      ]);
    },
  );

  it("用户非零容量覆盖自动值并保留压缩预留", () => {
    const context_window = 100_000;
    const requested_max_output_tokens = 90_000;
    const model = create_model("OpenAI", "deepseek-flash", {
      context_window,
      max_output_tokens: requested_max_output_tokens,
    });

    expect(resolve_model_capability(model, [])).toMatchObject({
      agent_config: { context_window },
      agent_limits: {
        context_window,
        max_output_tokens: context_window - AGENT_COMPACTION_RESERVE_TOKENS,
      },
    });
  });

  it("开关型思考按当前协议投影档位和历史要求", () => {
    const catalog: PiCatalogModel[] = [
      {
        ...create_catalog_model("toggle-model"),
        api: "openai-completions",
        compat: { thinkingFormat: "deepseek", requiresReasoningContentOnAssistantMessages: true },
      },
    ];
    const completions = resolve_model_capability(create_model("OpenAI", "toggle-model"), catalog);
    expect(completions.available_thinking_levels).toEqual(["DEFAULT", "OFF", "LOW"]);
    expect(completions.compat).toMatchObject({
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    });
    expect(
      resolve_model_capability(create_model("OpenAIResponses", "toggle-model"), catalog)
        .available_thinking_levels,
    ).toEqual(["DEFAULT", "OFF", "LOW", "MEDIUM", "HIGH"]);
  });

  it.each(["OpenAIResponses", "SakuraLLM"] as const)(
    "%s 能力缺失时提供保持默认和安全容量",
    (format) => {
      const capability = resolve_capability(format, "unknown-model");

      expect(capability.available_thinking_levels).toEqual(["DEFAULT"]);
      expect(capability.agent_limits.context_window).toBeGreaterThan(0);
      expect(capability.agent_limits.max_output_tokens).toBeGreaterThan(0);
      expect(capability.agent_limits.max_output_tokens).toBeLessThan(
        capability.agent_limits.context_window,
      );
      expect(resolve_pi_thinking_level("HIGH", capability.available_thinking_levels)).toBe("off");
    },
  );

  it("模型配置归一化时把失效档位调整为更低或最低可用档位", () => {
    expect(adjust_model_thinking_level("MAX", ["OFF", "LOW", "HIGH"])).toBe("HIGH");
    expect(adjust_model_thinking_level("LOW", ["HIGH", "MAX"])).toBe("HIGH");
    expect(adjust_model_thinking_level("HIGH", ["DEFAULT"])).toBe("DEFAULT");
  });

  it("地址、协议与模型共同命中优先于供应商排序，未知地址沿用回退", () => {
    const router: PiCatalogModel = {
      ...create_catalog_model("shared-model"),
      api: "openai-completions",
      provider: "openrouter",
      baseUrl: "https://router.example/v1",
      compat: { thinkingFormat: "openrouter" },
    };
    const hosted: PiCatalogModel = {
      ...router,
      provider: "nvidia",
      baseUrl: "https://hosted.example/v1",
      compat: { supportsReasoningEffort: false },
    };
    const model = Model.from_json(
      {
        api_format: "OpenAI",
        model_id: "shared-model",
        api_url: "https://HOSTED.example:443/v1/chat/completions/",
      },
      "test",
    );
    expect(resolve_model_capability(model, [router, hosted]).compat).toEqual(hosted.compat);
    const relay = Model.from_json(
      { ...model.to_json(), api_url: "https://relay.example/v1" },
      "test",
    );
    expect(resolve_model_capability(relay, [hosted, router]).compat).toEqual(router.compat);
    const other_path = Model.from_json(
      { ...model.to_json(), api_url: "https://hosted.example/other/v1" },
      "test",
    );
    expect(resolve_model_capability(other_path, [hosted, router]).compat).toEqual(router.compat);
    expect(
      resolve_model_capability(model, [router, { ...hosted, api: "openai-responses" }]).compat,
    ).toEqual(router.compat);
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

  it("目录乱序或新增托管平台同名记录不改变可信模板，原厂同协议记录优先", () => {
    const aggregated: PiCatalogModel = {
      ...create_catalog_model("shared-model"),
      provider: "openrouter",
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: null,
        high: "high",
        max: "max",
      },
    };
    const hosted: PiCatalogModel = {
      ...create_catalog_model("shared-model"),
      provider: "nvidia",
      reasoning: false,
    };
    const native: PiCatalogModel = {
      ...create_catalog_model("shared-model"),
      provider: "openai",
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high" },
    };
    for (const catalog of [[aggregated], [hosted, aggregated], [aggregated, hosted]]) {
      expect(
        resolve_model_capability(create_model("OpenAIResponses", "shared-model"), catalog)
          .available_thinking_levels,
      ).toEqual(["DEFAULT", "LOW", "HIGH", "MAX"]);
    }
    const catalog: PiCatalogModel[] = [hosted, aggregated, native];
    expect(
      resolve_model_capability(create_model("OpenAIResponses", "shared-model"), catalog)
        .available_thinking_levels,
    ).toEqual(["DEFAULT", "HIGH"]);
  });

  it("同协议优先于跨协议原厂，未知来源冲突不依赖目录顺序猜测", () => {
    const exact: PiCatalogModel = {
      ...create_catalog_model("shared-model"),
      provider: "openrouter",
      api: "openai-completions",
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high" },
    };
    const catalog: PiCatalogModel[] = [create_catalog_model("shared-model"), exact];
    expect(
      resolve_model_capability(create_model("OpenAI", "shared-model"), catalog)
        .available_thinking_levels,
    ).toEqual(["DEFAULT", "HIGH"]);
    const first = { ...exact, provider: "unknown-one" };
    const second = { ...exact, provider: "unknown-two", reasoning: false };
    for (const catalog of [
      [first, second],
      [second, first],
    ]) {
      expect(
        resolve_model_capability(create_model("OpenAI", "shared-model"), catalog)
          .available_thinking_levels,
      ).toEqual(["DEFAULT"]);
    }
  });

  it("局部模型修正保留同协议目录字段，跨协议仅沿用档位", () => {
    const catalog: PiCatalogModel[] = [
      {
        ...create_catalog_model("grok-4.6"),
        provider: "xai",
        api: "openai-completions",
        compat: {
          supportsStore: false,
          requiresReasoningContentOnAssistantMessages: true,
          supportsReasoningEffort: false,
        },
        thinkingLevelMap: { off: null, low: "low", max: "max" },
      },
    ];
    expect(
      resolve_model_capability(create_model("OpenAI", "grok-4.6"), catalog).compat,
    ).toMatchObject({
      supportsStore: false,
      requiresReasoningContentOnAssistantMessages: true,
      supportsReasoningEffort: true,
      thinkingFormat: "openai",
    });
    const responses = resolve_model_capability(
      create_model("OpenAIResponses", "grok-4.6"),
      catalog,
    );
    expect(responses.compat).toBeUndefined();
    expect(responses.thinking_level_map).toMatchObject({ off: null, max: "max" });
  });
});

/** 以默认用户配置观察公开能力结果。 */
function resolve_capability(api_format: ModelApiFormat, model_id: string) {
  return resolve_model_capability(create_model(api_format, model_id), []);
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
function create_catalog_model(id: string): PiCatalogModel {
  return {
    id,
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: true,
    contextWindow: 0,
    maxTokens: 0,
  };
}
