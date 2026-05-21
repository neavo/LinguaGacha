import {
  Dispatcher,
  ProxyAgent,
  Socks5ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from "undici";

import { Model, type ModelApiFormat } from "../../base/model";
import { LLMClientPolicy } from "../llm/llm-client-policy";
import { read_model_records, type ModelRecord } from "../model/model-config-resolver";
import type { ApiJsonValue } from "../api/api-types";

export interface SystemProxyResolver {
  resolveProxy: (url: string) => Promise<string>; // resolveProxy 由 Electron session 注入，Core 不直接导入 Electron
}

export type SystemProxyRoute =
  | { kind: "direct" }
  | { kind: "proxy"; uri: string }
  | { kind: "socks5"; uri: string };

export interface SystemProxySnapshot {
  routes: Record<string, SystemProxyRoute>; // routes 以请求 origin 为键，供主线程和 worker 共享同一启动期快照
}

export interface SystemProxyStartupNotice {
  detected: boolean; // detected 只表达是否命中系统代理，入口层据此决定是否提示
  proxiedOriginCount: number; // proxiedOriginCount 是被代理的远端 origin 数，用于测试和诊断摘要
  proxyDisplay: string | null; // proxyDisplay 是去除凭据和路径后的代理 URL 展示值，供启动提示填充
}

export interface InstalledSystemProxyDispatcher {
  snapshot: SystemProxySnapshot; // snapshot 是可结构化克隆的代理事实，worker 只消费它而不重新探测系统代理
  dispose: () => Promise<void>;
}

export const EMPTY_SYSTEM_PROXY_STARTUP_NOTICE: SystemProxyStartupNotice = Object.freeze({
  detected: false,
  proxiedOriginCount: 0,
  proxyDisplay: null,
});

const PROVIDER_DEFAULT_PROXY_URLS = [
  { apiFormat: "Google", apiUrl: "https://generativelanguage.googleapis.com" },
  { apiFormat: "OpenAI", apiUrl: "https://api.openai.com/v1" },
  { apiFormat: "Anthropic", apiUrl: "https://api.anthropic.com" },
] as const satisfies ReadonlyArray<{ apiFormat: ModelApiFormat; apiUrl: string }>;

/**
 * 从当前模型配置和内置预设收集启动期需要询问系统代理的 URL。
 */
export function collect_system_proxy_urls(
  config: Record<string, ApiJsonValue>,
  preset_models: ModelRecord[],
): string[] {
  const urls_by_origin = new Map<string, string>(); // urls_by_origin 防止同一服务商 origin 被重复 resolveProxy
  for (const model of [...preset_models, ...read_model_records(config)]) {
    const api_format = Model.normalize_api_format(model["api_format"]);
    const api_url = String(model["api_url"] ?? "");
    add_proxy_url(urls_by_origin, api_format, api_url);
  }
  for (const item of PROVIDER_DEFAULT_PROXY_URLS) {
    add_proxy_url(urls_by_origin, item.apiFormat, item.apiUrl);
  }
  return [...urls_by_origin.values()];
}

/**
 * 解析 Electron 启动期系统代理，并把结果安装到当前线程的 Undici 全局 dispatcher。
 */
export async function install_system_proxy_dispatcher(options: {
  resolver: SystemProxyResolver;
  urls: string[];
}): Promise<InstalledSystemProxyDispatcher> {
  const snapshot = await resolve_system_proxy_snapshot(options.urls, options.resolver);
  return install_system_proxy_dispatcher_from_snapshot(snapshot);
}

/**
 * 在当前线程安装既有快照；worker 线程只走这个入口，不再调用 Electron resolveProxy。
 */
export function install_system_proxy_dispatcher_from_snapshot(
  snapshot: SystemProxySnapshot,
): InstalledSystemProxyDispatcher {
  const previous_dispatcher = getGlobalDispatcher(); // previous_dispatcher 用于 stop 时恢复 Node/Electron 原本的出网行为
  const dispatcher = create_system_proxy_dispatcher(snapshot, previous_dispatcher);
  if (dispatcher !== null) {
    setGlobalDispatcher(dispatcher);
  }
  return {
    snapshot: clone_system_proxy_snapshot(snapshot),
    dispose: async () => {
      if (dispatcher !== null) {
        setGlobalDispatcher(previous_dispatcher);
        await dispatcher.close();
      }
    },
  };
}

/**
 * 从代理快照生成启动提示摘要；摘要只保留脱敏展示值，避免把代理凭据或完整 URI 暴露给界面和 CLI。
 */
export function build_system_proxy_startup_notice(
  snapshot: SystemProxySnapshot | null,
): SystemProxyStartupNotice {
  if (snapshot === null) {
    return EMPTY_SYSTEM_PROXY_STARTUP_NOTICE;
  }

  const proxy_routes = Object.values(snapshot.routes).filter((route) => route.kind !== "direct");
  const proxied_origin_count = proxy_routes.length;
  if (proxied_origin_count === 0) {
    return EMPTY_SYSTEM_PROXY_STARTUP_NOTICE;
  }

  return {
    detected: true,
    proxiedOriginCount: proxied_origin_count,
    proxyDisplay: format_system_proxy_route_display(proxy_routes[0]!),
  };
}

/**
 * 解析 Chromium resolveProxy 返回的首个可支持路由。
 */
export function parse_system_proxy_route(proxy_rules: string): SystemProxyRoute {
  for (const rule of proxy_rules.split(";")) {
    const trimmed_rule = rule.trim();
    if (trimmed_rule === "") {
      continue;
    }
    const [raw_type = "", ...target_parts] = trimmed_rule.split(/\s+/u);
    const type = raw_type.toUpperCase();
    if (type === "DIRECT") {
      return { kind: "direct" };
    }
    const target = target_parts.join(" ");
    if (type === "PROXY") {
      const uri = build_proxy_uri("http", target);
      if (uri !== null) {
        return { kind: "proxy", uri };
      }
    }
    if (type === "HTTPS") {
      const uri = build_proxy_uri("https", target);
      if (uri !== null) {
        return { kind: "proxy", uri };
      }
    }
    if (type === "SOCKS" || type === "SOCKS5") {
      const uri = build_proxy_uri("socks5", target);
      if (uri !== null) {
        return { kind: "socks5", uri };
      }
    }
  }
  return { kind: "direct" };
}

/**
 * 按 URL 逐项 resolveProxy，生成可传给 worker 的不可变代理快照。
 */
async function resolve_system_proxy_snapshot(
  urls: string[],
  resolver: SystemProxyResolver,
): Promise<SystemProxySnapshot> {
  const routes: Record<string, SystemProxyRoute> = {};
  for (const url of urls) {
    const origin = read_origin(url);
    if (origin === null || routes[origin] !== undefined) {
      continue;
    }
    routes[origin] = parse_system_proxy_route(await resolver.resolveProxy(url));
  }
  return { routes };
}

/**
 * 只有存在代理路由时才替换全局 dispatcher，全部 DIRECT 时保持原始 dispatcher。
 */
function create_system_proxy_dispatcher(
  snapshot: SystemProxySnapshot,
  fallback_dispatcher: Dispatcher,
): SystemProxyDispatcher | null {
  const has_proxy_route = Object.values(snapshot.routes).some((route) => route.kind !== "direct");
  return has_proxy_route ? new SystemProxyDispatcher(snapshot, fallback_dispatcher) : null;
}

/**
 * SystemProxyDispatcher 按启动期 origin 快照选择代理 dispatcher，未命中的请求保持原始直连路径。
 */
class SystemProxyDispatcher extends Dispatcher {
  private readonly snapshot: SystemProxySnapshot;
  private readonly fallback_dispatcher: Dispatcher; // fallback_dispatcher 保留本机 API、文件下载等非模型 origin 的既有行为
  private readonly proxy_dispatchers = new Map<string, Dispatcher>(); // proxy_dispatchers 只缓存本快照创建的代理连接池

  /**
   * 保存不可变快照和原始 dispatcher，避免运行期重复解析系统代理。
   */
  public constructor(snapshot: SystemProxySnapshot, fallback_dispatcher: Dispatcher) {
    super();
    this.snapshot = clone_system_proxy_snapshot(snapshot);
    this.fallback_dispatcher = fallback_dispatcher;
  }

  /**
   * Undici 每次请求都会进入 dispatch；这里只按 origin 查表，不重新调用系统代理。
   */
  public override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    return this.resolve_dispatcher(options).dispatch(options, handler);
  }

  /**
   * 关闭代理连接池；原始 dispatcher 由安装者恢复后继续归宿原生命周期。
   */
  public override close(callback: () => void): void;
  public override close(): Promise<void>;
  public override close(callback?: () => void): Promise<void> | void {
    const close_promise = this.close_proxy_dispatchers();
    if (callback !== undefined) {
      close_promise.then(callback);
      return;
    }
    return close_promise;
  }

  /**
   * 异常销毁只影响本快照创建的代理连接池，不碰入口原有 dispatcher。
   */
  public override destroy(error: Error | null, callback: () => void): void;
  public override destroy(callback: () => void): void;
  public override destroy(error: Error | null): Promise<void>;
  public override destroy(): Promise<void>;
  public override destroy(
    error_or_callback?: Error | null | (() => void),
    callback?: () => void,
  ): Promise<void> | void {
    const error = typeof error_or_callback === "function" ? null : (error_or_callback ?? null);
    const destroy_promise = this.destroy_proxy_dispatchers(error);
    const done = typeof error_or_callback === "function" ? error_or_callback : callback;
    if (done !== undefined) {
      destroy_promise.then(done);
      return;
    }
    return destroy_promise;
  }

  /**
   * 关闭所有代理连接池，并清空本地缓存。
   */
  private async close_proxy_dispatchers(): Promise<void> {
    await Promise.all([...this.proxy_dispatchers.values()].map((dispatcher) => dispatcher.close()));
    this.proxy_dispatchers.clear();
  }

  /**
   * 销毁所有代理连接池，并清空本地缓存。
   */
  private async destroy_proxy_dispatchers(error: Error | null): Promise<void> {
    await Promise.all(
      [...this.proxy_dispatchers.values()].map((dispatcher) => dispatcher.destroy(error)),
    );
    this.proxy_dispatchers.clear();
  }

  /**
   * 根据请求 origin 选择代理、SOCKS5 或原始 dispatcher。
   */
  private resolve_dispatcher(options: Dispatcher.DispatchOptions): Dispatcher {
    const origin = normalize_dispatch_origin(options.origin);
    const route = origin === null ? undefined : this.snapshot.routes[origin];
    if (route === undefined || route.kind === "direct") {
      return this.fallback_dispatcher;
    }
    return this.get_proxy_dispatcher(route);
  }

  /**
   * 同一代理 URI 复用同一个 agent，避免每次请求新建连接池。
   */
  private get_proxy_dispatcher(route: Exclude<SystemProxyRoute, { kind: "direct" }>): Dispatcher {
    const key = `${route.kind}:${route.uri}`;
    const existing_dispatcher = this.proxy_dispatchers.get(key);
    if (existing_dispatcher !== undefined) {
      return existing_dispatcher;
    }
    const dispatcher =
      route.kind === "socks5" ? new Socks5ProxyAgent(route.uri) : new ProxyAgent(route.uri);
    this.proxy_dispatchers.set(key, dispatcher);
    return dispatcher;
  }
}

