import { afterEach, describe, expect, it, vi } from "vitest";

import { list_available_models } from "./llm-model-catalog";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("llm-model-catalog", () => {
  it.each([
    ["OpenAI", "https://api.example/v1"],
    ["OpenAIResponses", "https://api.example/v1/responses/"],
    ["SakuraLLM", "https://api.example/v1/chat/completions/"],
  ] as const)("%s 模型列表读取 data[].id、排序并附带浏览器 UA", async (api_format, api_url) => {
    const fetch_mock = vi.fn(async () =>
      Response.json({
        data: [{ id: "model-z" }, { id: "" }, { name: "skip" }, { id: "model-a" }],
      }),
    );
    vi.stubGlobal("fetch", fetch_mock);
    await expect(
      list_available_models({
        api_format,
        api_url,
        api_key: "key-a\nkey-b",
        request: {
          extra_headers: { "X-Trace": "trace-1" },
          extra_headers_custom_enable: true,
        },
      }),
    ).resolves.toEqual(["model-a", "model-z"]);

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

  it("Google 模型列表通过 REST 拉取所有页后统一排序", async () => {
    const fetch_mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          models: [{ name: "models/gemini-z" }, { name: "" }, { displayName: "missing-name" }],
          nextPageToken: "page 2",
        }),
      )
      .mockResolvedValueOnce(Response.json({ models: [{ name: "models/gemini-a" }] }));
    vi.stubGlobal("fetch", fetch_mock);
    await expect(
      list_available_models({
        api_format: "Google",
        api_key: "google-key-a\ngoogle-key-b",
        api_url: "https://generativelanguage.googleapis.com",
        request: {
          extra_headers: { "X-Trace": "trace-google" },
          extra_headers_custom_enable: true,
        },
      }),
    ).resolves.toEqual(["models/gemini-a", "models/gemini-z"]);

    const first_url = new URL(String(fetch_mock.mock.calls[0]?.[0]));
    const second_url = new URL(String(fetch_mock.mock.calls[1]?.[0]));
    const page_size = Number(first_url.searchParams.get("pageSize"));
    expect(first_url.origin + first_url.pathname).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    expect(Number.isSafeInteger(page_size)).toBe(true);
    expect(page_size).toBeGreaterThan(0);
    expect(second_url.searchParams.get("pageSize")).toBe(page_size.toString());
    expect(second_url.searchParams.get("pageToken")).toBe("page 2");

    expect(fetch_mock).toHaveBeenNthCalledWith(1, expect.any(String), {
      headers: expect.objectContaining({
        "x-goog-api-key": "google-key-a",
        "User-Agent": expect.stringContaining("Chrome/133"),
        "X-Trace": "trace-google",
      }),
      method: "GET",
    });
    expect(fetch_mock).toHaveBeenNthCalledWith(2, expect.any(String), {
      headers: expect.objectContaining({ "x-goog-api-key": "google-key-a" }),
      method: "GET",
    });
  });

  it("Anthropic 模型列表排序并使用默认地址和供应商请求头", async () => {
    const fetch_mock = vi.fn(async () =>
      Response.json({ data: [{ id: "claude-z" }, { id: "claude-a" }] }),
    );
    vi.stubGlobal("fetch", fetch_mock);
    await expect(
      list_available_models({
        api_format: "Anthropic",
        api_key: "anthropic-key",
        api_url: "",
      }),
    ).resolves.toEqual(["claude-a", "claude-z"]);

    expect(fetch_mock).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      headers: expect.objectContaining({
        "User-Agent": expect.stringContaining("Chrome/133"),
        "anthropic-version": "2023-06-01",
        "x-api-key": "anthropic-key",
      }),
      method: "GET",
    });
  });

  it("远端列表非成功响应转换为模型供应商错误并保留 HTTP 状态", async () => {
    const fetch_mock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetch_mock);

    await expect(
      list_available_models({
        api_format: "OpenAI",
        api_key: "openai-key",
        api_url: "https://api.example/v1",
      }),
    ).rejects.toMatchObject({
      code: "model.provider_failed",
      public_details: { status: 401 },
    });
  });
});
