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
});
