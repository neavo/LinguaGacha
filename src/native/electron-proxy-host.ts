import { app, type Session } from "electron";

import { is_same_proxy_setting, type ProxySettingValue } from "../domain/setting";

/** Electron session 中出站代理需要的全部能力。 */
type ProxySession = Pick<
  Session,
  "setProxy" | "resolveProxy" | "closeAllConnections"
>;

/** 宿主登录挑战的监听签名，与 Electron 的 login 事件一致。 */
type AppLoginListener = (
  event: Electron.Event,
  web_contents: Electron.WebContents | null,
  details: Electron.AuthenticationResponseDetails,
  auth_info: Electron.AuthInfo,
  callback: (username?: string, password?: string) => void,
) => void;

/**
 * 出站代理的宿主事实：Chromium 栈按已下发配置出站，undici 栈经代理解析取用同一份事实。
 *
 * GUI 由 main 进程持有，CLI 由命令进程直接持有。未成功下发时两套栈都退回系统代理，
 * 与旧版本行为一致。
 */
export class ElectronProxyHost {
  private readonly session: ProxySession;
  private applied: ProxySettingValue | null = null; // 只有成功下发才更新，失败保持上一份事实

  /** 只回答当前手动代理的挑战，避免把凭据交给其它代理。 */
  private readonly handle_login: AppLoginListener = (
    event,
    _web_contents,
    _details,
    auth_info,
    callback,
  ) => {
    const credentials = this.read_manual_credentials(auth_info);
    if (credentials === null) return;
    event.preventDefault();
    callback(credentials.username, credentials.password);
  };

  /** 注册宿主登录应答；进程生命周期内只注册一次。 */
  public constructor(session: ProxySession) {
    this.session = session;
    app.on("login", this.handle_login);
  }

  /**
   * 下发配置。`setProxy` 只写配置不建立连接，合法但不可达的代理不会在这里失败。
   *
   * 配置变化时关闭旧连接：Chromium 会复用经旧代理建立的池化连接，不处理会让
   * 后续请求继续使用旧路由。
   */
  public async apply(setting: ProxySettingValue): Promise<void> {
    const previous = this.applied;
    await this.session.setProxy(build_chromium_proxy_config(setting));
    if (previous !== null && !is_same_proxy_setting(previous, setting)) {
      await this.session.closeAllConnections();
    }
    this.applied = setting;
  }

  /**
   * undici 栈的代理解析入口；与 Chromium 栈共用同一份已下发事实。
   *
   * 手动模式沿用 Chromium 规则文本，凭据以 URI userinfo 携带，仅由本项目
   * system-proxy-http-client 的解析器消费，也因此能原样经工作区 IPC 下发。
   */
  public readonly resolve_proxy_rules = async (url: string): Promise<string> => {
    const applied = this.applied;
    if (applied === null || applied.mode === "system") {
      return await this.session.resolveProxy(url);
    }
    if (applied.mode === "direct") return "DIRECT";
    return build_undici_proxy_rules(applied);
  };

  /** 解除宿主监听；未释放的监听会跨进程存续。 */
  public dispose(): void {
    app.off("login", this.handle_login);
    this.applied = null;
  }

  /** 只回答当前手动代理的挑战；SOCKS5 认证在 Chromium 栈不可用，不下发凭据。 */
  private read_manual_credentials(
    auth_info: Electron.AuthInfo,
  ): { username: string; password: string } | null {
    const applied = this.applied;
    if (applied === null || applied.mode !== "manual") return null;
    if (applied.protocol === "SOCKS5" || applied.username === "") return null;
    if (!auth_info.isProxy || auth_info.port !== applied.port) return null;
    if (auth_info.host.toLowerCase() !== applied.host.toLowerCase()) return null;
    return { username: applied.username, password: applied.password };
  }
}

/** Chromium 栈的代理配置；SOCKS5 认证不受支持时显式回到系统。 */
function build_chromium_proxy_config(setting: ProxySettingValue): Electron.ProxyConfig {
  if (setting.mode === "direct") return { mode: "direct" };
  if (setting.mode === "system") return { mode: "system" };
  if (setting.protocol === "SOCKS5" && setting.username !== "") return { mode: "system" };
  return { mode: "fixed_servers", proxyRules: build_chromium_proxy_rules(setting) };
}

/** 手动模式的 Chromium 规则文本；凭据只能经 login 事件回答。 */
function build_chromium_proxy_rules(setting: ProxySettingValue): string {
  const target = `${setting.host}:${setting.port}`;
  if (setting.protocol === "SOCKS5") return `socks5://${target}`;
  if (setting.protocol === "HTTPS") return `https://${target}`;
  return target;
}

/** 手动模式的 undici 路由文本；用户名与密码做 URI 编码后放入 userinfo。 */
function build_undici_proxy_rules(setting: ProxySettingValue): string {
  const type = setting.protocol === "HTTP" ? "PROXY" : setting.protocol;
  return `${type} ${format_proxy_credentials(setting)}${setting.host}:${setting.port}`;
}

/** 无用户名时不写 userinfo，避免生成空用户名挑战。 */
function format_proxy_credentials(setting: ProxySettingValue): string {
  if (setting.username === "") return "";
  return `${encodeURIComponent(setting.username)}:${encodeURIComponent(setting.password)}@`;
}
