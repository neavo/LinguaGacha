import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type BrowserWindowConstructorOptions,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  IPC_CHANNEL_OPEN_EXTERNAL_URL,
  IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY,
  IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH,
  IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH,
  IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH,
  IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SAVE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH,
  IPC_CHANNEL_TITLE_BAR_THEME,
  IPC_CHANNEL_WINDOW_CLOSE_REQUEST,
} from "../shared/ipc-channels";
import { DESKTOP_TITLE_BAR_OVERLAY_HEIGHT, uses_title_bar_overlay } from "../shared/desktop-shell";
import { type DesktopPathPickResult, type ThemeMode } from "../shared/desktop-types";
import { CoreLifecycleManager } from "./core-lifecycle/core-lifecycle-manager";
import {
  LogWindowManager,
  LOG_WINDOW_QUERY_KEY,
  LOG_WINDOW_QUERY_VALUE,
} from "./log-window-manager";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 与 PySide 版 AppFluentWindow 对齐，后续 Electron UI 也以 1280 x 800 作为标准开发基线。
const WINDOW_STANDARD_WIDTH = 1280;
const WINDOW_STANDARD_HEIGHT = 800;
const WINDOW_BACKGROUND_COLOR = "#F8FAFC";
const LIGHT_TITLE_BAR_OVERLAY_COLOR = "#FAF7F4";
const LIGHT_TITLE_BAR_SYMBOL_COLOR = "#1F2329";
const DARK_TITLE_BAR_OVERLAY_COLOR = "#121212";
const DARK_TITLE_BAR_SYMBOL_COLOR = "#EEF2F7";
const DEVTOOLS_TOGGLE_KEY = "F12";
const DEVTOOLS_TOGGLE_WITH_MODIFIER_KEY = "i";
const DEVTOOLS_INSPECT_WITH_MODIFIER_KEY = "c";
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
`;
const WINDOW_LOAD_FAILURE_TITLE = "LinguaGacha Frontend 加载失败";
const WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH = 240;
const PROJECT_FILE_FILTERS: Electron.FileFilter[] = [
  {
    name: "LinguaGacha Project",
    extensions: ["lg"],
  },
];
const GLOSSARY_IMPORT_FILE_FILTERS: Electron.FileFilter[] = [
  {
    name: "支持的数据格式 (*.json *.xlsx)",
    extensions: ["json", "xlsx"],
  },
  {
    name: "JSON 文件 (*.json)",
    extensions: ["json"],
  },
  {
    name: "Excel 文件 (*.xlsx)",
    extensions: ["xlsx"],
  },
];
const GLOSSARY_EXPORT_FILE_FILTERS: Electron.FileFilter[] = [
  {
    name: "支持的数据格式 (*.json *.xlsx)",
    extensions: ["json", "xlsx"],
  },
];
const PROMPT_FILE_FILTERS: Electron.FileFilter[] = [
  {
    name: "支持的文件 (*.txt)",
    extensions: ["txt"],
  },
];

// 前端构建产物目录结构：
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── index.js
// │ │ └── index.mjs
// │
// 这里的根目录只用于定位前端 dist/public，不承载应用 APP_ROOT 语义。
const FRONTEND_BUNDLE_ROOT = path.join(__dirname, "..");

// electron-vite 在开发态通过 ELECTRON_RENDERER_URL 暴露唯一权威的 renderer dev server 地址。
const RENDERER_DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"] ?? null;
const RENDERER_DIST = path.join(FRONTEND_BUNDLE_ROOT, "dist");

process.env.VITE_PUBLIC = RENDERER_DEV_SERVER_URL
  ? path.join(FRONTEND_BUNDLE_ROOT, "public")
  : RENDERER_DIST;
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST;

if (RENDERER_DEV_SERVER_URL) {
  // 开发态暴露 Chromium 调试端口，方便 Playwright 直接附着现有 Electron 实例。
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
}

let win: BrowserWindow | null;
let log_window_manager: LogWindowManager | null = null;
let is_app_shutdown_in_progress = false;
let is_renderer_confirmed_app_quit = false;
const core_lifecycle_manager = new CoreLifecycleManager({
  appRoot: app.isPackaged ? path.dirname(process.execPath) : process.cwd(),
  onUnexpectedExit: (result) => {
    const exit_code_text = result.exitCode === null ? "null" : result.exitCode.toString();
    const signal_text = result.signal === null ? "null" : result.signal;
    dialog.showErrorBox(
      "Python Core 异常退出",
      `Python Core 已提前退出，应用将关闭。\n退出码：${exit_code_text}\n信号：${signal_text}`,
    );
    void quit_app_after_core_shutdown(1);
  },
});

function is_development_mode(): boolean {
  let development_mode = false;

  if (RENDERER_DEV_SERVER_URL) {
    development_mode = true;
  } else {
    development_mode = false;
  }

  return development_mode;
}

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

function is_devtools_inspect_shortcut(input: Electron.Input): boolean {
  const inspect_shortcut =
    input.type === "keyDown" &&
    input.key.toLowerCase() === DEVTOOLS_INSPECT_WITH_MODIFIER_KEY &&
    input.shift &&
    (input.control || input.meta);

  return inspect_shortcut;
}

async function wait_for_devtools_frontend(
  target_window: BrowserWindow,
): Promise<Electron.WebContents | null> {
  const current_devtools_frontend = target_window.webContents.devToolsWebContents;

  if (current_devtools_frontend !== null) {
    if (current_devtools_frontend.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        current_devtools_frontend.once("did-finish-load", () => {
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

  const ready_devtools_frontend = target_window.webContents.devToolsWebContents;

  if (ready_devtools_frontend !== null) {
    if (ready_devtools_frontend.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        ready_devtools_frontend.once("did-finish-load", () => {
          resolve();
        });
      });
    }
  }

  return ready_devtools_frontend;
}

async function open_devtools_and_toggle_inspect_mode(target_window: BrowserWindow): Promise<void> {
  const devtools_frontend = await wait_for_devtools_frontend(target_window);

  if (devtools_frontend !== null) {
    try {
      // 直接调用 Chromium DevTools 前端提供的 API，复用浏览器自己的元素定位切换逻辑。
      const inspect_mode_enabled = await devtools_frontend.executeJavaScript(
        DEVTOOLS_ENTER_INSPECT_MODE_SCRIPT,
        true,
      );

      if (!inspect_mode_enabled) {
        console.warn("[frontend] DevToolsAPI.enterInspectElementMode is unavailable");
      }
    } catch (error) {
      console.warn("[frontend] failed to toggle inspect element mode", error);
    }
  }
}

function register_development_devtools_shortcut(target_window: BrowserWindow): void {
  if (is_development_mode()) {
    // 开发态窗口隐藏了菜单栏，需要显式补一个 DevTools 入口，避免调试能力只能靠默认菜单兜底。
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

function truncate_error_message(message: string): string {
  let truncated_message = message;

  if (message.length > WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH) {
    truncated_message = `${message.slice(0, WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH)}...`;
  } else {
    truncated_message = message;
  }

  return truncated_message;
}

function escape_html(raw_text: string): string {
  const escape_map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  // 保持对 ES2020 构建目标兼容，这里不用 String.prototype.replaceAll。
  return raw_text.replace(/[&<>"']/g, (character) => {
    return escape_map[character] ?? character;
  });
}

function build_window_load_failure_page(url: string, message: string): string {
  const escaped_url = escape_html(url);
  const escaped_message = escape_html(truncate_error_message(message));

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${WINDOW_LOAD_FAILURE_TITLE}</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        margin: 0;
        min-height: 100vh;
        padding: 32px 24px;
        font-family: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
        background: #f8f7f7;
        color: #282522;
      }

      main {
        max-width: 720px;
        margin: 0 auto;
      }

      h1 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.2;
      }

      p {
        margin: 0 0 16px;
        font-size: 15px;
        line-height: 1.6;
        color: #4f4943;
      }

      dl {
        margin: 0;
      }

      dt {
        margin-top: 16px;
        font-size: 13px;
        font-weight: 600;
        color: #6f6861;
      }

      dd {
        margin: 6px 0 0;
        color: #282522;
        word-break: break-word;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${WINDOW_LOAD_FAILURE_TITLE}</h1>
      <p>主进程已经启动，但渲染层入口没有成功加载。开发态下会先把窗口显示出来，避免只看到 Electron 进程却没有前台应用。</p>
      <dl>
        <div>
          <dt>目标地址</dt>
          <dd>${escaped_url}</dd>
        </div>
        <div>
          <dt>错误信息</dt>
          <dd>${escaped_message}</dd>
        </div>
      </dl>
    </main>
  </body>
</html>`;
}

