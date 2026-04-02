import { ipcRenderer, contextBridge } from 'electron'

const TITLE_BAR_OVERLAY_HEIGHT = 40
const DESKTOP_SHELL_INFO: DesktopShellInfo = {
  platform: process.platform,
  usesTitleBarOverlay: process.platform === 'win32' || process.platform === 'linux',
  titleBarOverlayHeight: process.platform === 'win32' || process.platform === 'linux' ? TITLE_BAR_OVERLAY_HEIGHT : 0,
}

contextBridge.exposeInMainWorld('desktopApp', {
  shell: DESKTOP_SHELL_INFO,
  onMainProcessMessage(listener: MainProcessMessageListener): () => void {
    // 只暴露当前阶段真正需要的能力，避免把整个 ipcRenderer 裸送给渲染层。
    const wrapped_listener = (_event: Electron.IpcRendererEvent, message: string) => {
      listener(message)
    }

    ipcRenderer.on('main-process-message', wrapped_listener)

    return () => {
      ipcRenderer.off('main-process-message', wrapped_listener)
    }
  },
})
