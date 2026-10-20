import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    listeners,
    app: {
      on: (_event: string, listener: (...args: unknown[]) => void) => {
        listeners.add(listener);
      },
      off: (_event: string, listener: (...args: unknown[]) => void) => {
        listeners.delete(listener);
      },
    },
  };
});

vi.mock("electron", () => ({ app: mocks.app }));

import { ElectronProxyHost } from "./electron-proxy-host";
import type { ProxySettingValue } from "../domain/setting";

const MANUAL_HTTP: ProxySettingValue = {
  mode: "manual",
  protocol: "HTTP",
  host: "127.0.0.1",
  port: 7890,
  username: "",
  password: "",
};

type LoginAnswer = {
  prevented: boolean;
  username: string | undefined;
  password: string | undefined;
};

/** 记录 setProxy 配置并固定系统规则的 session 替身。 */
function create_session(system_rules = "DIRECT") {
  const applied_configs: Electron.ProxyConfig[] = [];
  const close_all_connections = vi.fn(async (): Promise<void> => {});
  const session = {
    setProxy: async (config: Electron.ProxyConfig): Promise<void> => {
      applied_configs.push(config);
    },
    resolveProxy: async (_url: string): Promise<string> => system_rules,
    closeAllConnections: close_all_connections,
  };
  return { session, applied_configs, close_all_connections };
}

/** 触发宿主登录挑战，返回应用是否应答及应答内容。 */
function raise_login(auth_info: Electron.AuthInfo): LoginAnswer {
  const answer: LoginAnswer = { prevented: false, username: undefined, password: undefined };
  const event = {
    preventDefault: () => {
      answer.prevented = true;
    },
  };
  for (const listener of mocks.listeners) {
    listener(event, null, {}, auth_info, (username?: string, password?: string) => {
      answer.username = username;
      answer.password = password;
    });
  }
  return answer;
}

beforeEach(() => {
  mocks.listeners.clear();
});

