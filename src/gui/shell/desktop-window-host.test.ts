import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { build_backend_api_base_url_argument } from "../../shared/backend-api";
import { IPC_CHANNEL_WINDOW_CLOSE_REQUEST } from "../gui-ipc-contract";
import { resolve_title_bar_overlay_theme } from "./shell-contract";
import { LOG_WINDOW_QUERY_KEY, LOG_WINDOW_QUERY_VALUE } from "./log-window-host";
import type { RendererProcessDiagnosticsRegistry } from "./renderer-process-diagnostics";

const record_host_diagnostic = vi.fn(async () => undefined);

// Electron 替身使用原生事件语义，集中记录窗口副作用。
const electron_mock = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");

  /** 模拟页面加载、宿主消息与开发者工具入口。 */
  class FakeWebContents extends EventEmitter {
    sent_channels: string[] = [];
    toggleDevTools = vi.fn();

    /** 当前关闭确认场景在页面加载完成后触发。 */
    isLoadingMainFrame(): boolean {
      return false;
    }

    /** 记录宿主通知 renderer 的 IPC 通道。 */
    send(channel: string): void {
      this.sent_channels.push(channel);
    }
  }

  /** 记录窗口创建、可见状态和原生能力调用。 */
  class FakeBrowserWindow extends EventEmitter {
    static created_windows: FakeBrowserWindow[] = [];

    options: Record<string, unknown>;
    webContents = new FakeWebContents();
    visible = false;
    focused = false;
    title_bar_overlays: unknown[] = [];
    flash_frames: boolean[] = [];
    load_file_calls: Array<{ file_path: string; options?: { query?: Record<string, string> } }> =
      [];
    loaded_urls: string[] = [];

    /** 保存创建参数，供主窗口和日志窗口的契约断言读取。 */
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      FakeBrowserWindow.created_windows.push(this);
    }

    /** 返回窗口当前可见状态。 */
    isVisible(): boolean {
      return this.visible;
    }

    /** 记录窗口被显示。 */
    show(): void {
      this.visible = true;
    }

    /** 记录窗口获得焦点。 */
    focus(): void {
      this.focused = true;
    }

    /** 按顺序记录任务栏闪烁的启停。 */
    flashFrame(flag: boolean): void {
      this.flash_frames.push(flag);
    }

    /** 记录发布态的页面路径与窗口路由。 */
    async loadFile(file_path: string, options?: { query?: Record<string, string> }): Promise<void> {
      this.load_file_calls.push({ file_path, ...(options === undefined ? {} : { options }) });
    }

    /** 记录开发态的页面地址。 */
    async loadURL(url: string): Promise<void> {
      this.loaded_urls.push(url);
    }

    /** 记录主题同步到原生按钮区的结果。 */
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

const original_renderer_url = process.env["ELECTRON_RENDERER_URL"];
const original_vite_public = process.env["VITE_PUBLIC"];

