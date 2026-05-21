import type { DesktopSystemProxyStartupNotice } from "./bridge-types";

const SYSTEM_PROXY_STARTUP_NOTICE_ARG_PREFIX = "--system-proxy-startup-notice="; // main 与 preload 之间的唯一启动代理提示参数

export const EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE: DesktopSystemProxyStartupNotice =
  Object.freeze({
    detected: false,
    proxiedOriginCount: 0,
    proxyDisplay: null,
  });

/**
 * 把启动代理提示摘要注入 preload 参数；这里故意只序列化脱敏摘要，不传代理 URI。
 */
export function build_desktop_system_proxy_startup_notice_argument(
  notice: DesktopSystemProxyStartupNotice,
): string {
  return `${SYSTEM_PROXY_STARTUP_NOTICE_ARG_PREFIX}${encodeURIComponent(
    JSON.stringify(normalize_desktop_system_proxy_startup_notice(notice)),
  )}`;
}

/**
 * 从 preload argv 读取启动代理提示；缺失参数表示未检测到需要展示的系统代理。
 */
export function resolve_desktop_system_proxy_startup_notice_from_argv(
  argv: readonly string[],
): DesktopSystemProxyStartupNotice {
  const matched_argument = argv.find((argument) =>
    argument.startsWith(SYSTEM_PROXY_STARTUP_NOTICE_ARG_PREFIX),
  );
  if (matched_argument === undefined) {
    return EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE;
  }

  try {
    return normalize_desktop_system_proxy_startup_notice(
      JSON.parse(
        decodeURIComponent(matched_argument.slice(SYSTEM_PROXY_STARTUP_NOTICE_ARG_PREFIX.length)),
      ) as unknown,
    );
  } catch {
    return EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE;
  }
}

/**
 * 桥接边界只接受稳定布尔值和非负整数，避免 renderer 消费半结构化启动参数。
 */
export function normalize_desktop_system_proxy_startup_notice(
  value: unknown,
): DesktopSystemProxyStartupNotice {
  if (!is_record(value)) {
    return EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE;
  }

  const detected = value["detected"] === true;
  const proxied_origin_count = read_non_negative_integer(value["proxiedOriginCount"]);
  const proxy_display = read_non_empty_string(value["proxyDisplay"]);
  if (!detected || proxied_origin_count === 0 || proxy_display === null) {
    return EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE;
  }

  return {
    detected: true,
    proxiedOriginCount: proxied_origin_count,
    proxyDisplay: proxy_display,
  };
}

/**
 * 判断启动参数载荷是否为普通对象，避免把数组或 null 当成摘要。
 */
function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 只接受安全整数，代理命中数来自 main 进程摘要，不允许 renderer 侧再推断。
 */
function read_non_negative_integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * 代理展示值只接受已由 main 生成的非空字符串，preload 不重新解析系统代理。
 */
function read_non_empty_string(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed_value = value.trim();
  return trimmed_value === "" ? null : trimmed_value;
}
