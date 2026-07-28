import { afterEach, describe, expect, it, vi } from "vitest";

import { list_available_models } from "./llm-model-catalog";

const google_genai_mock = vi.hoisted(() => ({
  constructor_options: [] as unknown[],
  list: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI(options: unknown) {
    google_genai_mock.constructor_options.push(options);
    return { models: { list: google_genai_mock.list } };
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  google_genai_mock.constructor_options.length = 0;
  google_genai_mock.list.mockReset();
});

describe("llm-model-catalog", () => {
  it("OpenAI-compatible 模型列表读取 data[].id 并附带浏览器 UA", async () => {
    const fetch_mock = vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-test" }, { id: "" }, { name: "skip" }, { id: "gpt-ok" }],
      }),
    );
    vi.stubGlobal("fetch", fetch_mock);

    await expect(
      list_available_models({
        api_format: "OpenAI",
        api_url: "https://api.example/v1",
        api_key: "key-a\nkey-b",
        request: {
          extra_headers: { "X-Trace": "trace-1" },
          extra_headers_custom_enable: true,
        },
      }),
    ).resolves.toEqual(["gpt-test", "gpt-ok"]);

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

  it("Google 模型列表使用 SDK、首个 key 和归一化后的 baseUrl", async () => {
    google_genai_mock.list.mockResolvedValue(
      create_google_model_pager([
        { name: "models/gemini-2.5-flash" },
        { name: "" },
        { displayName: "missing-name" },
        { name: "models/gemini-2.5-pro" },
      ]),
    );

    await expect(
      list_available_models({
        api_format: "Google",
        api_key: "google-key-a\ngoogle-key-b",
        api_url: "https://generativelanguage.googleapis.com/v1beta",
        request: {
          extra_headers: { "X-Trace": "trace-google" },
          extra_headers_custom_enable: true,
        },
      }),
    ).resolves.toEqual(["models/gemini-2.5-flash", "models/gemini-2.5-pro"]);

    expect(google_genai_mock.list).toHaveBeenCalledWith();
    expect(google_genai_mock.constructor_options).toEqual([
      expect.objectContaining({
        apiKey: "google-key-a",
        httpOptions: expect.objectContaining({
          baseUrl: "https://generativelanguage.googleapis.com",
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("Chrome/133"),
            "X-Trace": "trace-google",
          }),
        }),
      }),
    ]);
  });

  it("Anthropic 模型列表使用默认地址和供应商请求头", async () => {
    const fetch_mock = vi.fn(async () => Response.json({ data: [{ id: "claude-sonnet-4-5" }] }));
    vi.stubGlobal("fetch", fetch_mock);

    await expect(
      list_available_models({
        api_format: "Anthropic",
        api_key: "anthropic-key",
        api_url: "",
      }),
    ).resolves.toEqual(["claude-sonnet-4-5"]);

    expect(fetch_mock).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      headers: expect.objectContaining({
        "User-Agent": expect.stringContaining("Chrome/133"),
        "anthropic-version": "2023-06-01",
        "x-api-key": "anthropic-key",
      }),
      method: "GET",
    });
  });

  it("远端列表非成功响应转换为模型供应商错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );

    await expect(
      list_available_models({
        api_format: "OpenAI",
        api_key: "openai-key",
        api_url: "https://api.example/v1",
      }),
    ).rejects.toMatchObject({ code: "model.provider_failed" });
  });
});

function create_google_model_pager(
  models: Array<{ name?: string; displayName?: string }>,
): AsyncIterable<{ name?: string; displayName?: string }> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* models;
    },
  };
}
