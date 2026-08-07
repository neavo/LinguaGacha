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

  it("按模型 ID 正则解析预置容量，未知模型回退产品默认", () => {
    expect(resolve_model_agent_limits("openai/gpt-5.6-luna", DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 353_000,
      max_output_tokens: 32_000,
    });
    expect(resolve_model_agent_limits("GROK-4.5-fast", DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 500_000,
      max_output_tokens: 32_000,
    });
    expect(resolve_model_agent_limits("deepseek-v4", DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 500_000,
      max_output_tokens: 32_000,
    });
    expect(resolve_model_agent_limits("unknown-model", DEFAULT_MODEL_AGENT_CONFIG)).toEqual({
      context_window: 256_000,
      max_output_tokens: 32_000,
    });
  });

  it("只替换为 0 的字段，并校验最终容量关系", () => {
    expect(
      resolve_model_agent_limits("gpt-5.6", {
        context_window: 400_000,
        max_output_tokens: 0,
      }),
    ).toEqual({ context_window: 400_000, max_output_tokens: 32_000 });
    expect(
      resolve_model_agent_limits("gpt-5.6", {
        context_window: 0,
        max_output_tokens: 50_000,
      }),
    ).toEqual({ context_window: 353_000, max_output_tokens: 50_000 });
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
