import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { build_core_api_base_url_argument } from "../../core/api/api-base-url";
import { build_desktop_system_proxy_startup_notice_argument } from "../bridge/system-proxy-startup-notice";
import { IPC_CHANNEL_WINDOW_CLOSE_REQUEST } from "../gui-ipc-contract";
import { resolve_title_bar_overlay_theme } from "./shell-contract";
import { LOG_WINDOW_QUERY_KEY, LOG_WINDOW_QUERY_VALUE } from "./log-window-host";
import type { RendererProcessDiagnosticsRegistry } from "./renderer-process-diagnostics";

// electron mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const electron_mock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  // FakeDevToolsContents 模拟外部运行时对象，只保留当前测试会触发的行为面。
  /**
   * 封装当前测试场景的替身对象行为。
   */
  class FakeDevToolsContents {
    loading = false;
    executed_scripts: string[] = [];
    listeners = new Map<string, Listener[]>();

    // isLoadingMainFrame 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 判断当前值是否满足业务条件。
     */
    isLoadingMainFrame(): boolean {
      return this.loading;
    }

    // once 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    once(event_name: string, listener: Listener): void {
      const listeners = this.listeners.get(event_name) ?? [];
      listeners.push(listener);
      this.listeners.set(event_name, listeners);
    }

    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    emit(event_name: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event_name) ?? []) {
        listener(...args);
      }
      this.listeners.delete(event_name);
    }

    // executeJavaScript 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟开发者工具脚本执行结果。
     */
    async executeJavaScript(script: string): Promise<boolean> {
      this.executed_scripts.push(script);
      return true;
    }
  }

  // FakeWebContents 模拟外部运行时对象，只保留当前测试会触发的行为面。
  /**
   * 封装当前测试场景的替身对象行为。
   */
  class FakeWebContents {
    listeners = new Map<string, Listener[]>();
    once_listeners = new Map<string, Listener[]>();
    sent_channels: string[] = [];
    loading = false;
    devToolsWebContents: FakeDevToolsContents | null = null;
    toggleDevTools = vi.fn();

    // on 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    on(event_name: string, listener: Listener): void {
      const listeners = this.listeners.get(event_name) ?? [];
      listeners.push(listener);
      this.listeners.set(event_name, listeners);
    }

    // once 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    once(event_name: string, listener: Listener): void {
      const listeners = this.once_listeners.get(event_name) ?? [];
      listeners.push(listener);
      this.once_listeners.set(event_name, listeners);
    }

    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    emit(event_name: string, ...args: unknown[]): void {
      for (const listener of this.once_listeners.get(event_name) ?? []) {
        listener(...args);
      }
      this.once_listeners.delete(event_name);
      for (const listener of this.listeners.get(event_name) ?? []) {
        listener(...args);
      }
    }

    // isLoadingMainFrame 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 判断当前值是否满足业务条件。
     */
    isLoadingMainFrame(): boolean {
      return this.loading;
    }

    // send 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟 IPC 通信行为。
     */
    send(channel: string): void {
      this.sent_channels.push(channel);
    }

    // openDevTools 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 切换当前交互状态。
     */
    openDevTools(): void {
      this.devToolsWebContents = new FakeDevToolsContents();
      this.emit("devtools-opened");
    }
  }

  // FakeBrowserWindow 模拟外部运行时对象，只保留当前测试会触发的行为面。
  /**
   * 封装当前测试场景的替身对象行为。
   */
  class FakeBrowserWindow {
    static created_windows: FakeBrowserWindow[] = [];

    options: Record<string, unknown>;
    webContents = new FakeWebContents();
    visible = false;
    focused = false;
    title_bar_overlays: unknown[] = [];
    listeners = new Map<string, Listener[]>();
    once_listeners = new Map<string, Listener[]>();
    load_file_calls: Array<{ file_path: string; options?: { query?: Record<string, string> } }> =
      [];
    loaded_urls: string[] = [];

    // 构造阶段只注入必要依赖，避免实例创建时读取外部可变状态。
    /**
     * 初始化当前实例的内部状态。
     */
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeBrowserWindow.created_windows.push(this);
    }

    // on 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    on(event_name: string, listener: Listener): void {
      const listeners = this.listeners.get(event_name) ?? [];
      listeners.push(listener);
      this.listeners.set(event_name, listeners);
    }

    // once 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    once(event_name: string, listener: Listener): void {
      const listeners = this.once_listeners.get(event_name) ?? [];
      listeners.push(listener);
      this.once_listeners.set(event_name, listeners);
    }

    // emit 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 模拟事件订阅与派发行为。
     */
    emit(event_name: string, ...args: unknown[]): void {
      for (const listener of this.once_listeners.get(event_name) ?? []) {
        listener(...args);
      }
      this.once_listeners.delete(event_name);
      for (const listener of this.listeners.get(event_name) ?? []) {
        listener(...args);
      }
    }

    // isVisible 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 判断当前值是否满足业务条件。
     */
    isVisible(): boolean {
      return this.visible;
    }

    // show 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 支撑当前测试场景的专用辅助逻辑。
     */
    show(): void {
      this.visible = true;
    }

    // focus 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 支撑当前测试场景的专用辅助逻辑。
     */
    focus(): void {
      this.focused = true;
    }

    // loadFile 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 加载当前场景的资源入口。
     */
    async loadFile(file_path: string, options?: { query?: Record<string, string> }): Promise<void> {
      this.load_file_calls.push({ file_path, options });
    }

    // loadURL 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 加载当前场景的资源入口。
     */
    async loadURL(url: string): Promise<void> {
      this.loaded_urls.push(url);
    }

    // setTitleBarOverlay 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
    /**
     * 写入当前场景的状态变化。
     */
    setTitleBarOverlay(overlay: unknown): void {
      this.title_bar_overlays.push(overlay);
    }
  }

  return {
    FakeBrowserWindow,
    append_switch: vi.fn(),
    show_error_box: vi.fn(),
    native_theme: {
      shouldUseDarkColors: false,
    },
  };
});