/**
 * 添加模型 API URL，并按 provider 策略归一到 SDK 实际请求根。
 */
function add_proxy_url(
  urls_by_origin: Map<string, string>,
  api_format: ModelApiFormat,
  api_url: string,
): void {
  const normalized_url = LLMClientPolicy.normalize_api_url(api_url, api_format);
  if (normalized_url === "") {
    return;
  }
  const origin = read_origin(normalized_url);
  if (origin !== null && !urls_by_origin.has(origin)) {
    urls_by_origin.set(origin, normalized_url);
  }
}

/**
 * 生成代理 agent 可消费的 URI，坏代理条目会被调用方视作不支持并继续看下一个 rule。
 */
function build_proxy_uri(protocol: "http" | "https" | "socks5", target: string): string | null {
  const trimmed_target = target.trim();
  if (trimmed_target === "") {
    return null;
  }
  try {
    const url = new URL(
      trimmed_target.includes("://") ? trimmed_target : `${protocol}://${trimmed_target}`,
    );
    return url.hostname === "" ? null : url.toString();
  } catch {
    return null;
  }
}

/**
 * Undici dispatch options 的 origin 可能是 URL 对象，也可能是字符串。
 */
function normalize_dispatch_origin(origin: Dispatcher.DispatchOptions["origin"]): string | null {
  if (origin === undefined) {
    return null;
  }
  return read_origin(String(origin));
}

