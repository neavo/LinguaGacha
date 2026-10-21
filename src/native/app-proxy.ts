import { session } from "electron";

const PROXY_DEFAULT_PORTS = { "http:": "80", "https:": "443", "socks5:": "1080" } as const; // 显式补齐端口，统一 Chromium 与 Undici 的地址。
const LOOPBACK_BYPASS_RULES = "localhost;127.0.0.0/8;[::1]"; // 与后端的回环直连范围保持一致。

/** 默认 Session 拥有代理事实，GUI 与 CLI 必须在启动后端前等待配置完成。 */
export async function configure_app_proxy(): Promise<void> {
  const value = process.env.LG_PROXY?.trim();
  if (!value) return;

  // URL 会自动修正路径和分隔符，先检查原始形状以免接受被修正的无效配置。
  const parts = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/iu.exec(value);
  if (parts === null || /[\s\\]/u.test(value)) {
    throw new Error("LG_PROXY must be a proxy URL with a host.");
  }
  let url: URL;
  let hostname: string;
  try {
    url = new URL(value);
    // SOCKS5 URL 保留主机转义，统一用 HTTP 主机规则解码并规范化。
    hostname = new URL(`http://${url.hostname}`).hostname;
  } catch {
    // 原始输入可能包含凭据，解析异常不得带入启动错误。
    throw new Error("LG_PROXY contains an invalid host or port.");
  }
  if (!Object.hasOwn(PROXY_DEFAULT_PORTS, url.protocol)) {
    throw new Error("LG_PROXY supports only http://, https:// and socks5://.");
  }
  // Chromium 将这些字符当作规则分隔符，不能把单个主机解释成代理列表。
  if (/[,;=]/u.test(hostname)) throw new Error("LG_PROXY contains an invalid host.");
  if (parts[2]?.includes("@")) {
    throw new Error("LG_PROXY does not support a username or password.");
  }
  if (parts[3] !== "" && parts[3] !== "/") {
    throw new Error("LG_PROXY path must be empty or /.");
  }
  if (parts[4] !== undefined || parts[5] !== undefined) {
    throw new Error("LG_PROXY does not support a query or fragment.");
  }
  const port = url.port || PROXY_DEFAULT_PORTS[url.protocol as keyof typeof PROXY_DEFAULT_PORTS];
  await session.defaultSession.setProxy({
    mode: "fixed_servers",
    proxyRules: `${url.protocol}//${hostname}:${port}`,
    proxyBypassRules: LOOPBACK_BYPASS_RULES,
  });
}
