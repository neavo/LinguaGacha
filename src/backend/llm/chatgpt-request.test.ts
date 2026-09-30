import { describe, expect, it } from "vitest";
import { apply_chatgpt_payload, observe_chatgpt_request } from "./chatgpt-request";

describe("ChatGPT 请求边界", () => {
  it("工具 namespace、指令角色和生成参数在最终扩展合并后符合契约", () => {
    const result = apply_chatgpt_payload(
      {
        store: false,
        stream: true,
        input: [{ role: "system", content: "guide" }],
        max_output_tokens: 100,
        temperature: 1,
        tools: [{ type: "function", name: "translate", parameters: {} }],
      },
      { reasoning: { effort: "high" } },
    );
    expect(result).toEqual({
      store: false,
      stream: true,
      input: [{ role: "developer", content: "guide" }],
      tools: [
        {
          type: "namespace",
          name: "linguagacha",
          tools: [{ type: "function", name: "translate", parameters: {} }],
        },
      ],
      reasoning: { effort: "high" },
    });
    expect(() => apply_chatgpt_payload(result, { temperature: 0 })).toThrowError(
      expect.objectContaining({ code: "model.provider_failed" }),
    );
    expect(() => apply_chatgpt_payload(result, { store: true })).toThrow();
  });
  it("HTTP 200 后的 SSE 额度错误仍不可重试，临时可用性错误保留重试资格", async () => {
    const observation = observe_chatgpt_request();
    await observation.options.onProviderStreamEvent?.(
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
      },
      {} as never,
    );
    expect(observation.failure()).toMatchObject({ retryable: false });
    await observation.options.onProviderStreamEvent?.(
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_unavailable" } },
      },
      {} as never,
    );
    expect(observation.failure()).toMatchObject({ retryable: true });
  });
});
