import { ipcRenderer, contextBridge, webUtils } from "electron";
import path from "node:path";

import {
  IPC_CHANNEL_OPEN_EXTERNAL_URL,
  IPC_CHANNEL_PICK_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_RENDERER_DIAGNOSTICS,
  IPC_CHANNEL_OPEN_LOG_WINDOW,
  IPC_CHANNEL_TITLE_BAR_THEME,
  IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
  IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
  IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER,
  IPC_CHANNEL_WINDOW_CLOSE_REQUEST,
} from "../gui-ipc-contract";
import { resolve_backend_api_base_url_from_argv } from "../../backend/api/api-base-url";
import { resolve_desktop_shell_info } from "../shell/shell-contract";
import { DESKTOP_BRIDGE_GLOBAL_NAME, type DesktopBridgeApi } from "../bridge/bridge-api";
import type {
  DesktopPathPickIntent,
  DesktopPathPickIpcRequest,
  DesktopPathPickResult,
  DesktopPlatform,
  DesktopRendererDiagnosticsPayload,
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadRequest,
  DesktopUpdateDownloadResult,
  DesktopUpdateLaunchRequest,
  DesktopUpdateLaunchResult,
  ResolvedThemeMode,
} from "../bridge/bridge-types";

// DESKTOP SHELL INFO 是模块级稳定契约，集中维护避免调用点散落魔术值。
const DESKTOP_SHELL_INFO = resolve_desktop_shell_info(process.platform as DesktopPlatform);
// CORE API BASE URL 是跨边界路径或地址契约，集中保存避免调用点散落魔术字符串。
const BACKEND_API_BASE_URL = resolve_backend_api_base_url_from_argv(process.argv);
let next_update_download_request_id = 0; // preload 本地递增，避免进度事件在多次下载之间串台
const LAST_DIALOG_DIRECTORY_STORAGE_KEY = "linguagacha:dialog:last-directory-workaround"; // Electron 43 上游修复落地后连同读写逻辑一起删除

const DESKTOP_BRIDGE_API: DesktopBridgeApi = {
  shell: DESKTOP_SHELL_INFO,
  backendApi: {
    baseUrl: BACKEND_API_BASE_URL,
  },
  /**
   * 暴露安全文件路径查询，避免 renderer 直接访问 Node
   */
  getPathForFile(file: File): string {
    // Electron 41 已移除 renderer 侧的 File.path，这里统一通过 preload 桥接官方替代接口
    return webUtils.getPathForFile(file);
  },
  /**
   * 同步标题栏主题，保持窗口外观由 preload 窄接口承接
   */
  setTitleBarTheme(theme_mode: ResolvedThemeMode): void {
    if (!DESKTOP_SHELL_INFO.usesTitleBarOverlay) {
      return;
    }

    ipcRenderer.send(IPC_CHANNEL_TITLE_BAR_THEME, theme_mode);
  },
  /**
   * 请求主进程退出应用，避免 renderer 直接触碰 Electron
   */
  async quitApp(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_QUIT_APP);
  },
  /**
   * 打开或聚焦日志窗口，保持窗口单例由 main 持有
   */
  async openLogWindow(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_LOG_WINDOW);
  },
  /**
   * 订阅窗口关闭请求，确保 renderer 能参与保存确认
   */
  onWindowCloseRequest(callback: () => void): () => void {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on(IPC_CHANNEL_WINDOW_CLOSE_REQUEST, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNEL_WINDOW_CLOSE_REQUEST, listener);
    };
  },
  /**
   * 上报 renderer 轻量诊断面包屑，供 main 在进程级崩溃后补齐上下文
   */
  reportRendererDiagnostics(payload: DesktopRendererDiagnosticsPayload): void {
    ipcRenderer.send(IPC_CHANNEL_RENDERER_DIAGNOSTICS, payload);
  },
  /**
   * 委托主进程打开外链，避免页面直接调用 shell
   */
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, url);
  },
  /**
   * 下载更新包并把 main 进度事件收口成单次回调
   */
  async downloadUpdate(
    request: DesktopUpdateDownloadRequest,
    on_progress: (progress: DesktopUpdateDownloadProgress) => void,
  ): Promise<DesktopUpdateDownloadResult> {
    const request_id = create_update_download_request_id();
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: DesktopUpdateDownloadProgress,
    ) => {
      if (progress.request_id === request_id) {
        on_progress(progress);
      }
    };
    ipcRenderer.on(IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS, listener);
    try {
      return await ipcRenderer.invoke(IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE, {
        ...request,
        request_id,
      });
    } finally {
      ipcRenderer.removeListener(IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS, listener);
    }
  },
  /**
   * 请求 main 复制并启动外部更新器
   */
  async launchUpdate(request: DesktopUpdateLaunchRequest): Promise<DesktopUpdateLaunchResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER, request);
  },
  async pickProjectSourceFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "project-source-files" });
  },
  async pickProjectSourceDirectoryPath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "project-source-directory" });
  },
  async pickProjectFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "project-file" });
  },
  async pickProjectSavePath(default_name: string): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "project-save", default_name });
  },
  async pickWorkbenchFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "workbench-files" });
  },
  async pickFixedProjectDirectory(default_path?: string): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "fixed-project-directory", default_path });
  },
  async pickGlossaryImportFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "glossary-import" });
  },
  async pickGlossaryExportPath(default_name: string): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "glossary-export", default_name });
  },
  async pickPromptImportFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "prompt-import" });
  },
  async pickPromptExportFilePath(): Promise<DesktopPathPickResult> {
    return invoke_path_picker({ kind: "prompt-export" });
  },
};

/**
 * 所有路径选择在 preload 汇入同一 IPC，并在成功后更新浏览器本地最近目录。
 */
async function invoke_path_picker(intent: DesktopPathPickIntent): Promise<DesktopPathPickResult> {
  const request: DesktopPathPickIpcRequest = {
    ...intent,
    default_directory: read_last_dialog_directory(),
  };
  const result = await ipcRenderer.invoke(IPC_CHANNEL_PICK_PATH, request);
  const selected_path = result.paths[0];
  if (!result.canceled && selected_path !== undefined && selected_path !== "") {
    write_last_dialog_directory(
      is_directory_pick(intent) ? selected_path : path.dirname(selected_path),
    );
  }
  return result;
}

function is_directory_pick(intent: DesktopPathPickIntent): boolean {
  return intent.kind === "project-source-directory" || intent.kind === "fixed-project-directory";
}

function read_last_dialog_directory(): string | null {
  try {
    const directory = localStorage.getItem(LAST_DIALOG_DIRECTORY_STORAGE_KEY);
    return directory === "" ? null : directory;
  } catch {
    return null; // 本地存储不可用不应阻断原生文件选择
  }
}

function write_last_dialog_directory(directory: string): void {
  try {
    localStorage.setItem(LAST_DIALOG_DIRECTORY_STORAGE_KEY, directory);
  } catch {
    // 最近目录只是 Electron 43 兼容状态，写入失败不影响本次选择结果
  }
}

/**
 * 创建单调递增的下载请求 id，避免暴露随机数依赖给 renderer。
 */
function create_update_download_request_id(): string {
  next_update_download_request_id += 1;
  return `update-download-${next_update_download_request_id.toString()}`;
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_GLOBAL_NAME, DESKTOP_BRIDGE_API);
