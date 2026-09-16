import { app, BrowserWindow, session, shell } from "electron";
import path from "node:path";

import * as AppErrors from "../shared/error";
import type { BackendRuntimeReady } from "../shared/backend-runtime";
import { register_desktop_ipc_handlers } from "./shell/desktop-ipc-host";
import { pick_save_path } from "./shell/path-dialog";
import {
  configure_development_remote_debugging,
  configure_renderer_public_path,
  create_log_window_host,
  create_main_window,
} from "./shell/desktop-window-host";
import { type LogWindowHost } from "./shell/log-window-host";
import { install_main_fatal_error_handler } from "./shell/main-fatal-error-handler";
import { try_show_native_error_dialog } from "./shell/native-error-dialog";
import {
  configure_renderer_crash_reporting,
  create_renderer_process_diagnostics_registry,
} from "./shell/renderer-process-diagnostics";
import { DesktopUpdateService } from "./shell/desktop-update-service";
import { BackendRuntimeClient } from "./runtime/backend-runtime-client";

export interface GuiEntryOptions {
  desktopBundleDir: string; // 产品入口解析出的桌面 bundle 根目录
  backendRuntimeWorkerEntryUrl: URL;
}

/**
 * 启动 Electron GUI 入口；模块导入本身不注册 Electron 事件，便于顶层 index 分发 CLI。
 */
