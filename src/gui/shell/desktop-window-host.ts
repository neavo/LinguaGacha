import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  type BrowserWindowConstructorOptions,
} from "electron";
import path from "node:path";

import { build_core_api_base_url_argument } from "../../core/api/core-api-endpoint";
import { IPC_CHANNEL_WINDOW_CLOSE_REQUEST } from "../ipc/ipc-contract";
import { resolve_title_bar_overlay_theme, uses_title_bar_overlay } from "./shell-contract";
import { type DesktopPlatform, type ThemeMode } from "../bridge/bridge-types";
import { LOG_WINDOW_QUERY_KEY, LOG_WINDOW_QUERY_VALUE, LogWindowHost } from "./log-window-host";
import { write_electron_main_error, write_electron_main_warning } from "../../core/log/log-bridge";
import { t_main_log } from "../../core/log/log-text";

const WINDOW_STANDARD_WIDTH = 1280; // 与旧桌面版 AppFluentWindow 对齐，后续 Electron UI 也以 1280 x 800 作为标准开发基线
const WINDOW_STANDARD_HEIGHT = 800;
const WINDOW_BACKGROUND_COLOR = "#F8FAFC"; // 主窗口背景要早于 renderer 首帧生效，避免加载阶段出现默认白屏或暗色闪烁
const DEVTOOLS_TOGGLE_KEY = "F12"; // 主窗口隐藏菜单栏后，开发态仍保留显式快捷键作为 DevTools 唯一稳定入口
const DEVTOOLS_TOGGLE_WITH_MODIFIER_KEY = "i";
const DEVTOOLS_INSPECT_WITH_MODIFIER_KEY = "c";
const PRELOAD_ENTRY_FILE_NAME = "preload.mjs"; // preload 产物名必须与 electron-vite 开发态和发布态输出一致，否则 window.desktopApp 不会注入
const DEVTOOLS_ENTER_INSPECT_MODE_SCRIPT = `
(() => {
  const devtools_api = window.DevToolsAPI

  if (devtools_api && typeof devtools_api.enterInspectElementMode === 'function') {
    devtools_api.enterInspectElementMode()
    return true
  } else {
    return false
  }
})()
`; // Chromium 的 inspect element 能力只暴露在 DevTools 前端里，需要注入脚本间接触发

const RENDERER_DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"] ?? null; // electron-vite 在开发态通过 ELECTRON_RENDERER_URL 暴露唯一权威的 renderer dev server 地址

export type MainWindowHostOptions = {
  desktopBundleDir: string;
  coreApiBaseUrl: string;
  shouldBypassCloseConfirmation: () => boolean;
  onClosed: () => void;
};

export type LogWindowHostFactoryOptions = {
  desktopBundleDir: string;
  coreApiBaseUrl: string;
};

/**
 * 开发态暴露 Chromium 调试端口，方便 Playwright 直接附着现有 Electron 实例
 */
export function configure_development_remote_debugging(): void {
  if (is_development_mode()) {
    app.commandLine.appendSwitch("remote-debugging-port", "9222");
  }
}

/**
 * 配置窗口静态资源根目录，让开发态和发布态复用同一套窗口配置
 */
export function configure_renderer_public_path(desktop_bundle_dir: string): void {
  process.env.VITE_PUBLIC = is_development_mode()
    ? path.join(process.cwd(), "public")
    : resolve_renderer_dist(desktop_bundle_dir);
}

/**
 * 创建日志窗口宿主，并把窗口事件、DevTools 和日志页面 query 注入进去
 */
export function create_log_window_host(options: LogWindowHostFactoryOptions): LogWindowHost {
  return new LogWindowHost({
    createWindowOptions: () => {
      return create_window_options(options.desktopBundleDir, options.coreApiBaseUrl);
    },
    registerWindow: (target_window) => {
      register_development_devtools_shortcut(target_window);
      register_window_runtime_events(target_window, {
        confirmOnClose: false,
        shouldBypassCloseConfirmation: () => true,
      });
    },
    loadTarget: (target_window) => {
      load_renderer_entry(target_window, options.desktopBundleDir, {
        [LOG_WINDOW_QUERY_KEY]: LOG_WINDOW_QUERY_VALUE,
      });
    },
  });
}