describe("桌面窗口宿主", () => {
  afterEach(() => {
    restore_env("ELECTRON_RENDERER_URL", original_renderer_url);
    restore_env("VITE_PUBLIC", original_vite_public);
    electron_mock.FakeBrowserWindow.created_windows.length = 0;
    electron_mock.native_theme.shouldUseDarkColors = false;
    vi.resetModules();
  });

  it("主窗口按深色主题初始化并委托关闭确认", async () => {
    electron_mock.native_theme.shouldUseDarkColors = true;
    restore_env("ELECTRON_RENDERER_URL", undefined);
    restore_env("VITE_PUBLIC", undefined);
    const { create_main_window } = await import("./desktop-window-host");
    const desktop_bundle_dir = path.join(process.cwd(), "build", "dist-electron");
    const on_closed = vi.fn();

    create_main_window({
      desktopBundleDir: desktop_bundle_dir,
      backendApiBaseUrl: "http://127.0.0.1:4567",
      appVersion: "1.2.3",
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      recordHostDiagnostic: record_host_diagnostic,
      shouldBypassCloseConfirmation: () => false,
      onClosed: on_closed,
    });
    const main_window = get_created_window(0);
    const close_event = { preventDefault: vi.fn() };

    main_window.emit("close", close_event);
    main_window.emit("ready-to-show");
    main_window.emit("closed");

    expect(main_window.options).toMatchObject({
      backgroundColor: resolve_title_bar_overlay_theme("dark").color,
      show: false,
      webPreferences: {
        preload: path.join(desktop_bundle_dir, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [
          build_backend_api_base_url_argument("http://127.0.0.1:4567"),
          "--app-version=1.2.3",
        ],
        sandbox: false,
      },
    });
    expect(main_window.load_file_calls[0]?.file_path).toBe(
      path.join(desktop_bundle_dir, "..", "dist", "index.html"),
    );
    expect(close_event.preventDefault).toHaveBeenCalledTimes(1);
    expect(main_window.webContents.sent_channels).toEqual([IPC_CHANNEL_WINDOW_CLOSE_REQUEST]);
    expect(main_window.webContents.listenerCount("context-menu")).toBeGreaterThan(0);
    main_window.flashFrame(true);
    main_window.emit("focus");
    expect(main_window.flash_frames).toEqual([true, false]);
    expect(main_window.visible).toBe(true);
    expect(main_window.focused).toBe(true);
    expect(on_closed).toHaveBeenCalledTimes(1);
  });

  it("日志窗口按浅色主题初始化并直接关闭", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    const { create_log_window_host } = await import("./desktop-window-host");
    const desktop_bundle_dir = path.join(process.cwd(), "build", "dist-electron");
    const host = create_log_window_host({
      desktopBundleDir: desktop_bundle_dir,
      backendApiBaseUrl: "http://127.0.0.1:6789",
      appVersion: "1.2.3",
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      recordHostDiagnostic: record_host_diagnostic,
    });
    const close_event = { preventDefault: vi.fn() };

    host.open();
    const log_window = get_created_window(0);
    log_window.emit("close", close_event);

    expect(log_window.options.backgroundColor).toBe(resolve_title_bar_overlay_theme("light").color);
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
    expect(log_window.webContents.listenerCount("context-menu")).toBeGreaterThan(0);
  });

  it("渲染层加载失败时记录诊断并显示原生错误提示", async () => {
    restore_env("ELECTRON_RENDERER_URL", undefined);
    const { create_main_window } = await import("./desktop-window-host");

    create_main_window({
      desktopBundleDir: path.join(process.cwd(), "build", "dist-electron"),
      backendApiBaseUrl: "http://127.0.0.1:4567",
      appVersion: "1.2.3",
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      recordHostDiagnostic: record_host_diagnostic,
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

    expect(record_host_diagnostic).toHaveBeenCalledWith({
      level: "error",
      messageKey: "app.diagnostic.renderer.main_frame_load_failed",
      context: {
        error_code: -102,
        error_description: "连接被拒绝",
        validated_url: "http://127.0.0.1:5173/",
      },
    });
    expect(electron_mock.show_error_box).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("http://127.0.0.1:5173/"),
    );
    expect(record_host_diagnostic).toHaveBeenCalledWith({
      level: "warning",
      messageKey: "app.diagnostic.renderer.subframe_load_failed",
      context: {
        error_code: -3,
        error_description: "子框架中断",
        validated_url: "https://asset.test",
      },
    });
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
      backendApiBaseUrl: "http://127.0.0.1:4567",
      appVersion: "1.2.3",
      rendererDiagnostics: renderer_diagnostics,
      recordHostDiagnostic: record_host_diagnostic,
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
    expect(record_host_diagnostic).toHaveBeenCalledWith({
      level: "error",
      messageKey: "app.diagnostic.renderer.process_exited",
      context: {
        windowKind: "main",
        rendererDiagnostics: {
          route: "workbench",
        },
      },
    });
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
      backendApiBaseUrl: "http://127.0.0.1:4567",
      appVersion: "1.2.3",
      rendererDiagnostics: create_renderer_diagnostics_stub(),
      recordHostDiagnostic: record_host_diagnostic,
      shouldBypassCloseConfirmation: () => true,
      onClosed: vi.fn(),
    });
    const main_window = get_created_window(0);
    const shortcut_event = { preventDefault: vi.fn() };

    main_window.webContents.emit("before-input-event", shortcut_event, {
      type: "keyDown",
      key: "F12",
    });

    expect(electron_mock.append_switch).toHaveBeenCalledWith(
      "remote-debugging-port",
      expect.any(String),
    );
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

/**
 * 恢复用例前的环境变量，防止动态导入读取到前一场景的配置。
 */
function restore_env(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/**
 * 获取指定次序创建的窗口，缺失时让用例立即失败。
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

/**
 * 提供诊断快照，供宿主崩溃与无响应事件消费。
 */
function create_renderer_diagnostics_stub(
  options: {
    processGoneContext?: Record<string, unknown>;
  } = {},
): RendererProcessDiagnosticsRegistry {
  return {
    registerWindow: vi.fn(),
    recordRendererDiagnostics: vi.fn(),
    buildRendererProcessGoneContext: vi.fn(() => options.processGoneContext ?? {}),
    buildWindowUnresponsiveContext: vi.fn(() => ({})),
  };
}
