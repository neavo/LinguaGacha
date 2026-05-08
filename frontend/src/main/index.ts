import { app, BrowserWindow, dialog } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { register_desktop_ipc_handlers } from "./handler/ipc-handler";
import {
  configure_development_remote_debugging,
  configure_renderer_public_path,
  create_log_window_host,
  create_main_window,
} from "./handler/window-handler";
import { CoreLifecycleManager } from "./lifecycle/lifecycle-manager";
import { type LogWindowHost } from "./log/log-window-host";
import { write_electron_main_error } from "./log/log-bridge";

// Electron ESM 入口没有 CommonJS 的 __dirname，这里只用于定位已构建的前端资源。
const desktop_bundle_dir = path.dirname(fileURLToPath(import.meta.url));

configure_renderer_public_path(desktop_bundle_dir);
configure_development_remote_debugging();

// 主窗口是桌面宿主的唯一工作台窗口，关闭后引用必须归零，避免 IPC 误用失效窗口。
let win: BrowserWindow | null = null;
// 日志窗口由独立宿主管理，避免主窗口生命周期和日志诊断窗口互相持有复杂状态。
let log_window_host: LogWindowHost | null = null;
// 退出流程只允许进入一次，防止 before-quit、Core 异常和窗口关闭同时触发重复清理。
let is_app_shutdown_in_progress = false;
// renderer 已确认退出时，主窗口 close 事件不再反向弹出网页确认流程。
let is_renderer_confirmed_app_quit = false;

// Core 生命周期必须先于 renderer 启动，保证桌面 API 暴露时公开 Gateway 已可用。
const core_lifecycle_manager = new CoreLifecycleManager({
  appRoot: app.isPackaged ? path.dirname(process.execPath) : process.cwd(),
  onUnexpectedExit: (result) => {
    // Core 意外退出后不尝试维持半可用 UI，直接走同一条退出清理路径。
    const exit_code_text = result.exitCode === null ? "null" : result.exitCode.toString();
    const signal_text = result.signal === null ? "null" : result.signal;
    dialog.showErrorBox(
      "Python Core 异常退出",
      `Python Core 已提前退出，应用将关闭。\n退出码：${exit_code_text}\n信号：${signal_text}`,
    );
    void quit_app_after_core_shutdown(1);
  },
});

/**
 * 创建主工作台窗口，并把窗口关闭后的跨宿主联动留在入口层。
 */
function create_main_window_for_runtime(): void {
  win = create_main_window({
    desktopBundleDir: desktop_bundle_dir,
    shouldBypassCloseConfirmation: () => {
      return is_app_shutdown_in_progress || is_renderer_confirmed_app_quit;
    },
    onClosed: () => {
      win = null;
      log_window_host?.close();
    },
  });
}

/**
 * 注册 renderer 可调用的桌面宿主桥接能力。
 */
function register_runtime_ipc_handlers(): void {
  register_desktop_ipc_handlers({
    getMainWindow: () => {
      return win;
    },
    getLogWindowHost: () => {
      return log_window_host;
    },
    markRendererConfirmedAppQuit: () => {
      is_renderer_confirmed_app_quit = true;
    },
  });
}

/**
 * 退出前先关闭 Core 生命周期，确保 Gateway、Database Service 和 Python 进程按顺序收尾。
 */
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

// 所有窗口关闭时进入应用退出；日志窗口也要一起收掉，避免诊断窗口单独存活。
app.on("window-all-closed", () => {
  win = null;
  log_window_host?.close();
  app.quit();
});

// Electron 原生退出前拦截一次，用统一 Core 收尾路径替代直接退出。
app.on("before-quit", (event) => {
  if (core_lifecycle_manager.isStopped()) {
    return;
  }

  event.preventDefault();
  void quit_app_after_core_shutdown(0);
});

// macOS Dock 激活事件只负责恢复工作台窗口，不应在退出流程中重新建窗。
app.on("activate", () => {
  if (!is_app_shutdown_in_progress && BrowserWindow.getAllWindows().length === 0) {
    create_main_window_for_runtime();
  }
});

// Electron ready 后才能启动 Core 和创建窗口，保证 app API 与原生资源都已可用。
app.whenReady().then(async () => {
  try {
    await core_lifecycle_manager.start();
    log_window_host = create_log_window_host({
      desktopBundleDir: desktop_bundle_dir,
    });
    register_runtime_ipc_handlers();
    create_main_window_for_runtime();
  } catch (error) {
    write_electron_main_error("LinguaGacha 启动失败", { error });
    const message = error instanceof Error ? error.message : "Python Core 启动失败。";
    dialog.showErrorBox("LinguaGacha 启动失败", message);
    app.exit(1);
  }
});
