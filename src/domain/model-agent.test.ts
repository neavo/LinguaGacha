import { describe, expect, it } from "vitest";

import {
  AGENT_COMPACTION_RESERVE_TOKENS,
  DEFAULT_MODEL_AGENT_CONFIG,
  normalize_model_agent_config,
  parse_model_agent_limits,
} from "./model-agent";

describe("模型 Agent 持久化容量", () => {
  it("保留自动或合法配置，损坏配置恢复自动", () => {
    expect(normalize_model_agent_config(DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      config: DEFAULT_MODEL_AGENT_CONFIG,
      adjusted: false,
    });
    expect(
      normalize_model_agent_config({ context_window: 288_000, max_output_tokens: 32_000 }),
    ).toEqual({
      config: { context_window: 288_000, max_output_tokens: 32_000 },
      adjusted: false,
    });
    for (const invalid_config of [
      { context_window: 288_000.5, max_output_tokens: 32_000 },
      { context_window: -1, max_output_tokens: 32_000 },
      { context_window: Number.MAX_SAFE_INTEGER + 1, max_output_tokens: 32_000 },
    ]) {
      expect(normalize_model_agent_config(invalid_config)).toEqual({
        config: DEFAULT_MODEL_AGENT_CONFIG,
        adjusted: true,
      });
    }
  });

  it("只在两项均显式时收窄超限输出", () => {
    expect(normalize_model_agent_config({ context_window: 400_000, max_output_tokens: 0 })).toEqual(
      {
        config: { context_window: 400_000, max_output_tokens: 0 },
        adjusted: false,
      },
    );
    expect(normalize_model_agent_config({ context_window: 0, max_output_tokens: 50_000 })).toEqual({
      config: { context_window: 0, max_output_tokens: 50_000 },
      adjusted: false,
    });

    const available_output_tokens = 10_000;
    const context_window = AGENT_COMPACTION_RESERVE_TOKENS + available_output_tokens;
    expect(
      normalize_model_agent_config({ context_window, max_output_tokens: context_window }),
    ).toEqual({
      config: { context_window, max_output_tokens: available_output_tokens },
      adjusted: true,
    });
  });

  it("生效容量必须容纳固定压缩预留", () => {
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
});