/**
 * 生成用户可见代理 URL，只展示协议和 host:port，不保留用户名、密码或路径。
 */
function format_system_proxy_route_display(
  route: Exclude<SystemProxyRoute, { kind: "direct" }>,
): string {
  try {
    const proxy_url = new URL(route.uri);
    const scheme = route.kind === "socks5" ? "socks5" : proxy_url.protocol.replace(/:$/u, "");
    return `${scheme}://${proxy_url.host}`;
  } catch {
    return route.kind === "socks5" ? "socks5://" : "http://";
  }
}

/**
 * 只接受 HTTP(S) 远端地址，本机模型服务和无效 URL 不进入代理快照。
 */
function read_origin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (is_loopback_hostname(parsed.hostname)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 本机模型服务不应经过系统代理，避免把 SakuraLLM 等本地服务绕到外部代理。
 */
function is_loopback_hostname(hostname: string): boolean {
  const normalized_hostname = hostname.toLowerCase();
  return (
    normalized_hostname === "localhost" ||
    normalized_hostname === "[::1]" ||
    normalized_hostname === "::1" ||
    normalized_hostname.startsWith("127.")
  );
}

/**
 * 复制快照对象，避免安装后调用方继续修改 routes。
 */
function clone_system_proxy_snapshot(snapshot: SystemProxySnapshot): SystemProxySnapshot {
  return {
    routes: Object.fromEntries(
      Object.entries(snapshot.routes).map(([origin, route]) => [origin, { ...route }]),
    ),
  };
}
