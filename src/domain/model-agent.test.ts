import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_AGENT_CONFIG,
  parse_model_agent_config,
  parse_model_agent_limits,
  resolve_model_agent_limits,
} from "./model-agent";

describe("模型 Agent 容量", () => {
  it("接受 0 表示自动，并拒绝非安全非负整数", () => {
    expect(parse_model_agent_config(DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 0,
      max_output_tokens: 0,
    });
    expect(parse_model_agent_config({ context_window: 288_000, max_output_tokens: 0 })).toEqual({
      context_window: 288_000,
      max_output_tokens: 0,
    });
    expect(
      parse_model_agent_config({ context_window: 288_000.5, max_output_tokens: 32_000 }),
    ).toBeNull();
    expect(parse_model_agent_config({ context_window: -1, max_output_tokens: 32_000 })).toBeNull();
    expect(
      parse_model_agent_config({
        context_window: Number.MAX_SAFE_INTEGER + 1,
        max_output_tokens: 32_000,
      }),
    ).toBeNull();
  });

  it.each([
    ["openai/gpt-5.6-luna", 353_000],
    ["GROK-4.5-fast", 500_000],
    ["deepseek-v4", 500_000],
  ])("按模型族为 %s 解析自动容量", (model_id, context_window) => {
    expect(resolve_model_agent_limits(model_id, DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window,
      max_output_tokens: 48_000,
    });
  });

  it("未知模型使用稳定兜底容量", () => {
    expect(resolve_model_agent_limits("unknown-model", DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 256_000,
      max_output_tokens: 32_000,
    });
  });

  it("只替换为 0 的字段，并校验最终容量关系", () => {
    expect(
      resolve_model_agent_limits("unknown", {
        context_window: 400_000,
        max_output_tokens: 0,
      }),
    ).toEqual({ context_window: 400_000, max_output_tokens: 32_000 });
    expect(
      resolve_model_agent_limits("unknown", {
        context_window: 0,
        max_output_tokens: 50_000,
      }),
    ).toEqual({ context_window: 256_000, max_output_tokens: 50_000 });
    expect(
      resolve_model_agent_limits("unknown", { context_window: 64_000, max_output_tokens: 0 }),
    ).toBeNull();
    expect(
      parse_model_agent_limits({ context_window: 64_000, max_output_tokens: 32_000 }),
    ).toBeNull();
    expect(parse_model_agent_limits({ context_window: 64_001, max_output_tokens: 32_000 })).toEqual(
      {
        context_window: 64_001,
        max_output_tokens: 32_000,
      },
    );
  });
});
