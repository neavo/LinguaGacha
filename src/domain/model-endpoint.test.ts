import { describe, expect, it } from "vitest";

import { build_model_request_url, resolve_model_base_url } from "./model-endpoint";

describe("模型接口地址", () => {
  it.each([
    ["OpenAI", "", "https://api.openai.com/v1"],
    ["OpenAI", " https://api.example/v1/responses/ ", "https://api.example/v1"],
    ["Anthropic", "https://proxy.example/anthropic/v1/", "https://proxy.example/anthropic"],
    ["Anthropic", "https://proxy.example/v1/messages", "https://proxy.example"],
    ["Google", "https://proxy.example/v1alpha", "https://proxy.example/v1alpha"],
  ] as const)("%s 按 SDK 契约归一请求根地址 %s", (api_format, api_url, expected) => {
    expect(resolve_model_base_url(api_url, api_format)).toBe(expected);
  });

  it.each([
    ["OpenAI", "https://proxy.example/v1/chat/completions", "/v1/chat/completions"],
    ["OpenAIResponses", "https://proxy.example/v1/chat/completions", "/v1/responses"],
    ["SakuraLLM", "https://proxy.example/v1", "/v1/chat/completions"],
    ["Anthropic", "https://proxy.example/v1", "/v1/messages"],
    ["Google", "https://proxy.example", "/v1beta/models/test-model:streamGenerateContent?alt=sse"],
  ] as const)("%s 预览生成端点", (api_format, api_url, path) => {
    expect(build_model_request_url(api_url, api_format, "test-model")).toBe(
      `https://proxy.example${path}`,
    );
  });

  it.each(["models/gemini-test", "tunedModels/custom-test"])(
    "Google 保留 SDK 识别的模型前缀 %s",
    (model_id) => {
      expect(build_model_request_url("https://proxy.example", "Google", model_id)).toBe(
        `https://proxy.example/v1beta/${model_id}:streamGenerateContent?alt=sse`,
      );
    },
  );
});