/**
 * 创建主工作台窗口，并把启动加载、关闭确认和运行期保护事件都挂到同一处
 */
export function create_main_window(options: MainWindowHostOptions): BrowserWindow {
  const main_window = new BrowserWindow(
    create_window_options(options.desktopBundleDir, options.coreApiBaseUrl),
  );
  register_development_devtools_shortcut(main_window);
  register_window_runtime_events(main_window, {
    confirmOnClose: true,
    shouldBypassCloseConfirmation: options.shouldBypassCloseConfirmation,
  });

  main_window.on("closed", () => {
    // 主窗口关闭后的跨窗口联动由 gui-entry.ts 注入，避免本模块反向持有日志窗口状态
    options.onClosed();
  });

  main_window.once("ready-to-show", () => {
    // 发布态等待首帧后显示，减少启动阶段的空白窗口感
    main_window.show();
  });

  if (is_development_mode()) {
    show_window_if_hidden(main_window); // 开发态优先让窗口可见，这样就算首屏挂掉也能直接看到错误弹窗和 DevTools
  }
  load_renderer_entry(main_window, options.desktopBundleDir);

  return main_window;
}

/**
 * 同步 renderer 主题到原生标题栏；不支持 Overlay 的平台保持自己的窗口策略
 */
export function sync_title_bar_overlay(
  target_window: BrowserWindow | null,
  theme_mode: ThemeMode,
): void {
  if (target_window === null) {
    return;
  }
  if (!uses_title_bar_overlay(process.platform as DesktopPlatform)) {
    return;
  }

  target_window.setTitleBarOverlay(build_title_bar_overlay(theme_mode));
}

/**
 * 判断当前是否由 renderer dev server 驱动，用来收口开发态专属能力
 */
function is_development_mode(): boolean {
  let development_mode = false;

  if (RENDERER_DEV_SERVER_URL) {
    development_mode = true;
  } else {
    development_mode = false;
  }

  return development_mode;
}

/**
 * 桌面 bundle 根只用于定位同层 renderer 产物，不承载应用 APP_ROOT 语义
 */
function resolve_desktop_bundle_root(desktop_bundle_dir: string): string {
  return path.join(desktop_bundle_dir, "..");
}

/**
 * 发布态固定加载 build/dist，开发态由 dev server 接管页面入口
 */
function resolve_renderer_dist(desktop_bundle_dir: string): string {
  return path.join(resolve_desktop_bundle_root(desktop_bundle_dir), "dist");
}

/**
 * 识别打开 / 关闭 DevTools 的开发态快捷键
 */
function is_devtools_shortcut(input: Electron.Input): boolean {
  const is_function_shortcut = input.type === "keyDown" && input.key === DEVTOOLS_TOGGLE_KEY;
  const is_modifier_shortcut =
    input.type === "keyDown" &&
    input.key.toLowerCase() === DEVTOOLS_TOGGLE_WITH_MODIFIER_KEY &&
    input.shift &&
    (input.control || input.meta);
  let devtools_shortcut = false;

  if (is_function_shortcut || is_modifier_shortcut) {
    devtools_shortcut = true;
  } else {
    devtools_shortcut = false;
  }

  return devtools_shortcut;
}

/**
 * 识别进入元素检查模式的开发态快捷键
 */
function is_devtools_inspect_shortcut(input: Electron.Input): boolean {
  const inspect_shortcut =
    input.type === "keyDown" &&
    input.key.toLowerCase() === DEVTOOLS_INSPECT_WITH_MODIFIER_KEY &&
    input.shift &&
    (input.control || input.meta);

  return inspect_shortcut;
}

/**
 * 等待 DevTools 前端真正加载完毕，确保后续能调用 Chromium 暴露的调试 API
 */
