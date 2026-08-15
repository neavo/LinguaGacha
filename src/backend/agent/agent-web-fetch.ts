import dns, { type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP, type TcpNetConnectOpts } from "node:net";

import { Agent, fetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";

import {
  parse_system_proxy_route,
  type SystemProxyResolver,
  type SystemProxyRoute,
} from "../network/system-proxy-http-client";
import { AgentToolError } from "./agent-tool";

// 固定网络资源预算，避免单次工具调用无限占用连接、内存或模型上下文。
const WEB_FETCH_TIMEOUT_MS = 20_000;
const WEB_FETCH_MAX_REDIRECTS = 5;
const WEB_FETCH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// 手动管理重定向，并只声明 Backend 确实能归一化的文本格式。
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPT =
  "text/html, application/xhtml+xml, text/markdown, text/plain, application/json, application/xml;q=0.9, text/xml;q=0.9";
// literal 与真实 DNS 结果复用同一组非公网网段，避免两条判定路径漂移。
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

export type AgentWebFetchResponse = Readonly<{
  url: string; // 逐跳校验后的最终 URL
  contentType: string; // 服务端原始 Content-Type，缺失时为空串
  body: Uint8Array; // 同时受传输层和解压后字节上限约束
}>;

/** Agent 工具调用 Backend 下载边界的唯一端口。 */
export type AgentWebFetchPort = (
  url: string,
  signal: AbortSignal,
) => Promise<AgentWebFetchResponse>;

type SocketLookup = NonNullable<TcpNetConnectOpts["lookup"]>;

// Undici 限制压缩传输体，解压后的正文由 read_response_body 再限制一次。
const DISPATCHER_OPTIONS = {
  maxResponseSize: WEB_FETCH_MAX_RESPONSE_BYTES,
} as const;

/** Agent 网页下载唯一入口；直连在真实 socket lookup 中过滤私网，代理路径信任用户代理。 */
export function create_agent_web_fetch(
  system_proxy_resolver: SystemProxyResolver,
): AgentWebFetchPort {
  return async (requested_url, caller_signal) => {
    const signal = AbortSignal.any([caller_signal, AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS)]);
    let current_url = assert_public_web_url(requested_url);
    let redirect_count = 0;

    while (true) {
      signal.throwIfAborted();
      let route: SystemProxyRoute;
      try {
        route = parse_system_proxy_route(
          await system_proxy_resolver.resolveProxy(current_url.href, signal),
        );
      } catch (error) {
        throw new AgentToolError(
          { code: "web_fetch.network_failed", url: current_url.href },
          error,
        );
      }
      signal.throwIfAborted();
      const dispatcher = create_dispatcher(route, current_url);
      try {
        const response = await fetch(current_url, {
          dispatcher,
          headers: { accept: ACCEPT },
          method: "GET",
          redirect: "manual",
          signal,
        });
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (location === null) {
            throw new AgentToolError({
              code: "web_fetch.invalid_redirect",
              status: response.status,
              url: current_url.href,
            });
          }
          if (redirect_count >= WEB_FETCH_MAX_REDIRECTS) {
            throw new AgentToolError({
              code: "web_fetch.too_many_redirects",
              url: current_url.href,
            });
          }
          current_url = assert_public_web_url(new URL(location, current_url).href);
          redirect_count += 1;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new AgentToolError({
            code: "web_fetch.http_error",
            status: response.status,
            url: current_url.href,
          });
        }
        return {
          url: current_url.href,
          contentType: response.headers.get("content-type") ?? "",
          body: await read_response_body(response, signal, current_url.href),
        };
      } finally {
        await dispatcher.destroy();
      }
    }
  };
}

/** Undici 的实际 socket 解析只返回公网地址，消除预解析与连接之间的 DNS 窗口。 */
function create_public_lookup(url: string): SocketLookup {
  return (hostname, options, callback) => {
    void resolve_all_addresses(hostname, options).then(
      (addresses) => {
        const public_addresses = addresses.filter(({ address, family }) =>
          is_public_address(address, family),
        );
        if (public_addresses.length === 0) {
          callback(new AgentToolError({ code: "web_fetch.restricted_url", url }), "");
          return;
        }
        if (options.all) callback(null, public_addresses);
        else {
          const first = public_addresses[0]!;
          callback(null, first.address, first.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

/** 每一跳创建短生命周期 dispatcher；代理负责目标解析，直连使用受控 lookup。 */
function create_dispatcher(route: SystemProxyRoute, url: URL): Dispatcher {
  if (route.kind === "proxy") return new ProxyAgent({ uri: route.uri, ...DISPATCHER_OPTIONS });
  if (route.kind === "socks5") return new Socks5ProxyAgent(route.uri, DISPATCHER_OPTIONS);
  return new Agent({
    ...DISPATCHER_OPTIONS,
    connect: { lookup: create_public_lookup(url.href) },
  });
}

/** 在代理解析和网络访问前拒绝非 HTTP(S)、URL 凭据与显式本地目标。 */
function assert_public_web_url(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AgentToolError({ code: "web_fetch.invalid_url" }, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentToolError({ code: "web_fetch.invalid_url" });
  }
  if (url.username !== "" || url.password !== "") {
    throw new AgentToolError({ code: "web_fetch.invalid_url" });
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    throw new AgentToolError({ code: "web_fetch.restricted_url", url: url.href });
  }
  const version = isIP(hostname);
  if ((version === 4 || version === 6) && !is_public_address(hostname, version)) {
    throw new AgentToolError({ code: "web_fetch.restricted_url", url: url.href });
  }
  return url;
}

/** 统一判断 literal 与 DNS endpoint 是否属于允许连接的公网地址。 */
function is_public_address(address: string, family: number): boolean {
  if (family === 4) return !BLOCKED_IPV4_ADDRESSES.check(address, "ipv4");
  if (family === 6) return !BLOCKED_IPV6_ADDRESSES.check(address, "ipv6");
  return false;
}

/** 强制取得当前候选地址全集，随后由 socket lookup 过滤并选择。 */
function resolve_all_addresses(hostname: string, options: LookupOptions): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(
      hostname,
      { family: options.family, hints: options.hints, all: true, verbatim: true },
      (error, addresses) => {
        if (error !== null) reject(error);
        else resolve(addresses);
      },
    );
  });
}

/** 流式拼接 Fetch 已解压的正文，越界时立即取消 reader。 */
async function read_response_body(
  response: Awaited<ReturnType<typeof fetch>>,
  signal: AbortSignal,
  url: string,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    signal.throwIfAborted();
    const { done, value } = await reader.read();
    signal.throwIfAborted();
    if (done) break;
    size += value.byteLength;
    if (size > WEB_FETCH_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AgentToolError({ code: "web_fetch.response_too_large", url });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