function show_window_if_hidden(target_window: BrowserWindow): void {
  if (target_window.isVisible()) {
    target_window.focus();
  } else {
    target_window.show();
    target_window.focus();
  }
}

function register_window_runtime_events(
  target_window: BrowserWindow,
  options: { confirm_on_close: boolean } = { confirm_on_close: true },
): void {
  target_window.on("close", (event) => {
    if (!options.confirm_on_close) {
      return;
    }
    if (is_app_shutdown_in_progress || is_renderer_confirmed_app_quit) {
      return;
    }
    if (
      target_window.webContents.isLoadingMainFrame() ||
      target_window.webContents.getURL().startsWith("data:text/html")
    ) {
      return;
    }

    event.preventDefault();
    show_window_if_hidden(target_window);
    target_window.webContents.send(IPC_CHANNEL_WINDOW_CLOSE_REQUEST);
  });

  target_window.webContents.on(
    "did-fail-load",
    (_event, error_code, error_description, validated_url, is_main_frame) => {
      const error_message = `加载失败 (${error_code.toString()}): ${error_description}`;

      if (is_main_frame) {
        console.error("[frontend] renderer load failed", {
          error_code,
          error_description,
          validated_url,
        });
        show_window_if_hidden(target_window);
        void target_window.loadURL(
          `data:text/html;charset=UTF-8,${encodeURIComponent(build_window_load_failure_page(validated_url, error_message))}`,
        );
      } else {
        console.warn("[frontend] subframe load failed", {
          error_code,
          error_description,
          validated_url,
        });
      }
    },
  );

  target_window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[frontend] renderer process gone", details);
    show_window_if_hidden(target_window);
  });

  target_window.on("unresponsive", () => {
    console.error("[frontend] window became unresponsive");
    show_window_if_hidden(target_window);
  });
}

