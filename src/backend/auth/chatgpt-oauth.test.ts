import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start_chatgpt_login, chatgpt_oauth } from "./chatgpt-oauth";

const real_fetch = globalThis.fetch;
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatGPT 浏览器授权协议", () => {
  it("浏览器取消授权只结束流程，错误 state 无法取消其它登录", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const controller = new AbortController();
    const login = await start_chatgpt_login({
      host_id: "urn:uuid:fixture-host",
      registration: null,
      signal: controller.signal,
    });
    const url = new URL(login.url);
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    const cancelled = expect(login.completion).rejects.toMatchObject({ code: "runtime.cancelled" });
    try {
      callback.search = new URLSearchParams({
        state: "wrong-state",
        error: "access_denied",
      }).toString();
      expect((await real_fetch(callback)).status).toBe(400);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      expect((await real_fetch(callback)).status).toBe(200);
      await cancelled;
      expect(network).not.toHaveBeenCalled();
    } finally {
      controller.abort();
    }
  });

  it.each([
    [400, "invalid_grant", false, true],
    [400, "invalid_client", false, false],
    [503, "temporarily_unavailable", true, false],
  ] as const)(
    "刷新错误 %s/%s 保留原文并维持恢复判断",
    async (status, code, retryable, auth_invalid) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: code, error_description: "Original provider message" },
            { status },
          ),
        ),
      );
      await expect(
        chatgpt_oauth.refresh(
          { type: "oauth", access: "old", refresh: "refresh", expires: 0, clientId: "client" },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: "model.provider_failed",
        message: "Original provider message",
        public_details: { message: "Original provider message" },
        diagnostic_context: { provider_code: code, status, retryable, auth_invalid },
      });
    },
  );
  it.each(["success", "wrong_nonce", "missing_scope", "invalid_signature"] as const)(
    "验证身份及套餐权限：%s",
    async (scenario) => {
      const keys = await generateKeyPair("RS256");
      const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key" };
      const controller = new AbortController();
      const login = await start_chatgpt_login({
        host_id: "urn:uuid:fixture-host",
        registration: null,
        signal: controller.signal,
      });
      const url = new URL(login.url);
      const nonce = url.searchParams.get("nonce");
      const signing_key =
        scenario === "invalid_signature"
          ? (await generateKeyPair("RS256")).privateKey
          : keys.privateKey;
      const id_token = await new SignJWT({
        nonce: scenario === "wrong_nonce" ? "other" : nonce,
        email: "account@example.test",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer("https://auth.openai.com")
        .setAudience("issued-client")
        .setSubject("verified-account")
        .setExpirationTime("1h")
        .sign(signing_key);
      const requests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const endpoint = String(input);
          requests.push(endpoint);
          if (endpoint.endsWith("/oauth/token")) {
            const body = new URLSearchParams(String(init?.body));
            expect(body.get("client_id")).toBe("issued-client");
            expect(body.get("redirect_uri")).toBe(url.searchParams.get("redirect_uri"));
            expect(body.get("code_verifier")).toBeTruthy();
            return Response.json({
              access_token: "access",
              refresh_token: "refresh",
              id_token,
              expires_in: 3600,
              scope: scenario === "missing_scope" ? "openid" : "openid chatgpt.tokens.use.direct",
            });
          }
          if (endpoint.endsWith("openid-configuration"))
            return Response.json({
              issuer: "https://auth.openai.com",
              jwks_uri: "https://auth.openai.com/jwks",
              revocation_endpoint: "https://auth.openai.com/revoke",
            });
          if (endpoint.endsWith("/jwks")) return Response.json({ keys: [jwk] });
          throw new Error(`Unexpected request: ${endpoint}`);
        }),
      );
      // 协议结果可能早于 HTTP 回包到达，先接住拒绝再统一断言。
      const result = login.completion.catch((error: unknown) => error);
      try {
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.search = new URLSearchParams({
          state: url.searchParams.get("state")!,
          code: "code",
          client_id: "issued-client",
        }).toString();
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        await real_fetch(callback);
        if (scenario === "success")
          expect(await result).toMatchObject({
            subject: "verified-account",
            clientId: "issued-client",
            access: "access",
          });
        else expect(await result).toBeInstanceOf(Error);
        expect(requests.some((request) => request.includes("api.openai.com"))).toBe(false);
      } finally {
        controller.abort();
      }
    },
  );

  it("取消关闭真实回调监听，重复授权使用已签发 client ID", async () => {
    const controller = new AbortController();
    const login = await start_chatgpt_login({
      host_id: "urn:uuid:host",
      registration: { client_id: "saved-client", subject: "subject", email: "mail@example.test" },
      signal: controller.signal,
    });
    const url = new URL(login.url);
    expect(url.searchParams.get("client_id")).toBe("saved-client");
    expect(url.searchParams.has("agent_name_hint")).toBe(false);
    const rejected = expect(login.completion).rejects.toMatchObject({ code: "runtime.cancelled" });
    controller.abort();
    await rejected;
    await expect(real_fetch(url.searchParams.get("redirect_uri")!)).rejects.toBeDefined();
  });
});
