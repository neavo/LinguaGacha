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
} from "../shared/ipc-channels";
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
  getPathForFile(file: File): string {
    // Electron 41 已移除 renderer 侧的 File.path，这里统一通过 preload 桥接官方替代接口。
    return webUtils.getPathForFile(file);
  },
  setTitleBarTheme(theme_mode: ThemeMode): void {
    if (!DESKTOP_SHELL_INFO.usesTitleBarOverlay) {
      return;
    }

    ipcRenderer.send(IPC_CHANNEL_TITLE_BAR_THEME, theme_mode);
  },
  async quitApp(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_QUIT_APP);
  },
  async openLogWindow(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_LOG_WINDOW);
  },
  onWindowCloseRequest(callback: () => void): () => void {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on(IPC_CHANNEL_WINDOW_CLOSE_REQUEST, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNEL_WINDOW_CLOSE_REQUEST, listener);
    };
  },
  async openExternalUrl(url: string): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_OPEN_EXTERNAL_URL, url);
  },
  async pickProjectSourceFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH);
  },
  async pickProjectSourceDirectoryPath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH);
  },
  async pickProjectFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_FILE_PATH);
  },
  async pickProjectSavePath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, default_name);
  },
  async pickWorkbenchFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH);
  },
  async pickFixedProjectDirectory(default_path?: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, default_path);
  },
  async pickGlossaryImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_IMPORT_FILE_PATH);
  },
  async pickGlossaryExportPath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_GLOSSARY_EXPORT_PATH, default_name);
  },
  async pickPromptImportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_IMPORT_FILE_PATH);
  },
  async pickPromptExportFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROMPT_EXPORT_FILE_PATH);
  },
});
