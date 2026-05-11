import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { ConfigService } from "../service/config-service";
import { AppPathService } from "../service/path-service";
import { PiAiLlmRequestClient } from "../task-worker/llm/pi-ai-llm-request-client";
import { ModelService } from "./model-service";

describe("ModelService 远端模型能力", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("OpenAI-compatible list-available 使用首个 key、自定义 baseUrl 与额外 header", async () => {
    const { service } = await create_model_service([
      create_model({
        id: "openai-1",
        api_format: "OpenAI",
        api_key: "key-a\nkey-b",
        api_url: "https://api.example/v1/chat/completions",
        request: {
          extra_headers_custom_enable: true,
          extra_headers: { "X-Trace": "trace-1" },
        },
      }),
    ]);
    const fetch_mock = vi.fn(async () => json_response({ data: [{ id: "model-a" }] }));
    vi.stubGlobal("fetch", fetch_mock);

    const result = await service.list_available_models({ model_id: "openai-1" });

    expect(result["models"]).toEqual(["model-a"]);
    expect(fetch_mock).toHaveBeenCalledWith(
      "https://api.example/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer key-a",
          "User-Agent": expect.stringContaining("Chrome/133"),
          "X-Trace": "trace-1",
        }),
      }),
    );
  });

  it("Google 与 Anthropic list-available 使用各自实时列表协议", async () => {
    const { service } = await create_model_service([
      create_model({
        id: "google-1",
        api_format: "Google",
        api_key: "google-key",
        api_url: "",
      }),
      create_model({
        id: "anthropic-1",
        api_format: "Anthropic",
        api_key: "anthropic-key",
        api_url: "",
      }),
    ]);
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(json_response({ models: [{ name: "models/gemini-2.5-flash" }] }))
      .mockResolvedValueOnce(json_response({ data: [{ id: "claude-sonnet-4-5" }] }));
    vi.stubGlobal("fetch", fetch_mock);

    const google_result = await service.list_available_models({ model_id: "google-1" });
    const anthropic_result = await service.list_available_models({ model_id: "anthropic-1" });

    expect(google_result["models"]).toEqual(["models/gemini-2.5-flash"]);
    expect(anthropic_result["models"]).toEqual(["claude-sonnet-4-5"]);
    expect(fetch_mock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?key=google-key",
    );
    expect(fetch_mock.mock.calls[1]?.[0]).toBe("https://api.anthropic.com/v1/models");
    expect(fetch_mock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "anthropic-version": "2023-06-01",
        "x-api-key": "anthropic-key",
      }),
    });
  });

  it("模型连通性测试复用 LLM adapter 并按 key 汇总结果", async () => {
    const { service } = await create_model_service([
      create_model({
        id: "test-1",
        api_format: "OpenAI",
        api_key: "1234567890abcdefXYZ\nbad-key",
      }),
    ]);
    const request_mock = vi
      .spyOn(PiAiLlmRequestClient.prototype, "request")
      .mockResolvedValueOnce({
        response_think: "",
        response_result: '{"0":"成功"}',
        input_tokens: 2,
        output_tokens: 3,
        cancelled: false,
        timeout: false,
        degraded: false,
        error: "",
      })
      .mockResolvedValueOnce({
        response_think: "",
        response_result: "",
        input_tokens: 0,
        output_tokens: 0,
        cancelled: false,
        timeout: true,
        degraded: false,
        error: "",
      });

    const result = await service.test_model({ model_id: "test-1" });

    expect(request_mock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      total_count: 2,
      success_count: 1,
      failure_count: 1,
    });
    expect(result["key_results"]).toEqual([
      expect.objectContaining({
        masked_key: "12345678***bcdefXYZ",
        success: true,
        input_tokens: 2,
        output_tokens: 3,
      }),
      expect.objectContaining({
        masked_key: "bad-key",
        success: false,
        error_reason: "请求超时（120 秒）。",
      }),
    ]);
  });
});

/**
 * 构造带最小资源目录的 ModelService，避免用例读取真实预设文件。
 */
async function create_model_service(models: Array<Record<string, ApiJsonValue>>): Promise<{
  service: ModelService;
}> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-model-service-"));
  await write_model_presets(app_root);
  const paths = new AppPathService({ appRoot: app_root });
  const config_service = new ConfigService(paths);
  config_service.save_config({
    activate_model_id: models[0]?.["id"] ?? "",
    models: models as unknown as ApiJsonValue,
  });
  return { service: new ModelService(paths, config_service) };
}

/**
 * 生成默认模型记录，测试只覆盖被 overrides 指定的差异字段。
 */
function create_model(
  overrides: Partial<Record<string, ApiJsonValue>>,
): Record<string, ApiJsonValue> {
  return {
    id: "model-1",
    type: "CUSTOM_OPENAI",
    name: "模型",
    api_format: "OpenAI",
    api_key: "key",
    api_url: "https://api.example/v1",
    model_id: "gpt-5-mini",
    request: {
      extra_headers_custom_enable: false,
      extra_headers: {},
      extra_body_custom_enable: false,
      extra_body: {},
    },
    threshold: { input_token_limit: 512, output_token_limit: 4096 },
    thinking: { level: "OFF" },
    generation: {},
    ...overrides,
  };
}

/**
 * 写入 ModelService 初始化需要的预设文件，内容保持为空以聚焦用户配置。
 */
async function write_model_presets(app_root: string): Promise<void> {
  const preset_dir = path.join(app_root, "resource", "model", "preset");
  await mkdir(preset_dir, { recursive: true });
  await writeFile(path.join(preset_dir, "preset_model_builtin.json"), "[]", "utf-8");
  await writeFile(path.join(preset_dir, "preset_model_custom_google.json"), "{}", "utf-8");
  await writeFile(path.join(preset_dir, "preset_model_custom_openai.json"), "{}", "utf-8");
  await writeFile(path.join(preset_dir, "preset_model_custom_anthropic.json"), "{}", "utf-8");
}

/**
 * 构造 fetch 可消费的 JSON Response，避免每个用例重复序列化。
 */
function json_response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
