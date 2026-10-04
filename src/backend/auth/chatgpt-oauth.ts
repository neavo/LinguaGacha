import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { AppError } from "../../shared/error";
import { is_json_record } from "../../domain/json";
import { CHATGPT_BASE_URL } from "../../domain/model";
import { create_provider_error, read_provider_response_error } from "../network/provider-error";

const CHATGPT_API_URL = CHATGPT_BASE_URL;
const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const METADATA_URL = `${ISSUER}/.well-known/openid-configuration`;
const CALLBACK_PATH = "/auth/callback";
const DIRECT_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;
const TOKEN_TIMEOUT_MS = 15_000;
const AUTH_RANDOM_BYTES = 32; // 256 位随机性，同时满足 PKCE verifier 的长度要求。
const TERMINAL_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

/** 凭据携带已验证身份，刷新沿用 `session_id` 以绑定在途任务。 */
export interface ChatGPTCredential extends OAuthCredential {
  clientId: string;
  subject: string;
  email: string;
  scopes: string[];
  session_id: string; // 登录替换身份，刷新保持不变，任务据此拒绝其它连接。
}

/** token 接口保留原始错误消息，刷新失效和重试资格作为内部事实。 */
async function request_token(
  body: URLSearchParams,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    const error = await read_provider_response_error(response, {
      retryable: response.status >= 500 || response.status === 429,
    });
    error.diagnostic_context["auth_invalid"] =
      body.get("grant_type") === "refresh_token" &&
      TERMINAL_REFRESH_ERRORS.has(String(error.diagnostic_context["provider_code"]));
    throw error;
  }
  const data: unknown = await response.json();
  if (!is_json_record(data)) throw auth_error("Invalid ChatGPT token response.");
  return data;
}

/** 只接收可续期且获得套餐权限的 token，保留真实到期时间。 */
function token_fields(
  data: Record<string, unknown>,
): Pick<ChatGPTCredential, "access" | "refresh" | "expires" | "scopes"> {
  if (
    typeof data["access_token"] !== "string" ||
    data["access_token"] === "" ||
    typeof data["refresh_token"] !== "string" ||
    data["refresh_token"] === "" ||
    typeof data["expires_in"] !== "number" ||
    !Number.isFinite(data["expires_in"]) ||
    data["expires_in"] <= 0 ||
    typeof data["scope"] !== "string"
  )
    throw auth_error("Invalid ChatGPT token response.");
  const scopes = data["scope"].split(/\s+/u);
  if (!scopes.includes(DIRECT_SCOPE))
    throw create_provider_error("ChatGPT plan usage was not authorized.", undefined, {
      auth_invalid: true,
      retryable: false,
    });
  return {
    access: data["access_token"],
    refresh: data["refresh_token"],
    expires: Date.now() + data["expires_in"] * 1_000,
    scopes,
  };
}

/** 本地协议校验失败不可通过重试同一请求恢复。 */
function auth_error(reason: string): AppError {
  return create_provider_error(reason, undefined, { retryable: false });
}

/** OIDC 元数据只接受同一官方认证源，发现的端点不能改变凭据发送边界。 */
async function read_metadata(
  signal: AbortSignal,
): Promise<{ jwks_uri: URL; revocation_endpoint: URL }> {
  const response = await fetch(METADATA_URL, { signal });
  if (!response.ok) throw await read_provider_response_error(response);
  const data: unknown = await response.json();
  if (!is_json_record(data) || data["issuer"] !== ISSUER)
    throw auth_error("ChatGPT identity issuer did not match.");
  const endpoint = (key: string): URL => {
    const url = new URL(String(data[key] ?? ""));
    if (url.origin !== ISSUER) throw auth_error("Invalid ChatGPT authentication endpoint.");
    return url;
  };
  return { jwks_uri: endpoint("jwks_uri"), revocation_endpoint: endpoint("revocation_endpoint") };
}

