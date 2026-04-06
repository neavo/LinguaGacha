import { ipcRenderer, contextBridge } from 'electron'
import {
  IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY,
  IPC_CHANNEL_PICK_PROJECT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SAVE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH,
  IPC_CHANNEL_QUIT_APP,
  IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH,
  IPC_CHANNEL_TITLE_BAR_THEME,
} from '../shared/ipc-channels'
import { resolve_core_api_base_url_candidates } from '../shared/core-api-base-url'
import {
  DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  uses_title_bar_overlay,
} from '../shared/desktop-shell'
import {
  type DesktopShellInfo,
  type DesktopPathPickResult,
  type ThemeMode,
} from '../shared/desktop-types'
const DESKTOP_SHELL_INFO: DesktopShellInfo = {
  platform: process.platform,
  usesTitleBarOverlay: uses_title_bar_overlay(process.platform),
  titleBarOverlayHeight: uses_title_bar_overlay(process.platform) ? DESKTOP_TITLE_BAR_OVERLAY_HEIGHT : 0,
}
const CORE_API_BASE_URL_CANDIDATES = resolve_core_api_base_url_candidates()

contextBridge.exposeInMainWorld('desktopApp', {
  shell: DESKTOP_SHELL_INFO,
  coreApi: {
    baseUrlCandidates: CORE_API_BASE_URL_CANDIDATES,
  },
  setTitleBarTheme(theme_mode: ThemeMode): void {
    if (!DESKTOP_SHELL_INFO.usesTitleBarOverlay) {
      return
    }

    ipcRenderer.send(IPC_CHANNEL_TITLE_BAR_THEME, theme_mode)
  },
  async quitApp(): Promise<void> {
    await ipcRenderer.invoke(IPC_CHANNEL_QUIT_APP)
  },
  async pickProjectSourceFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH)
  },
  async pickProjectSourceDirectoryPath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH)
  },
  async pickProjectFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_FILE_PATH)
  },
  async pickProjectSavePath(default_name: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, default_name)
  },
  async pickWorkbenchFilePath(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH)
  },
  async pickFixedProjectDirectory(default_path?: string): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, default_path)
  },
})
