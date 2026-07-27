import { afterEach, describe, expect, it, vi } from "vitest";

import { list_available_models } from "./llm-model-catalog";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
});
