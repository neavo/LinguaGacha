import { describe, expect, it } from "vitest";

import { AppProxyService } from "./app-proxy-service";
import type { AppSettingService } from "./app-setting-service";
import type { ProxySettingValue } from "../../domain/setting";

const MANUAL: ProxySettingValue = {
  mode: "manual",
  protocol: "HTTP",
  host: "127.0.0.1",
  port: 7890,
  username: "user",
  password: "pass",
};

/** 记录下发内容，并可按次数注入失败。 */
function create_service(options: { proxy?: unknown; failures?: number } = {}) {
  const applied: ProxySettingValue[] = [];
  let remaining_failures = options.failures ?? 0;
  const service = new AppProxyService(
    {
      apply: async (setting) => {
        if (remaining_failures > 0) {
          remaining_failures -= 1;
          throw new Error("proxy apply failed");
        }
        applied.push(setting);
      },
    },
    { read_setting: () => ({ proxy: options.proxy }) } as unknown as AppSettingService,
  );
  return { service, applied };
}

describe("AppProxyService", () => {
  it("启动期把持久化配置下发到宿主", async () => {
    const { service, applied } = create_service({ proxy: MANUAL });

    await service.apply_persisted();

    expect(applied).toEqual([MANUAL]);
    expect(service.read_status()).toEqual({
      applied: true,
      effectiveMode: "manual",
      failureReason: null,
    });
  });

  it("手动字段不完整时降级为跟随系统，本轮状态仍视为已应用", async () => {
    const { service, applied } = create_service({
      proxy: { ...MANUAL, host: "", port: 0 },
    });

    await service.apply_persisted();

    expect(applied).toEqual([{ ...MANUAL, mode: "system", host: "", port: 0 }]);
    expect(service.read_status()).toEqual({
      applied: true,
      effectiveMode: "system",
      failureReason: null,
    });
  });

  it("启动期下发失败只降级为跟随系统并记录原因", async () => {
    const { service, applied } = create_service({ proxy: MANUAL, failures: 1 });

    await expect(service.apply_persisted()).resolves.toBeUndefined();

    expect(applied).toEqual([]);
    expect(service.read_status()).toEqual({
      applied: false,
      effectiveMode: "system",
      failureReason: "proxy apply failed",
    });
  });

  it("保存路径下发失败记录原因、抛出，并保留上一份生效状态", async () => {
    let should_fail = false;
    const applied: ProxySettingValue[] = [];
    const service = new AppProxyService(
      {
        apply: async (setting) => {
          if (should_fail) throw new Error("host rejected rules");
          applied.push(setting);
        },
      },
      { read_setting: () => ({}) } as unknown as AppSettingService,
    );

    await service.apply_or_throw(MANUAL);
    expect(service.read_status()).toEqual({
      applied: true,
      effectiveMode: "manual",
      failureReason: null,
    });

    should_fail = true;
    await expect(service.apply_or_throw(MANUAL)).rejects.toThrow("host rejected rules");
    expect(applied).toEqual([MANUAL]);
    expect(service.read_status()).toEqual({
      applied: true,
      effectiveMode: "manual",
      failureReason: "host rejected rules",
    });
  });

  it("从未成功下发时失败状态保持未应用", async () => {
    const { service } = create_service({ failures: 1 });

    await expect(service.apply_or_throw(MANUAL)).rejects.toThrow("proxy apply failed");

    expect(service.read_status()).toEqual({
      applied: false,
      effectiveMode: "system",
      failureReason: "proxy apply failed",
    });
  });
});
