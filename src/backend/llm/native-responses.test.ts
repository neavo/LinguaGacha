import { describe, expect, it, vi } from "vitest";
import { NativeResponsesClient } from "./native-responses";
const model = {
  id: "fixture",
  name: "Fixture",
  model_id: "configured-model",
  api_format: "OpenAIResponses",
  api_url: "https://provider.test/v1",
  api_key: "secret-key",
  thinking: { level: "DEFAULT" },
  threshold: { output_token_limit: 123 },
  generation: { temperature_custom_enable: true, temperature: 0.3 },
  request: { extra_headers_custom_enable: true, extra_headers: { "X-Custom": "secret-header" } },
};
const signal = new AbortController().signal;
describe("native Responses", () => {
  it.each(["secret-key", 'secret"key\\value', "completed"])(
    "配置生效且凭据 %s 脱敏后仍保留响应结构",
    async (key) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [],
            echo: `${key} secret-header`,
            usage: {
              input_tokens: 2,
              output_tokens: 7,
              output_tokens_details: { reasoning_tokens: 3 },
            },
          }),
        ),
      );
      const client = new NativeResponsesClient("test", { read_models: () => [] }, fetcher);
      const result = await client.request(
        {
          model: { ...model, api_key: key },
          payload: { input: [] },
          config_snapshot: {},
          run_id: "run",
        },
        signal,
      );
      const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
      expect(body).toMatchObject({
        model: "configured-model",
        temperature: 0.3,
        max_output_tokens: 123,
        stream: false,
      });
      expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get("x-custom")).toBe("secret-header");
      expect(result).toMatchObject({
        input_tokens: 2,
        output_tokens: 4,
        reasoning_tokens: 3,
        item_failure: false,
        response: { echo: "[REDACTED] [REDACTED]" },
      });
    },
  );
  it.each(["incomplete", "failed"])("HTTP 200 的 %s 保留原文并结算失败", async (status) => {
    const client = new NativeResponsesClient(
      "test",
      { read_models: () => [] },
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status, output: [] }))),
    );
    expect(
      await client.request(
        { model, payload: { input: [] }, config_snapshot: {}, run_id: "run" },
        signal,
      ),
    ).toMatchObject({ item_failure: true, usage_complete: false, response: { status } });
  });
  it("输入中的受控字段拒绝派发，扩展不能开启后台执行", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new NativeResponsesClient("test", { read_models: () => [] }, fetcher);
    expect(
      await client.request(
        { model, payload: { model: "other", input: [] }, config_snapshot: {}, run_id: "run" },
        signal,
      ),
    ).toMatchObject({ item_failure: true });
    await expect(
      client.request(
        {
          model: {
            ...model,
            request: { extra_body_custom_enable: true, extra_body: { background: true } },
          },
          payload: { input: [] },
          config_snapshot: {},
          run_id: "run",
        },
        signal,
      ),
    ).rejects.toThrow("background");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
