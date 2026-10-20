import type { ProxyMode, ProxySettingValue } from "../domain/setting";

/**
 * 出站代理的下发状态；设置读取响应与设置页提示共用，不写入设置文件。
 */
export type AppProxyRuntimeStatus = Readonly<{
  applied: boolean; // 当前持久化配置是否已下发到两套栈
  effectiveMode: ProxyMode; // 出站实际使用的模式，未下发时为 system
  failureReason: string | null; // 最近一次下发失败原因；失败原因不含凭据
}>;

/** 一条代理链路的测试结果；失败原因与路由都不含凭据。 */
export type ProxyProbeResult = Readonly<{
  ok: boolean;
  status: number | null; // 未拿到响应时为 null
  elapsedMs: number; // 从发起请求到拿到响应或失败
  route: string | null; // 宿主回报的实际出站路由，未回报时为 null
  failureReason: string | null; // 失败原因；成功为 null
}>;

/** 翻译链路与更新链路的测试结果。 */
export type ProxyProbeSummary = Readonly<{
  translation: ProxyProbeResult;
  updates: ProxyProbeResult;
}>;

/**
 * 出站代理的宿主端口：下发配置，并按 Chromium 栈探测更新链路。
 *
 * GUI 经宿主操作实现，CLI 直接作用于本进程 session。传入的 `mode` 是生效
 * 模式，手动字段不完整时调用方已降级为 `system`。
 */
export interface AppProxyHost {
  apply: (setting: ProxySettingValue) => Promise<void>;
  probe: (url: string) => Promise<ProxyProbeResult>;
}
