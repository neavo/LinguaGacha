import { app, BrowserWindow, ipcMain, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 与 PySide 版 AppFluentWindow 对齐，后续 Electron UI 也以 1280 x 800 作为标准开发基线。
const WINDOW_STANDARD_WIDTH = 1280
const WINDOW_STANDARD_HEIGHT = 800
const WINDOW_BACKGROUND_COLOR = '#F8FAFC'
const TITLE_BAR_OVERLAY_HEIGHT = 39
const IPC_CHANNEL_TITLE_BAR_THEME = 'window:set-title-bar-theme'
const LIGHT_TITLE_BAR_OVERLAY_COLOR = '#FAF7F4'
const LIGHT_TITLE_BAR_SYMBOL_COLOR = '#1F2329'
const DARK_TITLE_BAR_OVERLAY_COLOR = '#121212'
const DARK_TITLE_BAR_SYMBOL_COLOR = '#EEF2F7'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

if (VITE_DEV_SERVER_URL) {
  // 开发态暴露 Chromium 调试端口，方便 Playwright 直接附着现有 Electron 实例。
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

let win: BrowserWindow | null

function build_title_bar_overlay(theme_mode: 'light' | 'dark'): Electron.TitleBarOverlay {
  if (theme_mode === 'dark') {
    return {
      color: DARK_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DARK_TITLE_BAR_SYMBOL_COLOR,
      height: TITLE_BAR_OVERLAY_HEIGHT,
    }
  } else {
    return {
      color: LIGHT_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: LIGHT_TITLE_BAR_SYMBOL_COLOR,
      height: TITLE_BAR_OVERLAY_HEIGHT,
    }
  }
}

function sync_title_bar_overlay(theme_mode: 'light' | 'dark'): void {
  if (win === null) {
    return
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return
  }

  win.setTitleBarOverlay(build_title_bar_overlay(theme_mode))
}

function createWindowOptions(): BrowserWindowConstructorOptions {
  // 统一在这里定义窗口能力，避免主进程别处偷偷改动窗口边框策略。
  const window_options: BrowserWindowConstructorOptions = {
    width: WINDOW_STANDARD_WIDTH,
    height: WINDOW_STANDARD_HEIGHT,
    minWidth: WINDOW_STANDARD_WIDTH,
    minHeight: WINDOW_STANDARD_HEIGHT,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }

  if (process.platform === 'darwin') {
    // macOS 在隐藏标题栏后仍会保留红绿灯按钮，适合桌面壳层继续自定义。
    window_options.titleBarStyle = 'hidden'
  } else if (process.platform === 'win32' || process.platform === 'linux') {
    // Windows 和 Linux 通过 Overlay 把原生控制按钮保留下来，避免沦为纯网页外壳。
    window_options.titleBarStyle = 'hidden'
    window_options.titleBarOverlay = build_title_bar_overlay(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  } else {
    // 未知平台兜底为真正无边框，至少保证自定义壳层策略仍然成立。
    window_options.frame = false
  }

  return window_options
}

function createWindow(): void {
  win = new BrowserWindow(createWindowOptions())

  win.once('ready-to-show', () => {
    win?.show()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // macOS 上点击 Dock 图标会重新拉起窗口，这样交互才符合系统习惯。
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)

ipcMain.on(IPC_CHANNEL_TITLE_BAR_THEME, (_event, theme_mode: 'light' | 'dark') => {
  sync_title_bar_overlay(theme_mode)
})
