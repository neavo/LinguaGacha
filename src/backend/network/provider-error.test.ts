import { describe, expect, it } from "vitest";
import { create_provider_error, read_provider_response_error } from "./provider-error";

describe("模型接口原始错误", () => {
  it.each([
    [
      {
        error: "invalid_grant",
        error_description: "Your session has expired.",
        access_token: "must-not-leak",
      },
      "Your session has expired.",
      "invalid_grant",
    ],
    [
      { error: { code: "rate_limit_exceeded", message: "Please try again later." } },
      "Please try again later.",
      "rate_limit_exceeded",
    ],
    [
      { detail: "This workspace cannot use this model." },
      "This workspace cannot use this model.",
      undefined,
    ],
  ])("保留错误消息及内部机器码：%j", (body, message, code) => {
    const error = create_provider_error(body, 403);
    expect(error).toMatchObject({
      code: "model.provider_failed",
      message,
      public_details: { status: 403 },
    });
    expect(error.diagnostic_context).toMatchObject({ status: 403, provider_code: code });
    expect(JSON.stringify(error)).not.toContain("must-not-leak");
  });
  it("纯文本错误保留原文，没有错误消息时使用 HTTP 状态", async () => {
    expect(
      (
        await read_provider_response_error(
          new Response("Upstream temporarily unavailable", { status: 503 }),
        )
      ).message,
    ).toBe("Upstream temporarily unavailable");
    expect(create_provider_error({}, 502).message).toBe("HTTP 502");
  });
});
