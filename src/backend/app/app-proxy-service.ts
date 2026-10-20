import { read_proxy_setting } from "../../domain/setting";
import { race_abort } from "../../shared/abort";
import type {
  AppProxyHost,
  AppProxyRuntimeStatus,
  ProxyProbeResult,
  ProxyProbeSummary,
} from "../../shared/proxy";
import type { AppSettingService } from "./app-setting-service";
import {
  resolve_system_proxy_route,
  type SystemProxyResolver,
  type SystemProxyRoute,
} from "../network/system-proxy-http-client";

/** 翻译链路探测地址：固定 204 空正文，不把第三方内容带进结果。 */
const TRANSLATION_PROBE_URL = "https://www.gstatic.com/generate_204";
/** 更新链路探测地址：与更新检查同主机，走 Chromium 栈。 */
const UPDATE_PROBE_URL = "https://api.github.com/zen";
/** 单条探测的固定短超时；超时按失败返回，不阻塞设置页。 */
const PROBE_TIMEOUT_MS = 5000;

/**
 * 出站代理的下发入口：把生效配置交给宿主，并记录对外可见的运行期状态。
 *
 * 状态只存在于内存，不写入设置文件；重启后按持久化配置重新计算。
 */
export class AppProxyService {
  private status: AppProxyRuntimeStatus = {
    applied: false,
    effectiveMode: "system",
    failureReason: null,
  };

  /** 保存宿主端口与设置读取入口；设置只用于启动期读取持久化配置。 */
  public constructor(
    private readonly host: AppProxyHost,
    private readonly settings: AppSettingService,
    private readonly system_proxy_resolver: SystemProxyResolver, // 翻译链路与 undici 共用同一份代理解析
  ) {}

  /** 启动期按持久化配置下发；失败只降级为跟随系统并记录原因，不阻止启动。 */
  public async apply_persisted(): Promise<void> {
    try {
      await this.apply(this.settings.read_setting()["proxy"]);
    } catch (error) {
      this.status = {
        applied: false,
        effectiveMode: "system",
        failureReason: read_failure_reason(error),
      };
    }
  }

  /** 保存路径下发请求中的配置；失败只记录原因并抛出，由命令层跳过落盘。 */
  public async apply_or_throw(value: unknown): Promise<void> {
    try {
      await this.apply(value);
    } catch (error) {
      this.status = { ...this.status, failureReason: read_failure_reason(error) };
      throw error;
    }
  }

  /** 落盘失败时恢复上一份配置；恢复失败同时保留落盘原因与恢复原因。 */
  public async revert(previous: unknown, failure: unknown): Promise<void> {
    try {
      await this.apply(previous);
    } catch (error) {
      this.status = { ...this.status, failureReason: read_failure_reason(error) };
      throw new AggregateError([failure, error], "Failed to restore the previous outbound proxy.");
    }
  }

  /** 读取下发状态；未下发时按跟随系统出站。 */
  public read_status(): AppProxyRuntimeStatus {
    return this.status;
  }

  /**
   * 测试当前已保存配置的两条链路；任一条失败都不影响另一条。
   *
   * 翻译链路与模型请求共用后端 transport，更新链路与更新检查共用 Chromium 栈。
   */
  public async probe_links(): Promise<ProxyProbeSummary> {
    const [translation, updates] = await Promise.all([
      probe_backend_transport(this.system_proxy_resolver, TRANSLATION_PROBE_URL),
      this.probe_update_link(),
    ]);
    return { translation, updates };
  }

  /** 更新链路必须由宿主发起，才能看到 Chromium 栈的真实路由与认证结果。 */
  private async probe_update_link(): Promise<ProxyProbeResult> {
    try {
      return await this.host.probe(UPDATE_PROBE_URL);
    } catch (error) {
      return {
        ok: false,
        status: null,
        elapsedMs: 0,
        route: null,
        failureReason: read_failure_reason(error),
      };
    }
  }

  /** 生效模式由领域归一给出：手动字段不完整时按跟随系统出站。 */
  private async apply(value: unknown): Promise<void> {
    const resolved = read_proxy_setting(value);
    await this.host.apply({
      mode: resolved.effective_mode,
      protocol: resolved.protocol,
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      password: resolved.password,
    });
    this.status = { applied: true, effectiveMode: resolved.effective_mode, failureReason: null };
  }
}

/** 翻译链路经后端共享 transport 出站，与模型请求走同一路由。 */
async function probe_backend_transport(
  resolver: SystemProxyResolver,
  url: string,
): Promise<ProxyProbeResult> {
  const started_at = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // 路由解析与请求共用同一个超时上限；PAC 不返回时探测也会按时结束。
    const route = await read_probe_route(resolver, url, controller.signal);
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        elapsedMs: Date.now() - started_at,
        route,
        failureReason: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        elapsedMs: Date.now() - started_at,
        route,
        failureReason: read_failure_reason(error),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 翻译链路回报 undici 实际取用的路由。
 *
 * 手动模式的规则文本带 userinfo，格式化时只保留协议与地址；解析失败不影响探测本身，
 * 此时只省略路由。
 */
async function read_probe_route(
  resolver: SystemProxyResolver,
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    return format_probe_route(
      await race_abort(resolve_system_proxy_route(resolver, url, signal), signal),
    );
  } catch {
    return null;
  }
}

/** 与 Chromium 的 PAC 词法一致：PROXY、HTTPS、SOCKS5 与 DIRECT。 */
function format_probe_route(route: SystemProxyRoute): string {
  if (route.kind === "direct") return "DIRECT";
  const target = new URL(route.uri);
  const type =
    route.kind === "socks5" ? "SOCKS5" : target.protocol === "https:" ? "HTTPS" : "PROXY";
  return `${type} ${target.host}`; // host 不含 userinfo，凭据不进入界面
}

/** 下发失败原因只取宿主错误文本；凭据从不进入宿主的代理配置。 */
function read_failure_reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
