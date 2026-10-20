import type { ProxySettingValue } from "../domain/setting";
import type { AppProxyHost } from "../shared/proxy";

/**
 * 集成测试用的代理宿主替身：接受任意配置，探测恒成功。
 *
 * 只有关心下发时序的测试需要传入 `apply`，其余场景用默认实现即可。
 */
export function create_app_proxy_host_fixture(
  options: { apply?: (setting: ProxySettingValue) => Promise<void> } = {},
): AppProxyHost {
  return {
    apply: options.apply ?? (async () => undefined),
    probe: async () => ({ ok: true, status: 204, elapsedMs: 0, route: null, failureReason: null }),
  };
}