async function wait_for_devtools_contents(
  target_window: BrowserWindow,
): Promise<Electron.WebContents | null> {
  const current_devtools_contents = target_window.webContents.devToolsWebContents;

  if (current_devtools_contents !== null) {
    if (current_devtools_contents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        current_devtools_contents.once("did-finish-load", () => {
          resolve();
        });
      });
    }
  } else {
    await new Promise<void>((resolve) => {
      target_window.webContents.once("devtools-opened", () => {
        resolve();
      });
      target_window.webContents.openDevTools();
    });
  }

  const ready_devtools_contents = target_window.webContents.devToolsWebContents;

  if (ready_devtools_contents !== null) {
    if (ready_devtools_contents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        ready_devtools_contents.once("did-finish-load", () => {
          resolve();
        });
      });
    }
  }

  return ready_devtools_contents;
}

/**
 * 打开 DevTools 并切换元素检查模式，给无菜单栏窗口补足开发期调试入口
 */
async function open_devtools_and_toggle_inspect_mode(target_window: BrowserWindow): Promise<void> {
  const devtools_contents = await wait_for_devtools_contents(target_window);

  if (devtools_contents !== null) {
    try {
      // 直接调用 Chromium DevTools 前端提供的 API，复用浏览器自己的元素定位切换逻辑
      await devtools_contents.executeJavaScript(DEVTOOLS_ENTER_INSPECT_MODE_SCRIPT, true);
    } catch (error) {
      void error;
    }
  }
}

/**
 * 只在开发态注册 DevTools 快捷键，发布态不暴露额外调试入口
 */
function register_development_devtools_shortcut(target_window: BrowserWindow): void {
  if (is_development_mode()) {
    // 开发态窗口隐藏了菜单栏，需要显式补一个 DevTools 入口，避免调试能力只能靠默认菜单兜底
    target_window.webContents.on("before-input-event", (event, input) => {
      if (is_devtools_shortcut(input)) {
        event.preventDefault();
        target_window.webContents.toggleDevTools();
      } else if (is_devtools_inspect_shortcut(input)) {
        event.preventDefault();
        void open_devtools_and_toggle_inspect_mode(target_window);
      }
    });
  }
}

/**
 * 统一把窗口带回前台，供加载失败、失去响应和关闭确认等异常路径复用
 */
function show_window_if_hidden(target_window: BrowserWindow): void {
  if (target_window.isVisible()) {
    target_window.focus();
  } else {
    target_window.show();
    target_window.focus();
  }
}

/**
 * 注册窗口运行期保护事件，把关闭确认、加载失败和渲染进程异常都收口到主进程
 */
function register_window_runtime_events(
  target_window: BrowserWindow,
  options: { confirmOnClose: boolean; shouldBypassCloseConfirmation: () => boolean },
): void {
  target_window.on("close", (event) => {
    // 日志窗口和退出中的应用不能进入主窗口的网页关闭确认流程
    if (!options.confirmOnClose) {
      return;
    }
    if (options.shouldBypassCloseConfirmation()) {
      return;
    }
    if (target_window.webContents.isLoadingMainFrame()) {
      return;
    }

    // 主窗口关闭由 renderer 展示确认 UI，避免原生弹窗和网页壳层出现两套体验
    event.preventDefault();
    show_window_if_hidden(target_window);
    target_window.webContents.send(IPC_CHANNEL_WINDOW_CLOSE_REQUEST);
  });

  target_window.webContents.on(
    "did-fail-load",
    (_event, error_code, error_description, validated_url, is_main_frame) => {
      const error_message = `加载失败 (${error_code.toString()}): ${error_description}`;

      if (is_main_frame) {
        write_electron_main_error(t_main_log("app.diagnostic.renderer.main_frame_load_failed"), {
          // 主框架失败意味着整个 renderer 不可用，main 只负责记录并弹出原生诊断提示
          context: {
            error_code,
            error_description,
            validated_url,
          },
        });
        show_window_if_hidden(target_window);
        dialog.showErrorBox(
          "LinguaGacha 渲染层加载失败",
          `渲染层入口没有成功加载。\n目标地址：${validated_url}\n错误信息：${error_message}`,
        );
      } else {
        write_electron_main_warning(t_main_log("app.diagnostic.renderer.subframe_load_failed"), {
          // 子框架失败不替换页面，先写入日志，避免误伤仍可交互的主应用
          context: {
            error_code,
            error_description,
            validated_url,
          },
        });
      }
    },
  );

  target_window.webContents.on("render-process-gone", (_event, details) => {
    write_electron_main_error(t_main_log("app.diagnostic.renderer.process_exited"), {
      // 渲染进程退出后保持窗口可见，方便用户和开发者看到当前故障状态
      context: details as unknown as Record<string, unknown>,
    });
    show_window_if_hidden(target_window);
  });

  target_window.on("unresponsive", () => {
    write_electron_main_error(t_main_log("app.diagnostic.renderer.window_unresponsive")); // 失去响应时不自动重载，先记录并拉前台，避免破坏用户尚未保存的页面状态
    show_window_if_hidden(target_window);
  });
}

