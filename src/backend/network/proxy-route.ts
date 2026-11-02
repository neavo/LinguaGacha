export interface ProxyResolver {
  // Electron Session 提供唯一规则来源。`signal` 解除宿主通道等待，原生查询可能继续执行。
  resolveProxy: (url: string, signal?: AbortSignal) => Promise<string>;
}

export type ProxyRoute =
  | { kind: "direct" }
  | { kind: "proxy"; uri: string }
  | { kind: "socks5"; uri: string };

/** 按 Chromium 返回顺序选择首个可执行路由，只有显式 DIRECT 才允许直连。 */
export function parse_proxy_route(proxy_rules: string): ProxyRoute {
  for (const rule of proxy_rules.split(";")) {
    const trimmed_rule = rule.trim();
    if (trimmed_rule === "") continue;
    const [raw_type = "", ...target_parts] = trimmed_rule.split(/\s+/u);
    const type = raw_type.toUpperCase();
    if (type === "DIRECT") return { kind: "direct" };
    const target = target_parts.join(" ");
    if (type === "PROXY") {
      const uri = build_proxy_uri("http", target);
      if (uri !== null) return { kind: "proxy", uri };
    }
    if (type === "HTTPS") {
      const uri = build_proxy_uri("https", target);
      if (uri !== null) return { kind: "proxy", uri };
    }
    if (type === "SOCKS" || type === "SOCKS5") {
      const uri = build_proxy_uri("socks5", target);
      if (uri !== null) return { kind: "socks5", uri };
    }
  }
  throw new Error("Proxy returned no supported route.");
}

/** 本机端点保持直连，其余 URL 每次向 Electron Session 查询当前路由。 */
export async function resolve_proxy_route(
  resolver: ProxyResolver,
  url: string,
  signal?: AbortSignal,
): Promise<ProxyRoute> {
  const target = new URL(url);
  if (is_loopback_hostname(target.hostname)) return { kind: "direct" };
  return parse_proxy_route(await resolver.resolveProxy(target.href, signal));
}

/** Chromium 代理目标通常省略 scheme，无效目标由后续候选接续。 */
function build_proxy_uri(protocol: "http" | "https" | "socks5", target: string): string | null {
  const trimmed_target = target.trim();
  if (trimmed_target === "") return null;
  try {
    const url = new URL(
      trimmed_target.includes("://") ? trimmed_target : `${protocol}://${trimmed_target}`,
    );
    return url.hostname === "" ? null : url.toString();
  } catch {
    return null;
  }
}

/** 本机模型端点不经过外部代理，覆盖 localhost、IPv6 loopback 与完整 127/8。 */
function is_loopback_hostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}
