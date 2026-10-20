import { afterEach, describe, expect, it, vi } from "vitest";

import { AppProxyService } from "./app-proxy-service";
import type { AppSettingService } from "./app-setting-service";
import type { LogManager } from "../log/log-manager";
import type { ProxySettingValue } from "../../domain/setting";
import type { ProxyProbeResult } from "../../shared/proxy";

const MANUAL: ProxySettingValue = {
  mode: "manual",
  protocol: "HTTP",
  host: "127.0.0.1",
  port: 7890,
  username: "user",
  password: "pass",
};

const UPDATES_OK: ProxyProbeResult = {
  ok: true,
  status: 200,
  elapsedMs: 30,
  route: "PROXY 127.0.0.1:7890",
  failureReason: null,
};

/** 记录下发内容，并可按次数注入失败。 */
function create_service(
  options: {
    proxy?: unknown;
    failures?: number;
    probe?: () => Promise<ProxyProbeResult>;
    proxyRules?: string;
    resolveProxy?: (url: string, signal?: AbortSignal) => Promise<string>;
  } = {},
) {
  const applied: ProxySettingValue[] = [];
  const probed_urls: string[] = [];
  let remaining_failures = options.failures ?? 0;
  const log = { info: vi.fn(), warning: vi.fn(), error: vi.fn() } as unknown as LogManager;
  const service = new AppProxyService(
    {
      apply: async (setting) => {
        if (remaining_failures > 0) {
          remaining_failures -= 1;
          throw new Error("proxy apply failed");
        }
        applied.push(setting);
      },
      probe: async (url) => {
        probed_urls.push(url);
        return options.probe === undefined ? UPDATES_OK : await options.probe();
      },
    },
    { read_setting: () => ({ proxy: options.proxy }) } as unknown as AppSettingService,
    log,
    { resolveProxy: options.resolveProxy ?? (async () => options.proxyRules ?? "DIRECT") },
  );
  return { service, applied, probed_urls, log };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    const { service, applied, log } = create_service({ proxy: MANUAL, failures: 1 });

    await expect(service.apply_persisted()).resolves.toBeUndefined();

    expect(applied).toEqual([]);
    expect(service.read_status()).toEqual({
      applied: false,
      effectiveMode: "system",
      failureReason: "proxy apply failed",
    });
    expect(log.error).toHaveBeenCalledOnce();
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
        probe: async () => UPDATES_OK,
      },
      { read_setting: () => ({}) } as unknown as AppSettingService,
      { info: vi.fn(), warning: vi.fn(), error: vi.fn() } as unknown as LogManager,
      { resolveProxy: async () => "DIRECT" },
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

  it("两条链路分别由后端 transport 与宿主探测，结果原样汇总", async () => {
    const fetch_mock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch_mock);
    const { service, probed_urls } = create_service({ proxyRules: "PROXY 127.0.0.1:7890" });

    const summary = await service.probe_links();

    expect(summary.translation).toMatchObject({
      ok: true,
      status: 204,
      route: "PROXY 127.0.0.1:7890",
      failureReason: null,
    });
    expect(summary.updates).toBe(UPDATES_OK);
    expect(fetch_mock).toHaveBeenCalledExactlyOnceWith(
      "https://www.gstatic.com/generate_204",
      expect.objectContaining({ method: "GET" }),
    );
    expect(probed_urls).toEqual(["https://api.github.com/zen"]);
  });

  it("一条链路失败不影响另一条，并把失败原因写入日志", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    const { service, log } = create_service({
      probe: async () => ({
        ok: false,
        status: null,
        elapsedMs: 5,
        route: "PROXY 127.0.0.1:7890",
        failureReason: "proxy connect ECONNREFUSED",
      }),
    });

    const summary = await service.probe_links();

    expect(summary.translation).toMatchObject({
      ok: false,
      status: null,
      failureReason: "getaddrinfo ENOTFOUND",
    });
    expect(summary.updates.failureReason).toBe("proxy connect ECONNREFUSED");
    expect(log.warning).toHaveBeenCalledTimes(2);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("翻译链路回报实际路由，凭据不进入界面", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const { service } = create_service({ proxyRules: "SOCKS5 user:pass@127.0.0.1:1080" });

    const summary = await service.probe_links();

    expect(summary.translation.route).toBe("SOCKS5 127.0.0.1:1080");
    expect(JSON.stringify(summary)).not.toContain("user");
  });

  it("路由解析不返回时探测按超时失败结算", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.signal?.aborted === true) return Promise.reject(new Error("aborted"));
          return Promise.resolve(new Response(null, { status: 204 }));
        }),
      );
      const { service } = create_service({
        resolveProxy: () => new Promise<string>(() => {}),
      });

      const pending = service.probe_links();
      await vi.advanceTimersByTimeAsync(5000);
      const summary = await pending;

      expect(summary.translation.ok).toBe(false);
      expect(summary.translation.route).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("宿主探测抛错时返回可展示的失败结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const { service } = create_service({
      probe: async () => {
        throw new Error("host operation failed");
      },
    });

    const summary = await service.probe_links();

    expect(summary.updates).toMatchObject({
      ok: false,
      status: null,
      route: null,
      failureReason: "host operation failed",
    });
    expect(summary.translation.ok).toBe(true);
  });
});