function build_title_bar_overlay(theme_mode: ThemeMode): Electron.TitleBarOverlay {
  if (theme_mode === "dark") {
    return {
      color: DARK_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DARK_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    };
  } else {
    return {
      color: LIGHT_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: LIGHT_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    };
  }
}

function sync_title_bar_overlay(target_window: BrowserWindow | null, theme_mode: ThemeMode): void {
  if (target_window === null) {
    return;
  }
  if (!uses_title_bar_overlay(process.platform)) {
    return;
  }

  target_window.setTitleBarOverlay(build_title_bar_overlay(theme_mode));
}

function load_renderer_entry(target_window: BrowserWindow, query?: Record<string, string>): void {
  if (RENDERER_DEV_SERVER_URL) {
    const target_url = new URL(RENDERER_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      target_url.searchParams.set(key, value);
    }
    void target_window.loadURL(target_url.toString());
  } else {
    void target_window.loadFile(path.join(RENDERER_DIST, "index.html"), {
      query,
    });
  }
}

function create_log_window_manager(): LogWindowManager {
  return new LogWindowManager({
    createWindowOptions,
    registerWindow: (target_window) => {
      register_development_devtools_shortcut(target_window);
      register_window_runtime_events(target_window, { confirm_on_close: false });
    },
    loadTarget: (target_window) => {
      load_renderer_entry(target_window, {
        [LOG_WINDOW_QUERY_KEY]: LOG_WINDOW_QUERY_VALUE,
      });
    },
  });
}

function createWindowOptions(): BrowserWindowConstructorOptions {
  // 统一在这里定义窗口能力，避免主进程别处偷偷改动窗口边框策略。
  const window_options: BrowserWindowConstructorOptions = {
    title: "LinguaGacha",
    width: WINDOW_STANDARD_WIDTH,
    height: WINDOW_STANDARD_HEIGHT,
    minWidth: WINDOW_STANDARD_WIDTH,
    minHeight: WINDOW_STANDARD_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    autoHideMenuBar: true,
    icon: path.join(VITE_PUBLIC, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite 产出的预加载脚本默认是 ESM，关闭 sandbox 才能让 Electron 按模块语义正确执行。
      sandbox: false,
    },
  };

  if (process.platform === "darwin") {
    // macOS 优先沿用系统原生 inset 布局，避免网页壳层再额外模拟右侧镜像留白。
    window_options.titleBarStyle = "hiddenInset";
  } else if (uses_title_bar_overlay(process.platform)) {
    // Windows 和 Linux 通过 Overlay 把原生控制按钮保留下来，避免沦为纯网页外壳。
    window_options.titleBarStyle = "hidden";
    window_options.titleBarOverlay = build_title_bar_overlay(
      nativeTheme.shouldUseDarkColors ? "dark" : "light",
    );
  } else {
    // 未知平台兜底为真正无边框，至少保证自定义壳层策略仍然成立。
    window_options.frame = false;
  }

  return window_options;
}