/** 登录只确认身份和套餐授权；目录获取与推理始终由用户另行触发。 */
export async function start_chatgpt_login(options: {
  host_id: string;
  signal: AbortSignal;
}): Promise<{ url: string; completion: Promise<ChatGPTCredential> }> {
  const { signal } = options;
  signal.throwIfAborted();
  // state 校验回调归属，nonce 校验身份 token，verifier 留在后端参与 code 交换。
  const state = randomBytes(AUTH_RANDOM_BYTES).toString("base64url");
  const nonce = randomBytes(AUTH_RANDOM_BYTES).toString("base64url");
  const verifier = randomBytes(AUTH_RANDOM_BYTES).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = Promise.withResolvers<{ code: string; client_id: string }>();
  // 监听启动失败前也可能发生取消，提前接住拒绝并由 completion 统一交付。
  void callback.promise.catch(() => undefined);
  let accepted = false; // 同一授权尝试只接受一次有效回调。
  const server = createServer((request, response) => {
    const url = URL.parse(request.url ?? "/", "http://127.0.0.1");
    if (
      accepted ||
      url === null ||
      url.pathname !== CALLBACK_PATH ||
      url.searchParams.get("state") !== state
    ) {
      response.writeHead(400).end("Invalid authorization callback.");
      return;
    }
    accepted = true;
    const error = url.searchParams.get("error");
    if (error === "access_denied") {
      response.writeHead(200).end("Sign-in cancelled. You can close this window.");
      callback.reject(new AppError("runtime.cancelled"));
      return;
    }
    const code = url.searchParams.get("code");
    const client_id = url.searchParams.get("client_id");
    if (error || !code || !client_id || client_id === "dynamic_agent_client") {
      response.writeHead(400).end("Authorization failed. Return to LinguaGacha.");
      callback.reject(
        auth_error(
          url.searchParams.get("error_description") ?? error ?? "Invalid authorization callback.",
        ),
      );
      return;
    }
    response
      .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("Return to LinguaGacha to view the sign-in result.");
    callback.resolve({ code, client_id });
  });
  // 取消只结束等待，监听器由完成链的 finally 统一释放。
  const cancel = (): void => {
    callback.reject(new AppError("runtime.cancelled"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    signal.throwIfAborted();
  } catch (error) {
    signal.removeEventListener("abort", cancel);
    server.close();
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string")
    throw auth_error("Unable to start the sign-in callback.");
  const redirect_uri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    // 显式登录总是重新选择账号；已签发 client ID 只用于当前凭据的刷新与撤销。
    client_id: "dynamic_agent_client",
    agent_name_hint: "LinguaGacha",
    ext_agent_host_id: options.host_id,
    response_type: "code",
    redirect_uri,
    resource: CHATGPT_API_URL,
    scope: SCOPES,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
  }).toString();
  const completion = (async (): Promise<ChatGPTCredential> => {
    try {
      const { code, client_id } = await callback.promise;
      const data = await request_token(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id,
          code,
          code_verifier: verifier,
          redirect_uri,
          resource: CHATGPT_API_URL,
        }),
        signal,
      );
      if (typeof data["id_token"] !== "string")
        throw auth_error("ChatGPT did not return an ID token.");
      const metadata = await read_metadata(signal);
      const keys = createRemoteJWKSet(metadata.jwks_uri, {
        [customFetch]: (input, init) => fetch(input, { ...init, signal }),
      });
      const { payload } = await jwtVerify(data["id_token"], keys, {
        issuer: ISSUER,
        audience: client_id,
        requiredClaims: ["exp", "sub", "nonce"],
        algorithms: ["RS256"],
      });
      if (payload["nonce"] !== nonce || !payload.sub)
        throw auth_error("ChatGPT identity verification failed.");
      return {
        type: "oauth",
        ...token_fields(data),
        clientId: client_id,
        subject: payload.sub,
        email: typeof payload["email"] === "string" ? payload["email"] : payload.sub,
        session_id: randomUUID(),
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      server.close();
      server.closeAllConnections();
    }
  })();
  return { url: url.toString(), completion };
}

/** 刷新保持会话身份，调用方负责串行化及按当前会话提交结果。 */
export async function refresh_chatgpt_credential(
  credential: ChatGPTCredential,
  signal: AbortSignal,
): Promise<ChatGPTCredential> {
  const data = await request_token(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credential.clientId,
      refresh_token: credential.refresh,
      resource: CHATGPT_API_URL,
    }),
    signal,
  );
  return { ...credential, ...token_fields(data) };
}

/** 向官方发现的端点撤销可续期会话，本地清理由账户服务持有。 */
export async function revoke_chatgpt_session(
  credential: ChatGPTCredential,
  signal: AbortSignal,
): Promise<void> {
  const metadata = await read_metadata(signal);
  const response = await fetch(metadata.revocation_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal,
    body: new URLSearchParams({
      token: credential.refresh,
      token_type_hint: "refresh_token",
      client_id: credential.clientId,
    }),
  });
  if (response.status !== 200) throw await read_provider_response_error(response);
}