// log bridge mock 是测试级共享夹具，集中保存跨用例复用的 mock 状态。
const log_bridge_mock = vi.hoisted(() => {
  return {
    write_electron_main_error: vi.fn(),
    write_electron_main_warning: vi.fn(),
  };
});

vi.mock("electron", () => {
  return {
    app: {
      commandLine: {
        appendSwitch: electron_mock.append_switch,
      },
    },
    BrowserWindow: electron_mock.FakeBrowserWindow,
    dialog: {
      showErrorBox: electron_mock.show_error_box,
    },
    nativeTheme: electron_mock.native_theme,
  };
});

vi.mock("../../core/log/log-bridge", () => {
  return log_bridge_mock;
});

vi.mock("../../core/log/log-text", () => {
  return {
    t_main_log: (key: string) => key,
  };
});

const original_renderer_url = process.env["ELECTRON_RENDERER_URL"];
const original_vite_public = process.env["VITE_PUBLIC"];

describe("桌面窗口宿主", () => {
  afterEach(() => {
    restore_env("ELECTRON_RENDERER_URL", original_renderer_url);
    restore_env("VITE_PUBLIC", original_vite_public);
    electron_mock.FakeBrowserWindow.created_windows.length = 0;
    electron_mock.native_theme.shouldUseDarkColors = false;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("主窗口注入 Core API 地址并把关闭确认交给 renderer", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    restore_env("VITE_PUBLIC", undefined);
    const { create_main_window } = await import("./desktop-window-host");
    const desktop_bundle_dir = path.join(process.cwd(), "build", "dist-electron");
    const on_closed = vi.fn();

    create_main_window({
      desktopBundleDir: desktop_bundle_dir,
      coreApiBaseUrl: "http://127.0.0.1:4567",
      systemProxyStartupNotice: {
        detected: true,
        proxiedOriginCount: 2,
        proxyDisplay: "http://127.0.0.1:7890",
      },
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      shouldBypassCloseConfirmation: () => false,
      onClosed: on_closed,
    });
    const main_window = get_created_window(0);
    const close_event = { preventDefault: vi.fn() };

    main_window.emit("close", close_event);
    main_window.emit("ready-to-show");
    main_window.emit("closed");

    expect(main_window.options).toMatchObject({
      title: "LinguaGacha",
      width: 1280,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(desktop_bundle_dir, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [
          build_core_api_base_url_argument("http://127.0.0.1:4567"),
          build_desktop_system_proxy_startup_notice_argument({
            detected: true,
            proxiedOriginCount: 2,
            proxyDisplay: "http://127.0.0.1:7890",
          }),
        ],
        sandbox: false,
      },
    });
    expect(main_window.load_file_calls[0]?.file_path).toBe(
      path.join(desktop_bundle_dir, "..", "dist", "index.html"),
    );
    expect(close_event.preventDefault).toHaveBeenCalledTimes(1);
    expect(main_window.webContents.sent_channels).toEqual([IPC_CHANNEL_WINDOW_CLOSE_REQUEST]);
    expect(main_window.visible).toBe(true);
    expect(main_window.focused).toBe(true);
    expect(on_closed).toHaveBeenCalledTimes(1);
  });

  it("日志窗口宿主加载日志页面并跳过主窗口关闭确认", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    const { create_log_window_host } = await import("./desktop-window-host");
    const desktop_bundle_dir = path.join(process.cwd(), "build", "dist-electron");
    const host = create_log_window_host({
      desktopBundleDir: desktop_bundle_dir,
      coreApiBaseUrl: "http://127.0.0.1:6789",
      systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      rendererDiagnostics: create_renderer_diagnostics_stub(),
    });
    const close_event = { preventDefault: vi.fn() };

    host.open();
    const log_window = get_created_window(0);
    log_window.emit("close", close_event);

    expect(log_window.load_file_calls[0]).toEqual({
      file_path: path.join(desktop_bundle_dir, "..", "dist", "index.html"),
      options: {
        query: {
          [LOG_WINDOW_QUERY_KEY]: LOG_WINDOW_QUERY_VALUE,
        },
      },
    });
    expect(close_event.preventDefault).not.toHaveBeenCalled();
    expect(log_window.webContents.sent_channels).toEqual([]);
  });

  it("渲染层加载失败时记录诊断并显示原生错误提示", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    const { create_main_window } = await import("./desktop-window-host");

    create_main_window({
      desktopBundleDir: path.join(process.cwd(), "build", "dist-electron"),
      coreApiBaseUrl: "http://127.0.0.1:4567",
      systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      shouldBypassCloseConfirmation: () => true,
      onClosed: vi.fn(),
    });
    const main_window = get_created_window(0);

    main_window.webContents.emit(
      "did-fail-load",
      {},
      -102,
      "连接被拒绝",
      "http://127.0.0.1:5173/",
      true,
    );
    main_window.webContents.emit(
      "did-fail-load",
      {},
      -3,
      "子框架中断",
      "https://asset.test",
      false,
    );

    expect(log_bridge_mock.write_electron_main_error).toHaveBeenCalledWith(
      "app.diagnostic.renderer.main_frame_load_failed",
      {
        context: {
          error_code: -102,
          error_description: "连接被拒绝",
          validated_url: "http://127.0.0.1:5173/",
        },
      },
    );
    expect(electron_mock.show_error_box).toHaveBeenCalledWith(
      "LinguaGacha 渲染层加载失败",
      "渲染层入口没有成功加载。\n目标地址：http://127.0.0.1:5173/\n错误信息：加载失败 (-102): 连接被拒绝",
    );
    expect(log_bridge_mock.write_electron_main_warning).toHaveBeenCalledWith(
      "app.diagnostic.renderer.subframe_load_failed",
      {
        context: {
          error_code: -3,
          error_description: "子框架中断",
          validated_url: "https://asset.test",
        },
      },
    );
    expect(main_window.visible).toBe(true);
    expect(main_window.focused).toBe(true);
  });

  it("渲染进程退出时记录诊断注册器生成的崩溃上下文", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    const { create_main_window } = await import("./desktop-window-host");
    const renderer_diagnostics = create_renderer_diagnostics_stub({
      processGoneContext: {
        windowKind: "main",
        rendererDiagnostics: {
          route: "workbench",
        },
      },
    });

    create_main_window({
      desktopBundleDir: path.join(process.cwd(), "build", "dist-electron"),
      coreApiBaseUrl: "http://127.0.0.1:4567",
      systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      rendererDiagnostics: renderer_diagnostics,
      shouldBypassCloseConfirmation: () => true,
      onClosed: vi.fn(),
    });
    const main_window = get_created_window(0);
    const details = {
      reason: "crashed",
      exitCode: -36861,
    };

    main_window.webContents.emit("render-process-gone", {}, details);

    expect(renderer_diagnostics.buildRendererProcessGoneContext).toHaveBeenCalledWith(
      main_window,
      details,
    );
    expect(log_bridge_mock.write_electron_main_error).toHaveBeenCalledWith(
      "app.diagnostic.renderer.process_exited",
      {
        context: {
          windowKind: "main",
          rendererDiagnostics: {
            route: "workbench",
          },
        },
      },
    );
    expect(main_window.visible).toBe(true);
    expect(main_window.focused).toBe(true);
  });

  it("开发态启用调试端口、加载 dev server 并响应 DevTools 快捷键", async () => {
    restore_env("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173/app");
    const {
      configure_development_remote_debugging,
      configure_renderer_public_path,
      create_main_window,
    } = await import("./desktop-window-host");

    configure_development_remote_debugging();
    configure_renderer_public_path(path.join(process.cwd(), "build", "dist-electron"));
    create_main_window({
      desktopBundleDir: path.join(process.cwd(), "build", "dist-electron"),
      coreApiBaseUrl: "http://127.0.0.1:4567",
      systemProxyStartupNotice: { detected: false, proxiedOriginCount: 0, proxyDisplay: null },
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      shouldBypassCloseConfirmation: () => true,
      onClosed: vi.fn(),
    });
    const main_window = get_created_window(0);
    const shortcut_event = { preventDefault: vi.fn() };

    main_window.webContents.emit("before-input-event", shortcut_event, {
      type: "keyDown",
      key: "F12",
    });

    expect(electron_mock.append_switch).toHaveBeenCalledWith("remote-debugging-port", "9222");
    expect(process.env["VITE_PUBLIC"]).toBe(path.join(process.cwd(), "public"));
    expect(main_window.loaded_urls).toEqual(["http://127.0.0.1:5173/app"]);
    expect(main_window.visible).toBe(true);
    expect(main_window.focused).toBe(true);
    expect(shortcut_event.preventDefault).toHaveBeenCalledTimes(1);
    expect(main_window.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
  });

  it("标题栏主题只在支持 overlay 的宿主平台同步给原生窗口", async () => {
    const { sync_title_bar_overlay } = await import("./desktop-window-host");
    const target_window = new electron_mock.FakeBrowserWindow({});

    sync_title_bar_overlay(
      target_window as unknown as Parameters<typeof sync_title_bar_overlay>[0],
      "dark",
    );
    sync_title_bar_overlay(null, "light");

    if (process.platform === "win32" || process.platform === "linux") {
      expect(target_window.title_bar_overlays).toEqual([resolve_title_bar_overlay_theme("dark")]);
    } else {
      expect(target_window.title_bar_overlays).toEqual([]);
    }
  });
});

// restore_env 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 写入当前场景的状态变化。
 */
function restore_env(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

// get_created_window 收口测试中的共享步骤，保证断言只关注当前行为。
/**
 * 读取当前场景需要的稳定数据。
 */
function get_created_window(
  index: number,
): (typeof electron_mock.FakeBrowserWindow.created_windows)[number] {
  const target_window = electron_mock.FakeBrowserWindow.created_windows[index];
  if (target_window === undefined) {
    throw new Error("缺少已创建的窗口实例。");
  }
  return target_window;
}

// create_renderer_diagnostics_stub 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
/**
 * 构造当前测试场景的标准数据。
 */
function create_renderer_diagnostics_stub(
  options: {
    processGoneContext?: Record<string, unknown>;
    unresponsiveContext?: Record<string, unknown>;
  } = {},
): RendererProcessDiagnosticsRegistry {
  return {
    registerWindow: vi.fn(),
    recordRendererDiagnostics: vi.fn(),
    buildRendererProcessGoneContext: vi.fn(() => options.processGoneContext ?? {}),
    buildWindowUnresponsiveContext: vi.fn(() => options.unresponsiveContext ?? {}),
  };
}
