import { ipcRenderer, contextBridge } from 'electron'

const TITLE_BAR_OVERLAY_HEIGHT = 40
const IPC_CHANNEL_TITLE_BAR_THEME = 'window:set-title-bar-theme'
const DESKTOP_SHELL_INFO: DesktopShellInfo = {
  platform: process.platform,
  usesTitleBarOverlay: process.platform === 'win32' || process.platform === 'linux',
  titleBarOverlayHeight: process.platform === 'win32' || process.platform === 'linux' ? TITLE_BAR_OVERLAY_HEIGHT : 0,
}

contextBridge.exposeInMainWorld('desktopApp', {
  shell: DESKTOP_SHELL_INFO,
  setTitleBarTheme(theme_mode: ThemeMode): void {
    if (!DESKTOP_SHELL_INFO.usesTitleBarOverlay) {
      return
    }

    ipcRenderer.send(IPC_CHANNEL_TITLE_BAR_THEME, theme_mode)
  },
})
