import type { ProxyMode, ProxySettingValue } from "../domain/setting";

/**
 * 出站代理的下发状态；设置读取响应与设置页提示共用，不写入设置文件。
 */
export type AppProxyRuntimeStatus = Readonly<{
  applied: boolean; // 当前持久化配置是否已下发到两套栈
  effectiveMode: ProxyMode; // 出站实际使用的模式，未下发时为 system
  failureReason: string | null; // 最近一次下发失败原因；失败原因不含凭据
}>;

/**
 * 把生效代理配置下发到宿主：GUI 走宿主操作，CLI 直接作用于本进程 session。
 *
 * 传入的 `mode` 是生效模式，手动字段不完整时调用方已降级为 `system`。
 */
export interface AppProxyApplier {
  apply: (setting: ProxySettingValue) => Promise<void>;
}