describe("ElectronProxyHost", () => {
  it("手动 HTTP 与 HTTPS 只下发代理地址，凭据留给登录事件", async () => {
    const { session, applied_configs } = create_session();
    const host = new ElectronProxyHost(session);

    await host.apply(MANUAL_HTTP);
    expect(applied_configs).toEqual([{ mode: "fixed_servers", proxyRules: "127.0.0.1:7890" }]);
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "PROXY 127.0.0.1:7890",
    );

    await host.apply({ ...MANUAL_HTTP, protocol: "HTTPS" });
    expect(applied_configs[1]).toEqual({
      mode: "fixed_servers",
      proxyRules: "https://127.0.0.1:7890",
    });
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "HTTPS 127.0.0.1:7890",
    );
  });
  it("仅修改同一代理的凭据时关闭旧连接", async () => {
    const { session, close_all_connections } = create_session();
    const host = new ElectronProxyHost(session);
    await host.apply({ ...MANUAL_HTTP, username: "alice", password: "one" });
    close_all_connections.mockClear();

    await host.apply({ ...MANUAL_HTTP, username: "alice", password: "two" });

    expect(close_all_connections).toHaveBeenCalledOnce();
  });

  it("配置未变化时不关闭连接", async () => {
    const { session, close_all_connections } = create_session();
    const host = new ElectronProxyHost(session);
    const setting = { ...MANUAL_HTTP, username: "alice", password: "one" };
    await host.apply(setting);
    close_all_connections.mockClear();

    await host.apply(setting);

    expect(close_all_connections).not.toHaveBeenCalled();
  });

  it("切换代理地址时关闭旧连接", async () => {
    const { session, close_all_connections } = create_session();
    const host = new ElectronProxyHost(session);
    await host.apply({ ...MANUAL_HTTP, username: "alice", password: "one" });
    close_all_connections.mockClear();

    await host.apply({ ...MANUAL_HTTP, host: "10.0.0.2", username: "alice", password: "one" });

    expect(close_all_connections).toHaveBeenCalledOnce();
  });

  it("手动凭据做 URI 编码后只进入 undici 路由", async () => {
    const { session, applied_configs } = create_session();
    const host = new ElectronProxyHost(session);

    await host.apply({ ...MANUAL_HTTP, username: "u ser", password: "p@ss" });

    expect(applied_configs[0]).toEqual({
      mode: "fixed_servers",
      proxyRules: "127.0.0.1:7890",
    });
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "PROXY u%20ser:p%40ss@127.0.0.1:7890",
    );
  });

  it("SOCKS5 认证在 Chromium 栈显式回到系统，undici 栈仍走手动代理", async () => {
    const { session, applied_configs } = create_session("PROXY 10.0.0.1:8080");
    const host = new ElectronProxyHost(session);

    await host.apply({ ...MANUAL_HTTP, protocol: "SOCKS5", username: "user", password: "pass" });
    expect(applied_configs[0]).toEqual({ mode: "system" });
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "SOCKS5 user:pass@127.0.0.1:7890",
    );

    await host.apply({ ...MANUAL_HTTP, protocol: "SOCKS5" });
    expect(applied_configs[1]).toEqual({
      mode: "fixed_servers",
      proxyRules: "socks5://127.0.0.1:7890",
    });
  });

  it("未下发与系统模式共用宿主规则，直连不再查询系统代理", async () => {
    const { session, applied_configs } = create_session("PROXY 10.0.0.1:8080");
    const host = new ElectronProxyHost(session);

    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "PROXY 10.0.0.1:8080",
    );

    await host.apply({ ...MANUAL_HTTP, mode: "direct" });
    expect(applied_configs[0]).toEqual({ mode: "direct" });
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe("DIRECT");

    await host.apply({ ...MANUAL_HTTP, mode: "system" });
    expect(applied_configs[1]).toEqual({ mode: "system" });
    await expect(host.resolve_proxy_rules("https://api.example/models")).resolves.toBe(
      "PROXY 10.0.0.1:8080",
    );
  });

  it("只回答当前手动代理的登录挑战", async () => {
    const { session } = create_session();
    const host = new ElectronProxyHost(session);

    await host.apply({ ...MANUAL_HTTP, username: "user", password: "pass" });
    expect(
      raise_login({ isProxy: true, host: "127.0.0.1", port: 7890 } as Electron.AuthInfo),
    ).toEqual({ prevented: true, username: "user", password: "pass" });
    // 其它代理、其它端口与普通站点认证都不下发凭据。
    expect(
      raise_login({ isProxy: true, host: "10.0.0.1", port: 7890 } as Electron.AuthInfo).prevented,
    ).toBe(false);
    expect(
      raise_login({ isProxy: true, host: "127.0.0.1", port: 1080 } as Electron.AuthInfo).prevented,
    ).toBe(false);
    expect(
      raise_login({ isProxy: false, host: "127.0.0.1", port: 7890 } as Electron.AuthInfo).prevented,
    ).toBe(false);

    host.dispose();
    expect(
      raise_login({ isProxy: true, host: "127.0.0.1", port: 7890 } as Electron.AuthInfo).prevented,
    ).toBe(false);
  });

  it("SOCKS5 认证与直连不回答登录挑战", async () => {
    const { session } = create_session();
    const host = new ElectronProxyHost(session);

    await host.apply({ ...MANUAL_HTTP, protocol: "SOCKS5", username: "user", password: "pass" });
    expect(
      raise_login({ isProxy: true, host: "127.0.0.1", port: 7890 } as Electron.AuthInfo).prevented,
    ).toBe(false);

    await host.apply({ ...MANUAL_HTTP, mode: "direct" });
    expect(
      raise_login({ isProxy: true, host: "127.0.0.1", port: 7890 } as Electron.AuthInfo).prevented,
    ).toBe(false);
  });
});
