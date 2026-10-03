import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { promisify } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import { createServer } from "vite";
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

// 生产样式通过 WM_NCHITTEST 验证窗口拖动与裁剪边界。
it.skipIf(process.platform !== "win32")(
  "滚动内容不侵占标题栏，控件与浮层保留原生交互区域",
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-drag-"));
    const server = await createServer({
      configFile: false,
      appType: "custom",
      root: process.cwd(),
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [tailwindcss()],
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, watch: null },
    });
    try {
      server.middlewares.use("/__drag_probe", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(`
        <style>
          .probe-scroll { margin-left:250px; height:400px; overflow:auto }
          .probe-spacer { height:150px }
          .probe-tail { height:1500px }
          #scroll-control { display:block; width:100%; height:32px }
          #floating { position:fixed; width:200px; height:30px }
        </style>
        <header class="shell-topbar"><div></div><div class="topbar__content">
          <button class="topbar__menu-button">Menu</button><span>App</span>
        </div><div></div></header>
        <section class="probe-scroll"><div class="probe-spacer"></div>
          <button id="scroll-control">Content</button>
          <div class="probe-tail"></div>
        </section>
        <script type="module">
          import '/src/frontend/index.css';
          import '/src/frontend/app/shell/app-titlebar.css';
          import { APP_MENU_POSITIONER_CLASS_NAME } from '/src/frontend/widgets/app-menu.ts';
          window.menuClass = APP_MENU_POSITIONER_CLASS_NAME;
        </script>
      `);
      });
      await server.listen();
      const url = `${server.resolvedUrls!.local[0]}__drag_probe`;
      // 将 CSS 采样点换算到物理屏幕坐标，查询本测试窗口的原生命中。
      await fs.writeFile(
        path.join(directory, "hit.ps1"),
        String.raw`
param([long]$WindowHandle, [double]$Scale, [string]$Points)
Add-Type @"
using System;
using System.Runtime.InteropServices;
// Win32 消息绑定与坐标转换共用同一物理像素坐标系。
public class WindowHit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window,ref POINT point);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
"@
[WindowHit]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$window = [IntPtr]$WindowHandle
$results = foreach ($sample in ($Points | ConvertFrom-Json)) {
  $point = New-Object WindowHit+POINT
  $point.X = [int]($sample.x * $Scale)
  $point.Y = [int]($sample.y * $Scale)
  [WindowHit]::ClientToScreen($window, [ref]$point) | Out-Null
  $position = ($point.Y -shl 16) -bor ($point.X -band 65535)
  [WindowHit]::SendMessage($window, 0x84, [IntPtr]::Zero, [IntPtr]$position).ToInt64()
}
ConvertTo-Json -Compress -InputObject @($results)
`,
      );
      await fs.writeFile(
        path.join(directory, "main.cjs"),
        `
      const { app, BrowserWindow } = require('electron');
      const { execFile } = require('node:child_process');
      const { promisify } = require('node:util');
      const path = require('node:path');
      const assert = require('node:assert/strict');
      app.setPath('userData', path.join(__dirname, 'profile'));
      app.commandLine.appendSwitch('force-device-scale-factor', '1.25');
      const HTCLIENT = 1, HTCAPTION = 2;
      // 有界重试让 Electron 的区域更新消息先完成。
      const pause = () => new Promise(resolve => setTimeout(resolve, 50));
      (async () => {
        await app.whenReady();
        const win = new BrowserWindow({
          show:false, width:1000, height:650, titleBarStyle:'hidden',
          titleBarOverlay:{height:40,color:'#eeeeee',symbolColor:'#000000'},
          webPreferences:{backgroundThrottling:false}
        });
        // 布局观测与交互只发生在独立测试窗口。
        const evaluate = code => win.webContents.executeJavaScript(code);
        await win.loadURL(${JSON.stringify(url)});
        const scale = await evaluate('devicePixelRatio');
        const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
        // 采样点跟随实际布局，按钮尺寸与标题栏高度可以自由调整。
        const points = await evaluate(\`(() => {
          const bar = document.querySelector('.shell-topbar').getBoundingClientRect();
          const button = document.querySelector('.topbar__menu-button').getBoundingClientRect();
          const content = document.querySelector('.probe-scroll').getBoundingClientRect();
          const y = bar.y + bar.height / 2;
          return window.probePoints = [
            {x:button.x + button.width / 2, y},
            {x:(button.right + content.left) / 2, y},
            {x:content.x + content.width / 2, y}
          ];
        })()\`);
        // 同时核对按钮、标题栏左侧与内容上方三个原生命中区域。
        async function check(label, expected) {
          // 原生区域通过异步消息更新，等待有界的最终命中结果。
          const deadline = Date.now() + 5000;
          let actual;
          do {
            const result = await promisify(execFile)('pwsh', [
              '-NoProfile','-File',path.join(__dirname,'hit.ps1'),handle,String(scale),JSON.stringify(points)
            ], {windowsHide:true, timeout:10000});
            actual = JSON.parse(result.stdout);
            if (JSON.stringify(actual) === JSON.stringify(expected)) return;
            await pause();
          } while (Date.now() < deadline);
          assert.deepEqual(actual, expected, label);
        }
        const normal = [HTCLIENT, HTCAPTION, HTCAPTION];
        await check('initial titlebar and button', normal);
        // 将普通按钮完整滚出视口，并让其未裁剪矩形覆盖标题栏采样点。
        await evaluate(\`(() => {
          const scroll = document.querySelector('.probe-scroll');
          const button = document.getElementById('scroll-control').getBoundingClientRect();
          const bar = document.querySelector('.shell-topbar').getBoundingClientRect();
          scroll.scrollTop += button.top - bar.top - (bar.height - button.height) / 2;
        })()\`);
        assert.equal(await evaluate('document.getElementById("scroll-control").getBoundingClientRect().bottom <= document.querySelector(".probe-scroll").getBoundingClientRect().top'), true);
        await check('clipped scrolling button', normal);
        await evaluate(\`
          const floating = document.createElement('div');
          floating.id = 'floating';
          floating.className = window.menuClass;
          document.body.append(floating);
          floating.style.left = (window.probePoints[2].x - floating.offsetWidth / 2) + 'px';
          floating.style.top = (window.probePoints[2].y - floating.offsetHeight / 2) + 'px';
        \`);
        await check('menu over titlebar', [HTCLIENT, HTCAPTION, HTCLIENT]);
        await evaluate('document.getElementById("floating").remove()');
        await check('menu closed', normal);
        await evaluate('const backdrop=document.createElement("div"); backdrop.className="cn-progress-toast-modal-layer"; document.body.append(backdrop)');
        await check('blocking backdrop', [HTCLIENT, HTCLIENT, HTCLIENT]);
        await evaluate('document.querySelector(".cn-progress-toast-modal-layer").remove()');
        await check('backdrop closed', normal);
        win.destroy();
        console.log('DRAG_REGIONS_OK');
        app.quit();
      })().catch(error => { console.error(error); app.exit(1); });
    `,
      );
      const electron = createRequire(import.meta.url)("electron") as string;
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
      delete env.ELECTRON_RUN_AS_NODE;
      const result = await promisify(execFile)(electron, [path.join(directory, "main.cjs")], {
        windowsHide: true,
        timeout: 60_000,
        env,
      });
      expect(result.stdout).toContain("DRAG_REGIONS_OK");
    } finally {
      await server.close();
      // 目录仅由本测试创建，退出 Electron 后回收其独立配置与探针。
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  90_000,
);
