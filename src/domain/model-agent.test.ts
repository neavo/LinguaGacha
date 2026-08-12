import { describe, expect, it } from "vitest";

import {
  AGENT_COMPACTION_RESERVE_TOKENS,
  DEFAULT_MODEL_AGENT_CONFIG,
  parse_model_agent_limits,
  resolve_model_agent_config,
} from "./model-agent";

describe("模型 Agent 容量", () => {
  it("所有包含 grok 的模型都使用 Grok 自动容量规则", () => {
    const grok_limits = resolve_model_agent_config(
      "vendor/GROK-preview",
      DEFAULT_MODEL_AGENT_CONFIG,
    ).limits;
    const fallback_limits = resolve_model_agent_config(
      "vendor/model-preview",
      DEFAULT_MODEL_AGENT_CONFIG,
    ).limits;

    expect(grok_limits).not.toEqual(fallback_limits);
  });

  it("保留合法配置与 0/0 自动配置，损坏配置整组恢复自动", () => {
    expect(resolve_model_agent_config("unknown", DEFAULT_MODEL_AGENT_CONFIG)).toMatchObject({
      config: DEFAULT_MODEL_AGENT_CONFIG,
      adjusted: false,
    });
    expect(
      resolve_model_agent_config("unknown", {
        context_window: 288_000,
        max_output_tokens: 32_000,
      }),
    ).toEqual({
      config: { context_window: 288_000, max_output_tokens: 32_000 },
      limits: { context_window: 288_000, max_output_tokens: 32_000 },
      adjusted: false,
    });
    for (const invalid_config of [
      { context_window: 288_000.5, max_output_tokens: 32_000 },
      { context_window: -1, max_output_tokens: 32_000 },
      { context_window: Number.MAX_SAFE_INTEGER + 1, max_output_tokens: 32_000 },
    ]) {
      const resolved = resolve_model_agent_config("unknown", invalid_config);
      expect(resolved.config).toEqual(DEFAULT_MODEL_AGENT_CONFIG);
      expect(resolved.adjusted).toBe(true);
      expect(resolved.limits.context_window).toBeGreaterThan(0);
      expect(resolved.limits.max_output_tokens).toBeGreaterThan(0);
    }
  });

  it("只替换为 0 的字段，并校验最终容量关系", () => {
    const automatic_output = resolve_model_agent_config("unknown", {
      context_window: 400_000,
      max_output_tokens: 0,
    }).limits;
    expect(automatic_output.context_window).toBe(400_000);
    expect(automatic_output.max_output_tokens).toBeGreaterThan(0);

    const automatic_context = resolve_model_agent_config("unknown", {
      context_window: 0,
      max_output_tokens: 50_000,
    }).limits;
    expect(automatic_context.context_window).toBeGreaterThan(0);
    expect(automatic_context.max_output_tokens).toBe(50_000);

    expect(
      parse_model_agent_limits({
        context_window: 32_000 + AGENT_COMPACTION_RESERVE_TOKENS - 1,
        max_output_tokens: 32_000,
      }),
    ).toBeNull();
    expect(
      parse_model_agent_limits({
        context_window: 32_000 + AGENT_COMPACTION_RESERVE_TOKENS,
        max_output_tokens: 32_000,
      }),
    ).toEqual({
      context_window: 32_000 + AGENT_COMPACTION_RESERVE_TOKENS,
      max_output_tokens: 32_000,
    });
  });

  it("自动调小超过上下文与固定预留之和的最大输出", () => {
    const available_output_tokens = 10_000;
    const context_window = AGENT_COMPACTION_RESERVE_TOKENS + available_output_tokens;
    expect(
      resolve_model_agent_config("unknown", {
        context_window,
        max_output_tokens: context_window,
      }),
    ).toEqual({
      config: { context_window, max_output_tokens: available_output_tokens },
      limits: { context_window, max_output_tokens: available_output_tokens },
      adjusted: true,
    });
    const reset = resolve_model_agent_config("unknown", {
      context_window: AGENT_COMPACTION_RESERVE_TOKENS,
      max_output_tokens: 1,
    });
    expect(reset.config).toEqual(DEFAULT_MODEL_AGENT_CONFIG);
    expect(reset.adjusted).toBe(true);
    expect(reset.limits.context_window).toBeGreaterThan(AGENT_COMPACTION_RESERVE_TOKENS);
  });
});
