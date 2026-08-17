import { app, BrowserWindow, session, shell } from "electron";
import path from "node:path";

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
import { try_show_native_error_dialog } from "./shell/native-error-dialog";
import {
  configure_renderer_crash_reporting,
  create_renderer_process_diagnostics_registry,
} from "./shell/renderer-process-diagnostics";
import { DesktopUpdateService } from "./shell/desktop-update-service";
import { BackendRuntimeClient } from "./runtime/backend-runtime-client";
import {
  DesktopAgentWorkspaceRunner,
  register_agent_workspace_scheme,
} from "./runtime/desktop-agent-workspace-runner";

export interface GuiEntryOptions {
  desktopBundleDir: string; // 产品入口解析出的桌面 bundle 根目录
  backendRuntimeWorkerEntryUrl: URL;
  agentRelatedItemSearchWorkerEntryUrl: URL; // Electron main 拥有的相关搜索 worker 入口
}

/**
 * 启动 Electron GUI 入口；模块导入本身不注册 Electron 事件，便于顶层 index 分发 CLI。
 */
export function run_gui_entry(options: GuiEntryOptions): void {
  register_agent_workspace_scheme();
  const desktop_bundle_dir = options.desktopBundleDir;
  configure_renderer_public_path(desktop_bundle_dir);
  configure_development_remote_debugging();
  configure_renderer_crash_reporting();
  const renderer_process_diagnostics = create_renderer_process_diagnostics_registry();
  // main 持有 renderer 黑匣子，覆盖原生崩溃时 HTTP 诊断来不及发出的场景

  let win: BrowserWindow | null = null; // 主窗口是桌面宿主的唯一工作台窗口，关闭后引用必须归零，避免 IPC 误用失效窗口
  let log_window_host: LogWindowHost | null = null; // 日志窗口由独立宿主管理，避免主窗口生命周期和日志诊断窗口互相持有复杂状态
  let backend_api_base_url: string | null = null; // Backend API 地址由 Bootstrap 启动结果注入窗口，preload 不再猜测固定端口
  let desktop_update_service: DesktopUpdateService | null = null; // 更新下载和启动副作用只在 main 的单一服务入口执行
  let agent_workspace_runner: DesktopAgentWorkspaceRunner | null = null; // 模型脚本只进入独立 Chromium 沙箱
  let is_app_shutdown_in_progress = false; // 退出流程只允许进入一次，防止 before-quit、fatal 和窗口关闭同时触发重复清理
  let is_renderer_confirmed_app_quit = false; // renderer 已确认退出时，主窗口 close 事件不再反向弹出网页确认流程

  /**
   * 输出目录只由导出成功链路触发，Electron shell 返回非空错误文本时转为异常交给文件域记录。
   */
  async function open_output_folder(output_path: string): Promise<void> {
    const error_message = await shell.openPath(output_path);
    if (error_message !== "") {
      throw new AppErrors.AppError("file.io_failed", {
        diagnostic_context: { output_path, reason: error_message },
      });
    }
  }

  const app_root = app.isPackaged ? path.dirname(process.execPath) : process.cwd();
  const backend_runtime = new BackendRuntimeClient({
    workerEntryUrl: options.backendRuntimeWorkerEntryUrl,
    appRoot: app_root,
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    openOutputFolder: open_output_folder,
    runAgentWorkspace: async (request, signal) => {
      if (agent_workspace_runner === null) {
        throw new AppErrors.AppError("runtime.internal_invariant", {
          diagnostic_context: { reason: "agent_workspace_runner_not_ready" },
        });
      }
      return await agent_workspace_runner.run(request, signal);
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
   * 窗口只能在 Backend API ready 后创建，避免 preload 暴露不可用的 API 地址。
   */
  function require_backend_api_base_url(): string {
    if (backend_api_base_url === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "backend_api_base_url_not_ready" },
      });
    }

    return backend_api_base_url;
  }

  /**
   * 创建主工作台窗口，并把窗口关闭后的跨宿主联动留在入口层。
   */
  function create_main_window_for_runtime(): void {
    win = create_main_window({
      desktopBundleDir: desktop_bundle_dir,
      backendApiBaseUrl: require_backend_api_base_url(),
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
      agent_workspace_runner?.dispose();
      agent_workspace_runner = null;
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
      agent_workspace_runner = new DesktopAgentWorkspaceRunner({
        relatedItemSearchWorkerEntryUrl: options.agentRelatedItemSearchWorkerEntryUrl,
      });
      const backend_start_result = await backend_runtime.start();
      backend_api_base_url = backend_start_result.apiBaseUrl;
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
        if (backend_api_base_url === null) {
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
