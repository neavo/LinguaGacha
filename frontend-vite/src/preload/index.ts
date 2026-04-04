import { ipcRenderer, contextBridge } from 'electron'
import core_api_port_candidates from '../../core-api-port-candidates.json'
import {
  IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY,
  IPC_CHANNEL_PICK_PROJECT_FILE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SAVE_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH,
  IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH,
  IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH,
  IPC_CHANNEL_TITLE_BAR_THEME,
} from '../shared/ipc-channels'
import {
  DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  uses_title_bar_overlay,
} from '../shared/desktop-shell'
import {
  type DesktopShellInfo,
  type DesktopPathPickResult,
  type ThemeMode,
} from '../shared/desktop-types'

const CORE_API_BASE_URL_ENV_NAME = 'LINGUAGACHA_CORE_API_BASE_URL'
const CORE_API_BASE_URL_ARG_PREFIX = '--core-api-base-url='
const CORE_API_HOST = '127.0.0.1'

function normalize_core_api_base_url(base_url: string): string {
  return base_url.trim().replace(/\/+$/u, '')
}

function build_core_api_base_url(port: number): string {
  return `http://${CORE_API_HOST}:${port.toString()}`
}

function resolve_core_api_base_url_candidates(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const env_base_url = env[CORE_API_BASE_URL_ENV_NAME]

  if (typeof env_base_url === 'string' && env_base_url.trim() !== '') {
    return [normalize_core_api_base_url(env_base_url)]
  }

  const matched_argument = argv.find((argument) => argument.startsWith(CORE_API_BASE_URL_ARG_PREFIX))
  if (matched_argument !== undefined) {
    return [
      normalize_core_api_base_url(
        matched_argument.slice(CORE_API_BASE_URL_ARG_PREFIX.length),
      ),
    ]
  }

  return core_api_port_candidates.map((port_raw) => {
    return build_core_api_base_url(Number(port_raw))
  })
}

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
  async pickFixedProjectDirectory(): Promise<DesktopPathPickResult> {
    return ipcRenderer.invoke(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY)
  },
})
