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
} from "../ipc/ipc-contract";
import { resolve_core_api_base_url_from_argv } from "../../core/api/core-api-endpoint";
import { resolve_desktop_shell_info } from "../shell/shell-contract";
import { DESKTOP_BRIDGE_GLOBAL_NAME, type DesktopBridgeApi } from "../bridge/bridge-api";
import { resolve_desktop_system_proxy_startup_notice_from_argv } from "../bridge/system-proxy-startup-notice";
import type { DesktopPathPickResult, DesktopPlatform, ThemeMode } from "../bridge/bridge-types";

const DESKTOP_SHELL_INFO = resolve_desktop_shell_info(process.platform as DesktopPlatform);
const CORE_API_BASE_URL = resolve_core_api_base_url_from_argv(process.argv);
const SYSTEM_PROXY_STARTUP_NOTICE = resolve_desktop_system_proxy_startup_notice_from_argv(
  process.argv,
); // 系统代理提示来自 main 启动参数，preload 只转交脱敏摘要给 renderer

const DESKTOP_BRIDGE_API: DesktopBridgeApi = {
  shell: DESKTOP_SHELL_INFO,
  coreApi: {
    baseUrl: CORE_API_BASE_URL,
    systemProxyStartupNotice: SYSTEM_PROXY_STARTUP_NOTICE,
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
  setTitleBarTheme(theme_mode: ThemeMode): void {
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
   * 委托主进程打开外链，避免页面直接调用 shell
   */
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, url);
  },
  /**
   * 请求选择源文件，保持原生对话框只在 Electron 主进程打开
   */
  async pickProjectSourceFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH);
  },
  /**
   * 请求选择源目录，保持目录权限和返回值在 preload 边界内
   */
  async pickProjectSourceDirectoryPath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH);
  },
  /**
   * 请求选择工程文件，避免 renderer 直接读取文件系统
   */
  async pickProjectFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_FILE_PATH);
  },
  /**
   * 请求选择工程保存路径，保持保存对话框集中
   */
  async pickProjectSavePath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, default_name);
  },
  /**
   * 请求选择工作台文件，统一文件筛选和路径返回
   */
  async pickWorkbenchFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH);
  },
  /**
   * 请求选择固定工程目录，保持目录选择语义集中
   */
  async pickFixedProjectDirectory(default_path?: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, default_path);
  },
  /**
   * 请求选择术语导入文件，避免 renderer 触碰本地路径
   */
  async pickGlossaryImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH);
  },
  /**
   * 请求选择术语导出路径，保持写出位置由 main 确认
   */
  async pickGlossaryExportPath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, default_name);
  },
  /**
   * 请求选择提示词导入文件，保持文件访问留在宿主边界
   */
  async pickPromptImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH);
  },
  /**
   * 请求选择提示词导出路径，保持导出路径由原生对话框确认
   */
  async pickPromptExportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH);
  },
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_GLOBAL_NAME, DESKTOP_BRIDGE_API);