function createWindow(): void {
  win = new BrowserWindow(createWindowOptions());
  register_development_devtools_shortcut(win);
  register_window_runtime_events(win);

  win.on("closed", () => {
    win = null;
    log_window_manager?.close();
  });

  win.once("ready-to-show", () => {
    win?.show();
  });

  if (RENDERER_DEV_SERVER_URL) {
    // 开发态优先让窗口可见，这样就算首屏挂掉也能直接看到错误页和 DevTools。
    show_window_if_hidden(win);
    load_renderer_entry(win);
  } else {
    load_renderer_entry(win);
  }
}

async function pick_open_path(options: Electron.OpenDialogOptions): Promise<DesktopPathPickResult> {
  const result =
    win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
  return {
    canceled: result.canceled || result.filePaths.length === 0,
    paths: result.filePaths,
  };
}

async function pick_save_path(
  default_name: string,
  filters: Electron.FileFilter[],
): Promise<DesktopPathPickResult> {
  const dialog_options: Electron.SaveDialogOptions = {
    filters,
  };
  if (default_name !== "") {
    dialog_options.defaultPath = default_name;
  }
  const result =
    win === null
      ? await dialog.showSaveDialog(dialog_options)
      : await dialog.showSaveDialog(win, dialog_options);

  return {
    canceled: result.canceled || result.filePath === undefined,
    paths: result.filePath === undefined ? [] : [result.filePath],
  };
}

function resolve_external_url(url: string): string {
  const normalized_url = url.trim();

  if (normalized_url === "") {
    throw new Error("外部链接不能为空。");
  }

  const parsed_url = new URL(normalized_url);
  const protocol = parsed_url.protocol.toLowerCase();

  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("当前只支持通过系统浏览器打开 http 或 https 链接。");
  }

  return parsed_url.toString();
}

async function quit_app_after_core_shutdown(exit_code: number): Promise<void> {
  if (is_app_shutdown_in_progress) {
    return;
  }

  is_app_shutdown_in_progress = true;
  try {
    await core_lifecycle_manager.stop();
  } finally {
    app.exit(exit_code);
  }
}

app.on("window-all-closed", () => {
  win = null;
  log_window_manager?.close();
  app.quit();
});

app.on("before-quit", (event) => {
  if (core_lifecycle_manager.isStopped()) {
    return;
  }

  event.preventDefault();
  void quit_app_after_core_shutdown(0);
});

app.on("activate", () => {
  // macOS 上点击 Dock 图标会重新拉起窗口，这样交互才符合系统习惯。
  if (!is_app_shutdown_in_progress && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  try {
    await core_lifecycle_manager.start();
    log_window_manager = create_log_window_manager();
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Python Core 启动失败。";
    dialog.showErrorBox("LinguaGacha 启动失败", message);
    app.exit(1);
  }
});

ipcMain.on(IPC_CHANNEL_TITLE_BAR_THEME, (event, theme_mode: ThemeMode) => {
  sync_title_bar_overlay(BrowserWindow.fromWebContents(event.sender), theme_mode);
});

ipcMain.handle(IPC_CHANNEL_QUIT_APP, async () => {
  is_renderer_confirmed_app_quit = true;
  app.quit();
});

ipcMain.handle(IPC_CHANNEL_OPEN_LOG_WINDOW, async () => {
  log_window_manager?.toggle();
});

ipcMain.handle(IPC_CHANNEL_OPEN_EXTERNAL_URL, async (_event, url: string) => {
  await shell.openExternal(resolve_external_url(url));
});

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH, async () => {
  return pick_open_path({
    properties: ["openFile"],
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH, async () => {
  return pick_open_path({
    properties: ["openDirectory"],
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_FILE_PATH, async () => {
  return pick_open_path({
    properties: ["openFile"],
    filters: PROJECT_FILE_FILTERS,
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, async (_event, default_name: string) => {
  return pick_save_path(default_name, PROJECT_FILE_FILTERS);
});

ipcMain.handle(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH, async () => {
  return pick_open_path({
    properties: ["openFile", "multiSelections"],
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, async (_event, default_path?: string) => {
  return pick_open_path({
    defaultPath: typeof default_path === "string" && default_path !== "" ? default_path : undefined,
    properties: ["openDirectory", "createDirectory"],
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH, async () => {
  return pick_open_path({
    properties: ["openFile"],
    filters: GLOSSARY_IMPORT_FILE_FILTERS,
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, async (_event, default_name: string) => {
  return pick_save_path(default_name, GLOSSARY_EXPORT_FILE_FILTERS);
});

ipcMain.handle(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH, async () => {
  return pick_open_path({
    properties: ["openFile"],
    filters: PROMPT_FILE_FILTERS,
  });
});

ipcMain.handle(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH, async () => {
  return pick_save_path("", PROMPT_FILE_FILTERS);
});