export function run_gui_entry(options: GuiEntryOptions): void {
  const desktop_bundle_dir = options.desktopBundleDir;
  configure_renderer_public_path(desktop_bundle_dir);
  configure_development_remote_debugging();
  configure_renderer_crash_reporting();
  const renderer_process_diagnostics = create_renderer_process_diagnostics_registry();
  // main 持有 renderer 黑匣子，覆盖原生崩溃时 HTTP 诊断来不及发出的场景

  let win: BrowserWindow | null = null; // 主窗口是桌面宿主的唯一工作台窗口，关闭后引用必须归零，避免 IPC 误用失效窗口
  let log_window_host: LogWindowHost | null = null; // 日志窗口由独立宿主管理，避免主窗口生命周期和日志诊断窗口互相持有复杂状态
  let backend_ready: BackendRuntimeReady | null = null; // main 持有固定启动快照，首次创建与重建窗口共用
  let desktop_update_service: DesktopUpdateService | null = null; // 更新下载和启动副作用只在 main 的单一服务入口执行
  let is_app_shutdown_in_progress = false; // 退出流程只允许进入一次，防止 before-quit、fatal 和窗口关闭同时触发重复清理
  let is_renderer_confirmed_app_quit = false; // renderer 已确认退出时，主窗口 close 事件不再反向弹出网页确认流程

  /**
   * 原生目录打开失败沿宿主通道回传。
   */
  async function open_directory(path: string): Promise<void> {
    const error_message = await shell.openPath(path);
    if (error_message !== "") {
      throw new AppErrors.AppError("file.io_failed", {
        diagnostic_context: { path, reason: error_message },
      });
    }
  }

  const app_root = app.isPackaged ? path.dirname(process.execPath) : process.cwd();
  const builtin_root = path.join(app.getAppPath(), "builtin"); // app.asar 内当前版本只读资产根
  const agent_workspace_runtime = resolve_agent_workspace_runtime_bootstrap_path({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: process.cwd(),
  });
  const backend_runtime = new BackendRuntimeClient({
    workerEntryUrl: options.backendRuntimeWorkerEntryUrl,
    appRoot: app_root,
    builtinRoot: builtin_root,
    agentWorkspaceRuntimeBootstrapPath: agent_workspace_runtime,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    openDirectory: open_directory,
    pickSavePath: async (default_name) => {
      const result = await pick_save_path(win, null, default_name, []);
      return result.canceled ? null : (result.paths[0] ?? null);
    },
    onUnexpectedExit: (error) => {
      try_show_native_error_dialog("LinguaGacha 后端异常退出", error.message);
      void quit_app_after_backend_shutdown(1);
    },
  });
  // 窗口诊断失败不能形成新的 unhandled rejection；fatal 路径另行等待并兜底 stderr。
  const record_host_diagnostic: BackendRuntimeClient["recordHostDiagnostic"] = async (args) => {
    try {
      await backend_runtime.recordHostDiagnostic(args);
    } catch (error) {
      try {
        process.stderr.write(
          `[diagnostic] ${error instanceof Error ? error.message : String(error)}\n`,
        );
      } catch {
        // 诊断通道与 stderr 同时不可用时没有剩余安全出口，窗口业务仍继续。
      }
    }
  };

  /**
   * 窗口在 Backend ready 后创建，API 地址与版本共用该启动快照。
   */
  function require_backend_ready(): BackendRuntimeReady {
    if (backend_ready === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "backend_runtime_not_ready" },
      });
    }

    return backend_ready;
  }

  /**
   * 创建主工作台窗口，并把窗口关闭后的跨宿主联动留在入口层。
   */
  function create_main_window_for_runtime(): void {
    const ready = require_backend_ready();
    win = create_main_window({
      desktopBundleDir: desktop_bundle_dir,
      backendApiBaseUrl: ready.apiBaseUrl,
      appVersion: ready.appVersion,
      rendererDiagnostics: renderer_process_diagnostics,
      shouldBypassCloseConfirmation: () => {
        return is_app_shutdown_in_progress || is_renderer_confirmed_app_quit;
      },
      onClosed: () => {
        win = null;
        log_window_host?.close();
      },
      recordHostDiagnostic: record_host_diagnostic,
    });
  }

  /**
   * 注册 renderer 可调用的桌面宿主桥接能力。
   */
  function register_runtime_ipc_handlers(): void {
    if (desktop_update_service === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "desktop_update_service_not_ready" },
      });
    }

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
      quitAfterBackendShutdown: quit_app_after_backend_shutdown,
      recordRendererDiagnostics: renderer_process_diagnostics.recordRendererDiagnostics,
      readAppLanguage: () => backend_runtime.readAppLanguage(),
      updateService: desktop_update_service,
    });
  }

  /**
   * 退出前先关闭 Backend，确保 Gateway、ProjectDatabase 和日志系统按顺序收尾。
   */
  async function quit_app_after_backend_shutdown(exit_code: number): Promise<void> {
    if (is_app_shutdown_in_progress) {
      return;
    }

    is_app_shutdown_in_progress = true;
    try {
      await backend_runtime.stop();
    } finally {
      app.exit(exit_code);
    }
  }

  install_main_fatal_error_handler({
    isAppShutdownInProgress: () => is_app_shutdown_in_progress,
    quitAfterBackendShutdown: quit_app_after_backend_shutdown,
    getBackendRuntimeClient: () => backend_runtime,
  });

  // 所有窗口关闭时进入应用退出；日志窗口也要一起收掉，避免诊断窗口单独存活。
  app.on("window-all-closed", () => {
    win = null;
    log_window_host?.close();
    app.quit();
  });

  // Electron 原生退出前拦截一次，用统一 Backend 收尾路径替代直接退出。
  app.on("before-quit", (event) => {
    if (backend_runtime.isStopped()) {
      return;
    }

    event.preventDefault();
    void quit_app_after_backend_shutdown(0);
  });

  // Electron ready 后才能启动 Backend 和创建窗口，保证 app API 与原生资源都已可用。
  app.whenReady().then(async () => {
    try {
      const backend_start_result = await backend_runtime.start();
      backend_ready = backend_start_result;
      desktop_update_service = new DesktopUpdateService({
        appRoot: app_root,
        updateRootDir: backend_start_result.berserkerUpdateRootDir,
        // 更新包必须复用默认 session 的 Chromium 网络栈，不能回退到 Node fetch。
        runtime: {
          fetch: (url, init) => session.defaultSession.fetch(url, init),
        },
      });
      await desktop_update_service.cleanup_berserker_version_dirs();
      log_window_host = create_log_window_host({
        desktopBundleDir: desktop_bundle_dir,
        backendApiBaseUrl: backend_start_result.apiBaseUrl,
        appVersion: backend_start_result.appVersion,
        rendererDiagnostics: renderer_process_diagnostics,
        recordHostDiagnostic: record_host_diagnostic,
      });
      register_runtime_ipc_handlers();
      // Backend、更新器和 IPC 完整就绪后才允许 macOS Dock 恢复窗口。
      app.on("activate", () => {
        if (!is_app_shutdown_in_progress && BrowserWindow.getAllWindows().length === 0) {
          create_main_window_for_runtime();
        }
      });
      create_main_window_for_runtime();
    } catch (error) {
      try {
        if (backend_ready === null) {
          process.stderr.write(
            `[startup] ${error instanceof Error ? error.message : String(error)}\n`,
          );
        } else {
          await backend_runtime.recordHostDiagnostic({
            level: "error",
            messageKey: "app.diagnostic.lifecycle.app_start_failed",
            error,
          });
        }
      } catch (diagnostic_error) {
        try {
          process.stderr.write(
            `[startup] ${diagnostic_error instanceof Error ? diagnostic_error.message : String(diagnostic_error)}\n`,
          );
        } catch {
          // 启动失败已进入退出路径，stderr 不可用时也必须继续关闭 Backend。
        }
      }
      try {
        const message = error instanceof Error ? error.message : "Backend 启动失败。";
        try_show_native_error_dialog("LinguaGacha 启动失败", message);
      } finally {
        await quit_app_after_backend_shutdown(1);
      }
    }
  });
}

/** 预加载模块与 npm 依赖共用部署目录，extraResources 完整复制当前应用版本的运行环境。 */
export function resolve_agent_workspace_runtime_bootstrap_path(args: {
  packaged: boolean;
  resourcesPath: string;
  projectRoot: string;
}): string {
  const root = args.packaged ? args.resourcesPath : path.join(args.projectRoot, "resources");
  return path.join(root, "workspace", "bootstrap.mjs");
}