/**
 * 根据当前主题生成原生标题栏 Overlay 配色，保证系统按钮和网页壳层视觉一致
 */
function build_title_bar_overlay(theme_mode: ThemeMode): Electron.TitleBarOverlay {
  return resolve_title_bar_overlay_theme(theme_mode);
}

/**
 * 加载同一份 renderer 入口；日志窗口通过 query 进入独立页面模式
 */
function load_renderer_entry(
  target_window: BrowserWindow,
  desktop_bundle_dir: string,
  query?: Record<string, string>,
): void {
  if (RENDERER_DEV_SERVER_URL) {
    const target_url = new URL(RENDERER_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      target_url.searchParams.set(key, value);
    }
    void target_window.loadURL(target_url.toString());
  } else {
    void target_window.loadFile(
      path.join(resolve_renderer_dist(desktop_bundle_dir), "index.html"),
      {
        query,
      },
    );
  }
}

/**
 * 创建所有窗口共享的原生能力配置，避免主窗口和日志窗口出现壳层策略分叉
 */
function create_window_options(
  desktop_bundle_dir: string,
  core_api_base_url: string,
): BrowserWindowConstructorOptions {
  const vite_public = process.env.VITE_PUBLIC ?? resolve_renderer_dist(desktop_bundle_dir);
  const window_options: BrowserWindowConstructorOptions = {
    title: "LinguaGacha",
    width: WINDOW_STANDARD_WIDTH,
    height: WINDOW_STANDARD_HEIGHT,
    minWidth: WINDOW_STANDARD_WIDTH,
    minHeight: WINDOW_STANDARD_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    autoHideMenuBar: true,
    icon: path.join(vite_public, "icon.png"),
    webPreferences: {
      preload: path.join(desktop_bundle_dir, PRELOAD_ENTRY_FILE_NAME),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [build_core_api_base_url_argument(core_api_base_url)],
      sandbox: false, // electron-vite 产出的预加载脚本默认是 ESM，关闭 sandbox 才能让 Electron 按模块语义正确执行
    },
  };

  if (process.platform === "darwin") {
    // macOS 优先沿用系统原生 inset 布局，避免网页壳层再额外模拟右侧镜像留白
    window_options.titleBarStyle = "hiddenInset";
  } else if (uses_title_bar_overlay(process.platform as DesktopPlatform)) {
    // Windows 和 Linux 通过 Overlay 把原生控制按钮保留下来，避免沦为纯网页外壳
    window_options.titleBarStyle = "hidden";
    window_options.titleBarOverlay = build_title_bar_overlay(
      nativeTheme.shouldUseDarkColors ? "dark" : "light",
    );
  } else {
    // 未知平台兜底为真正无边框，至少保证自定义壳层策略仍然成立
    window_options.frame = false;
  }

  return window_options;
}
