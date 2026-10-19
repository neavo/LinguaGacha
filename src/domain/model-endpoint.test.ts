import { describe, expect, it } from "vitest";

import {
  build_model_request_url,
  resolve_model_base_url,
  resolve_model_endpoint,
} from "./model-endpoint";

describe("模型接口地址", () => {
  it.each([
    [
      "https://aiplatform.googleapis.com",
      "gemini-test",
      "https://aiplatform.googleapis.com/v1",
      "gemini-test",
    ],
    [
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/",
      "models/gemini-test",
      "https://aiplatform.googleapis.com/v1beta1",
      "gemini-test",
    ],
    [
      "https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/publishers/google",
      "gemini-test",
      "https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1",
      "gemini-test",
    ],
    [
      "https://europe-west4-aiplatform.googleapis.com/projects/demo/locations/europe-west4",
      "publishers/google/models/gemini-test",
      "https://europe-west4-aiplatform.googleapis.com/v1/projects/demo/locations/europe-west4",
      "gemini-test",
    ],
    [
      "https://aiplatform.googleapis.com/v1",
      "projects/demo/locations/global/publishers/google/models/gemini-test",
      "https://aiplatform.googleapis.com/v1/projects/demo/locations/global",
      "gemini-test",
    ],
  ])("Vertex 连接与预览共用资源规则：%s", (url, model, base_url, model_id) => {
    const endpoint = resolve_model_endpoint(url, "Google", model);
    expect(endpoint).toEqual({ api: "google-vertex", base_url, model_id, error: null });
    expect(build_model_request_url(url, "Google", model)).toBe(
      `${base_url}/publishers/google/models/${model_id}:streamGenerateContent?alt=sse`,
    );
  });

  it.each([
    ["https://aiplatform.googleapis.com/v1beta1/projects/demo", "gemini-test", "vertex_path"],
    ["https://aiplatform.googleapis.com/v1/publishers/other", "gemini-test", "vertex_path"],
    ["https://aiplatform.googleapis.com/v1?key=secret", "gemini-test", "vertex_path"],
    [
      "https://aiplatform.googleapis.com/v1",
      "projects/demo/locations/global/models/gemini-test",
      "vertex_model",
    ],
    [
      "https://aiplatform.googleapis.com/v1/projects/demo/locations/global",
      "projects/other/locations/global/publishers/google/models/gemini-test",
      "vertex_scope",
    ],
    [
      "https://aiplatform.googleapis.com/v1/projects/demo/locations/global",
      "projects/demo/locations/us-central1/publishers/google/models/gemini-test",
      "vertex_scope",
    ],
  ])("Vertex 配置错误可定位：%s", (url, model, error) => {
    expect(resolve_model_endpoint(url, "Google", model).error).toBe(error);
  });

  it.each([
    "https://aiplatform.googleapis.com.proxy.example/v1",
    "https://vertex.example/v1",
    "https://fake-aiplatform.googleapis.com/v1",
    "https://generativelanguage.googleapis.com/v1alpha",
  ])("第三方与 Developer 地址保留 Google 兼容语义：%s", (url) => {
    expect(resolve_model_endpoint(url, "Google", "gemini-test")).toMatchObject({
      api: "google-generative-ai",
      base_url: url,
      model_id: "gemini-test",
      error: null,
    });
  });

  it("只有 Google 产品协议识别 Vertex", () => {
    expect(
      resolve_model_endpoint("https://aiplatform.googleapis.com/v1", "OpenAI", "gemini-test").api,
    ).toBe("OpenAI");
  });

  it("Vertex 短名称与完整资源名指向同一请求地址", () => {
    const scoped =
      "https://aiplatform.googleapis.com/v1/projects/gemini-4-project/locations/global";
    const full_id =
      "projects/gemini-4-project/locations/global/publishers/google/models/gemini-2.5-flash";
    expect(resolve_model_endpoint(scoped, "Google", "gemini-2.5-flash")).toEqual(
      resolve_model_endpoint("https://aiplatform.googleapis.com/v1", "Google", full_id),
    );
    expect(build_model_request_url(scoped, "Google", "gemini-2.5-flash")).toBe(
      build_model_request_url("https://aiplatform.googleapis.com/v1", "Google", full_id),
    );
  });

  it.each(["gemini-test", "models/gemini-test", "tunedModels/custom-test", "vendor/custom-model"])(
    "Developer 与第三方 Google 的 SDK 模型身份保留输入：%s",
    (model_id) => {
      expect(
        resolve_model_endpoint("https://proxy.example/v1beta", "Google", model_id).model_id,
      ).toBe(model_id);
    },
  );
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
