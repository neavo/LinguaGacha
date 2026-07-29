import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { LLMClientPolicy } from "../llm/llm-client-policy";
import { resolve_agent_model, resolve_pi_api } from "./agent-model";

afterEach(() => vi.restoreAllMocks());

describe("Agent 模型桥接", () => {
  it.each([
    ["OpenAI", "openai", "openai-completions"],
    ["SakuraLLM", "openai", "openai-completions"],
    ["Anthropic", "anthropic", "anthropic-messages"],
    ["Google", "google", "google-generative-ai"],
  ] as const)("把 %s 映射到 pi API", (api_format, provider, api) => {
    expect(resolve_pi_api(api_format)).toMatchObject({ provider, api });
  });

  it("把模型 URL 归一委托给统一 LLM policy", () => {
    const normalize = vi
      .spyOn(LLMClientPolicy, "normalize_api_url")
      .mockReturnValue("https://normalized.test/v1");

    const resolved = resolve_agent_model(build_config("SakuraLLM"));

    expect(normalize).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions/",
      "SakuraLLM",
    );
    expect(resolved.model).toMatchObject({
      api: "openai-completions",
      provider: "openai-compatible",
      baseUrl: "https://normalized.test/v1",
    });
  });
});

function build_config(api_format: string): JsonRecord {
  return {
    activate_model_id: "active",
    models: [
      {
        id: "active",
        name: "Test",
        api_format,
        api_url: "https://example.test/v1/chat/completions/",
        api_key: "secret",
        model_id: "test-model",
        threshold: { input_token_limit: 4096, output_token_limit: 1024 },
      },
    ],
  };
}
