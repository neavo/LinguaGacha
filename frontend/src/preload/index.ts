import { ipcRenderer, contextBridge, webUtils } from "electron";
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
} from "../shared/desktop-ipc-channels";
import { resolve_core_api_base_url } from "../shared/core-api-base-url";
import {
  DESKTOP_TITLE_BAR_HEIGHT,
  resolve_title_bar_control_side,
  resolve_title_bar_safe_area_end,
  resolve_title_bar_safe_area_start,
  uses_title_bar_overlay,
} from "../shared/desktop-shell";
import {
  type DesktopShellInfo,
  type DesktopPathPickResult,
  type ThemeMode,
} from "../shared/desktop-types";
const DESKTOP_SHELL_INFO: DesktopShellInfo = {
  platform: process.platform,
  usesTitleBarOverlay: uses_title_bar_overlay(process.platform),
  titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
  titleBarControlSide: resolve_title_bar_control_side(process.platform),
  titleBarSafeAreaStart: resolve_title_bar_safe_area_start(process.platform),
  titleBarSafeAreaEnd: resolve_title_bar_safe_area_end(process.platform),
};
const CORE_API_BASE_URL = resolve_core_api_base_url();

contextBridge.exposeInMainWorld("desktopApp", {
  shell: DESKTOP_SHELL_INFO,
  coreApi: {
    baseUrl: CORE_API_BASE_URL,
  },
  /**
   * 暴露安全文件路径查询，避免 renderer 直接访问 Node。
   */
  getPathForFile(file: File): string {
    // Electron 41 已移除 renderer 侧的 File.path，这里统一通过 preload 桥接官方替代接口。
    return webUtils.getPathForFile(file);
  },
  /**
   * 同步标题栏主题，保持窗口外观由 preload 窄接口承接。
   */
  setTitleBarTheme(theme_mode: ThemeMode): void {
    if (!DESKTOP_SHELL_INFO.usesTitleBarOverlay) {
      return;
    }

    ipcRenderer.send(IPC_CHANNEL_TITLE_BAR_THEME, theme_mode);
  },
  /**
   * 请求主进程退出应用，避免 renderer 直接触碰 Electron。
   */
  async quitApp(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_QUIT_APP);
  },
  /**
   * 打开或聚焦日志窗口，保持窗口单例由 main 持有。
   */
  async openLogWindow(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_LOG_WINDOW);
  },
  /**
   * 订阅窗口关闭请求，确保 renderer 能参与保存确认。
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
   * 委托主进程打开外链，避免页面直接调用 shell。
   */
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, url);
  },
  /**
   * 请求选择源文件，保持原生对话框只在 main 侧打开。
   */
  async pickProjectSourceFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH);
  },
  /**
   * 请求选择源目录，保持目录权限和返回值在 preload 边界内。
   */
  async pickProjectSourceDirectoryPath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH);
  },
  /**
   * 请求选择工程文件，避免 renderer 直接读取文件系统。
   */
  async pickProjectFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_FILE_PATH);
  },
  /**
   * 请求选择工程保存路径，保持保存对话框集中。
   */
  async pickProjectSavePath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, default_name);
  },
  /**
   * 请求选择工作台文件，统一文件筛选和路径返回。
   */
  async pickWorkbenchFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH);
  },
  /**
   * 请求选择固定工程目录，保持目录选择语义集中。
   */
  async pickFixedProjectDirectory(default_path?: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, default_path);
  },
  /**
   * 请求选择术语导入文件，避免 renderer 触碰本地路径。
   */
  async pickGlossaryImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH);
  },
  /**
   * 请求选择术语导出路径，保持写出位置由 main 确认。
   */
  async pickGlossaryExportPath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, default_name);
  },
  /**
   * 请求选择提示词导入文件，保持文件访问留在宿主边界。
   */
  async pickPromptImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH);
  },
  /**
   * 请求选择提示词导出路径，保持导出路径由原生对话框确认。
   */
  async pickPromptExportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH);
  },
});
