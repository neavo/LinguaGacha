import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SystemProxyHttpClient } from "./system-proxy-http-client";
import { LLMClient } from "../llm/llm-client";
import { read_builtin_pi_models } from "../llm/pi-model-catalog";
import type { LLMRequestBody } from "../llm/llm-types";

import { afterEach, describe, expect, it, vi } from "vitest";
import { record_http_response_info, with_http_response_info } from "./http-response-info";

describe("HTTP 响应事实", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["90", 90_000],
    ["Sat, 19 Sep 2026 00:02:00 GMT", 120_000],
    [null, undefined],
    ["invalid", undefined],
    ["-1", undefined],
    ["0", undefined],
    ["1.5", undefined],
    ["Sat, 19 Sep 2026 00:00:00 GMT", undefined],
  ])("解析 Retry-After %s", async (header, expected) => {
    vi.useFakeTimers();
    const now = Date.parse("2026-09-19T00:00:00Z");
    vi.setSystemTime(now);
    const result = await with_http_response_info(async () => {
      record_http_response_info(
        new Response(null, {
          status: 429,
          headers: header === null ? {} : { "Retry-After": header },
        }),
      );
      return { request_error: "limited" };
    });
    expect(result).toEqual({
      http_status: 429,
      http_received_at: now,
      retry_after_ms: expected,
      request_error: "limited",
    });
  });

  it("并发请求隔离，后续响应清除上一响应的重试时间", async () => {
    const results = await Promise.all(
      [429, 200].map((status) =>
        with_http_response_info(async () => {
          record_http_response_info(
            new Response(null, { status: 429, headers: { "Retry-After": "90" } }),
          );
          await Promise.resolve();
          record_http_response_info(new Response(null, { status }));
          return {};
        }),
      ),
    );
    expect(
      results.map(({ http_status, retry_after_ms }) => ({ http_status, retry_after_ms })),
    ).toEqual([
      { http_status: 429, retry_after_ms: undefined },
      { http_status: 200, retry_after_ms: undefined },
    ]);
  });
  // 沿真实 Client → Pi → transport 验证状态采集，覆盖 SDK 压平错误后的并发隔离。
  it.each(["OpenAI", "OpenAIResponses", "Anthropic", "Google"])(
    "%s 真实 SDK 的并行错误保留各自 HTTP 状态，断连请求没有状态",
    async (api_format) => {
      const server = createServer((request, response) => {
        request.resume();
        if (request.url?.startsWith("/disconnect")) {
          request.socket.destroy();
          return;
        }
        const status = request.url?.startsWith("/limited") ? 429 : 401;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: { message: "测试请求失败", code: status, type: "api_error" } }),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const transport = new SystemProxyHttpClient({ resolveProxy: async () => "DIRECT" });
      transport.install_as_global_fetch();
      try {
        const client = new LLMClient({
          userAgent: "LinguaGacha/test",
          catalog: { read_models: read_builtin_pi_models },
        });
        // 使用不同 URL 区分并行响应，避免状态码只在测试替身中流转。
        const make_body = (path: string): LLMRequestBody => ({
          run_id: "test",
          work_unit_id: path,
          model: {
            api_format,
            api_url: `${root}/${path}/v1`,
            api_key: "test-key",
            model_id: "test-model",
            thinking: { level: "OFF" },
          },
          config_snapshot: { request_timeout: 5 },
          messages: [{ role: "user", content: "测试" }],
        });
        const [limited, unauthorized, disconnected] = await Promise.all(
          ["limited", "unauthorized", "disconnect"].map((path) =>
            client.request(make_body(path), new AbortController().signal),
          ),
        );
        expect(limited).toMatchObject({
          http_status: 429,
          timeout: false,
          request_error: expect.any(Object),
        });
        expect(unauthorized).toMatchObject({
          http_status: 401,
          timeout: false,
          request_error: expect.any(Object),
        });
        expect(disconnected).not.toHaveProperty("http_status");
        expect(disconnected?.request_error).toBeDefined();
      } finally {
        await transport.dispose();
        server.close();
        await once(server, "close");
      }
    },
  );
});
