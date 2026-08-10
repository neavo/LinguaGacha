import { BlockList, isIP } from "node:net";

import type {
  BackendRuntimeWebFetchRequest,
  BackendRuntimeWebFetchResponse,
} from "../../shared/backend-runtime";
import type { Session } from "electron";

export const WEB_FETCH_TIMEOUT_MS = 20_000;
export const WEB_FETCH_MAX_REDIRECTS = 5;
export const WEB_FETCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPT =
  "text/html, application/xhtml+xml, text/markdown, text/plain, application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";
const BLOCKED_IPV4_ADDRESSES = new BlockList();
const BLOCKED_IPV6_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

export type DesktopWebFetchRuntime = Pick<Session, "fetch" | "resolveHost">;

/** 通过 Electron 默认 Session 抓取经过 SSRF 边界约束的静态资源。 */
export async function desktop_web_fetch(
  runtime: DesktopWebFetchRuntime,
  request: BackendRuntimeWebFetchRequest,
  caller_signal: AbortSignal,
): Promise<BackendRuntimeWebFetchResponse> {
  const signal = AbortSignal.any([caller_signal, AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS)]);
  let current_url = new URL(request.url);
  let redirect_count = 0;

  while (true) {
    signal.throwIfAborted();
    current_url = await assert_public_web_url(runtime, current_url, signal);
    signal.throwIfAborted();
    const response = await runtime.fetch(current_url.href, {
      method: "GET",
      signal,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      bypassCustomProtocolHandlers: true,
      headers: { Accept: ACCEPT },
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (location === null)
        throw new Error(`Web redirect is missing Location: ${response.status}.`);
      if (redirect_count >= WEB_FETCH_MAX_REDIRECTS) {
        throw new Error(`Web request exceeded ${WEB_FETCH_MAX_REDIRECTS.toString()} redirects.`);
      }
      current_url = new URL(location, current_url);
      redirect_count += 1;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Web request failed: HTTP ${response.status.toString()}.`);
    }

    return {
      requestedUrl: request.url,
      url: current_url.href,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await read_response_body(response, signal),
    };
  }
}

/** 每一跳都拒绝本机身份、凭据和解析到受限网段的 hostname。 */
async function assert_public_web_url(
  runtime: DesktopWebFetchRuntime,
  value: URL,
  signal: AbortSignal,
): Promise<URL> {
  if (value.protocol !== "http:" && value.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be fetched.");
  }
  if (value.username !== "" || value.password !== "") {
    throw new Error("Web URL must not contain a username or password.");
  }
  const hostname = value.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (hostname === "") throw new Error("Web URL is missing a hostname.");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error(`Local hostname is not allowed: ${hostname}.`);
  }

  const ip_version = isIP(hostname);
  if (ip_version === 4 || ip_version === 6) {
    assert_public_address(hostname, ip_version);
    return value;
  }

  let endpoints: Awaited<ReturnType<DesktopWebFetchRuntime["resolveHost"]>>["endpoints"];
  try {
    ({ endpoints } = await wait_with_abort(
      runtime.resolveHost(hostname, { cacheUsage: "disallowed" }),
      signal,
    ));
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(`Failed to resolve web hostname: ${hostname}.`, { cause: error });
  }
  if (endpoints.length === 0) throw new Error(`Web hostname has no usable address: ${hostname}.`);
  for (const endpoint of endpoints) {
    const endpoint_version = isIP(endpoint.address);
    if (endpoint_version !== 4 && endpoint_version !== 6) {
      throw new Error(`Web hostname returned an invalid address: ${endpoint.address}.`);
    }
    assert_public_address(endpoint.address, endpoint_version);
  }
  return value;
}

/** Electron 的 DNS Promise 不接收 signal，因此在此补齐可等待的取消语义。 */
function wait_with_abort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => settle(() => reject(signal.reason));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/** literal 与 DNS endpoint 统一经过同一受限网段判定。 */
function assert_public_address(address: string, version: 4 | 6): void {
  const blocked =
    version === 4
      ? BLOCKED_IPV4_ADDRESSES.check(address, "ipv4")
      : BLOCKED_IPV6_ADDRESSES.check(address, "ipv6");
  if (blocked) {
    throw new Error(`Restricted address is not allowed: ${address}.`);
  }
}

/** 流式读取并在声明长度或实际字节数越界时立刻取消网络正文。 */
async function read_response_body(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const content_length = response.headers.get("content-length")?.trim();
  if (
    content_length !== undefined &&
    /^\d+$/u.test(content_length) &&
    BigInt(content_length) > BigInt(WEB_FETCH_MAX_RESPONSE_BYTES)
  ) {
    const error = new Error("Web response exceeds the 2 MiB limit.");
    await response.body?.cancel(error).catch(() => undefined);
    throw error;
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort_reader = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", abort_reader, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > WEB_FETCH_MAX_RESPONSE_BYTES) {
        const error = new Error("Web response exceeds the 2 MiB limit.");
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort_reader);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
