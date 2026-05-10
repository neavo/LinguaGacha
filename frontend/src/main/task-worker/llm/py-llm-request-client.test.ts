import { afterEach, describe, expect, it, vi } from "vitest";

import { PyLlmRequestClient, PyLlmRequestTransportError } from "./py-llm-request-client";

describe("PyLlmRequestClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("调用 Python LLM adapter 并归一响应字段", async () => {
    const fetch_mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              response_think: "思考",
              response_result: "结果",
              input_tokens: 3.8,
              output_tokens: 2,
              cancelled: true,
              timeout: false,
              degraded: true,
              error: "错误",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch_mock);

    const client = new PyLlmRequestClient({
      pyCoreBaseUrl: "http://127.0.0.1:1234/",
      pyCoreToken: "token-1",
    });
    const result = await client.request(
      {
        run_id: "run-1",
        work_unit_id: "unit-1",
        model: {},
        config_snapshot: {},
        messages: [{ role: "user", content: "原文" }],
      },
      new AbortController().signal,
    );

    expect(fetch_mock).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/internal/llm/request",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-LinguaGacha-Core-Token": "token-1",
        }),
        method: "POST",
      }),
    );
    expect(result).toEqual({
      response_think: "思考",
      response_result: "结果",
      input_tokens: 3,
      output_tokens: 2,
      cancelled: true,
      timeout: false,
      degraded: true,
      error: "错误",
    });
  });

  it("网络失败时抛出专用传输错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const client = new PyLlmRequestClient({
      pyCoreBaseUrl: "http://127.0.0.1:1234",
      pyCoreToken: "token-1",
    });

    await expect(
      client.request(
        {
          run_id: "run-1",
          work_unit_id: "unit-1",
          model: {},
          config_snapshot: {},
          messages: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(PyLlmRequestTransportError);
  });
});
