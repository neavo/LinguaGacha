import { app, BrowserWindow, session, shell } from "electron";
import path from "node:path";

import { CoreBootstrap } from "../core/bootstrap/core-bootstrap";
import type { EngineExecution } from "../core/engine/core/engine-execution";
import { write_electron_main_error } from "../core/log/log-bridge";
import { t_main_log } from "../core/log/log-text";
import * as AppErrors from "../shared/error";
import { register_desktop_ipc_handlers } from "./shell/desktop-ipc-host";
import {
  configure_development_remote_debugging,
  configure_renderer_public_path,
  create_log_window_host,
  create_main_window,
} from "./shell/desktop-window-host";
import { type LogWindowHost } from "./shell/log-window-host";
import { install_main_fatal_error_handler } from "./shell/main-fatal-error-handler";
import { show_native_error_dialog } from "./shell/native-error-dialog";

export interface GuiEntryOptions {
  desktopBundleDir: string; // desktopBundleDir 是产品入口解析出的桌面 bundle 根目录
  engineExecution: EngineExecution; // engineExecution 是 GUI Core 任务执行模式的唯一入口契约
}

/**
 * 启动 Electron GUI 入口；模块导入本身不注册 Electron 事件，便于顶层 index 分发 CLI。
 */
export function run_gui_entry(options: GuiEntryOptions): void {
  const desktop_bundle_dir = options.desktopBundleDir;
  configure_renderer_public_path(desktop_bundle_dir);
  configure_development_remote_debugging();

  let win: BrowserWindow | null = null; // 主窗口是桌面宿主的唯一工作台窗口，关闭后引用必须归零，避免 IPC 误用失效窗口
  let log_window_host: LogWindowHost | null = null; // 日志窗口由独立宿主管理，避免主窗口生命周期和日志诊断窗口互相持有复杂状态
  let core_api_base_url: string | null = null; // Core API 地址由 Bootstrap 启动结果注入窗口，preload 不再猜测固定端口
  let is_app_shutdown_in_progress = false; // 退出流程只允许进入一次，防止 before-quit、fatal 和窗口关闭同时触发重复清理
  let is_renderer_confirmed_app_quit = false; // renderer 已确认退出时，主窗口 close 事件不再反向弹出网页确认流程

  /**
   * 输出目录只由导出成功链路触发，Electron shell 返回非空错误文本时转为异常交给文件域记录。
   */
  async function open_output_folder(output_path: string): Promise<void> {
    const error_message = await shell.openPath(output_path);
    if (error_message !== "") {
      throw new AppErrors.FileIoFailedError({
        diagnostic_context: { output_path, reason: error_message },
      });
    }
  }

  const core_bootstrap = new CoreBootstrap({
    appRoot: app.isPackaged ? path.dirname(process.execPath) : process.cwd(),
    exposeApiGateway: true,
    systemProxyResolver: {
      resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    },
    openOutputFolder: open_output_folder,
    engineExecution: options.engineExecution,
  });

  /**
   * 窗口只能在 Core API ready 后创建，避免 preload 暴露不可用的 API 地址。
   */
  function require_core_api_base_url(): string {
    if (core_api_base_url === null) {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "core_api_base_url_not_ready" },
      });
    }

    return core_api_base_url;
  }

  /**
   * 创建主工作台窗口，并把窗口关闭后的跨宿主联动留在入口层。
   */
  function create_main_window_for_runtime(): void {
    win = create_main_window({
      desktopBundleDir: desktop_bundle_dir,
      coreApiBaseUrl: require_core_api_base_url(),
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
  function register_runtime_ipc_handlers(read_app_language: () => unknown): void {
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
      readAppLanguage: read_app_language,
    });
  }

  /**
   * 退出前先关闭 Core，确保 Gateway、ProjectDatabase 和日志系统按顺序收尾。
   */
  async function quit_app_after_core_shutdown(exit_code: number): Promise<void> {
    if (is_app_shutdown_in_progress) {
      return;
    }

    is_app_shutdown_in_progress = true;
    try {
      await core_bootstrap.stop();
    } finally {
      app.exit(exit_code);
    }
  }

  install_main_fatal_error_handler({
    isAppShutdownInProgress: () => is_app_shutdown_in_progress,
    quitAfterCoreShutdown: quit_app_after_core_shutdown,
  });

  // 所有窗口关闭时进入应用退出；日志窗口也要一起收掉，避免诊断窗口单独存活。
  app.on("window-all-closed", () => {
    win = null;
    log_window_host?.close();
    app.quit();
  });

  // Electron 原生退出前拦截一次，用统一 Core 收尾路径替代直接退出。
  app.on("before-quit", (event) => {
    if (core_bootstrap.isStopped()) {
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
      const core_start_result = await core_bootstrap.start();
      if (core_start_result.apiBaseUrl === null) {
        throw new AppErrors.InternalInvariantError({
          diagnostic_context: { reason: "gui_core_api_not_exposed" },
        });
      }
      core_api_base_url = core_start_result.apiBaseUrl;
      log_window_host = create_log_window_host({
        desktopBundleDir: desktop_bundle_dir,
        coreApiBaseUrl: core_start_result.apiBaseUrl,
      });
      register_runtime_ipc_handlers(core_start_result.readAppLanguage);
      create_main_window_for_runtime();
    } catch (error) {
      write_electron_main_error(t_main_log("app.diagnostic.lifecycle.app_start_failed"), { error });
      const message = error instanceof Error ? error.message : "Core 启动失败。";
      show_native_error_dialog("LinguaGacha 启动失败", message);
      app.exit(1);
    }
  });
}
