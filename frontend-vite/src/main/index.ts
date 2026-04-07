import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

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
import {
  DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  uses_title_bar_overlay,
} from '../shared/desktop-shell'
import {
  type DesktopPathPickResult,
  type ThemeMode,
} from '../shared/desktop-types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 与 PySide 版 AppFluentWindow 对齐，后续 Electron UI 也以 1280 x 800 作为标准开发基线。
const WINDOW_STANDARD_WIDTH = 1280
const WINDOW_STANDARD_HEIGHT = 800
const WINDOW_BACKGROUND_COLOR = '#F8FAFC'
const LIGHT_TITLE_BAR_OVERLAY_COLOR = '#FAF7F4'
const LIGHT_TITLE_BAR_SYMBOL_COLOR = '#1F2329'
const DARK_TITLE_BAR_OVERLAY_COLOR = '#121212'
const DARK_TITLE_BAR_SYMBOL_COLOR = '#EEF2F7'
const DEVTOOLS_TOGGLE_KEY = 'F12'
const DEVTOOLS_TOGGLE_WITH_MODIFIER_KEY = 'i'
const WINDOW_LOAD_FAILURE_TITLE = 'LinguaGacha Frontend 加载失败'
const WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH = 240
const WINDOW_FONT_STACK = '"LGConsolas", "LGBaseFont", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── index.js
// │ │ └── index.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// electron-vite 在开发态通过 ELECTRON_RENDERER_URL 暴露唯一权威的 renderer dev server 地址。
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] ?? null
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = RENDERER_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST

if (RENDERER_DEV_SERVER_URL) {
  // 开发态暴露 Chromium 调试端口，方便 Playwright 直接附着现有 Electron 实例。
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

let win: BrowserWindow | null

function is_development_mode(): boolean {
  let development_mode = false

  if (RENDERER_DEV_SERVER_URL) {
    development_mode = true
  } else {
    development_mode = false
  }

  return development_mode
}

function is_devtools_shortcut(input: Electron.Input): boolean {
  const is_function_shortcut =
    input.type === 'keyDown' &&
    input.key === DEVTOOLS_TOGGLE_KEY
  const is_modifier_shortcut =
    input.type === 'keyDown' &&
    input.key.toLowerCase() === DEVTOOLS_TOGGLE_WITH_MODIFIER_KEY &&
    input.shift &&
    (input.control || input.meta)
  let devtools_shortcut = false

  if (is_function_shortcut || is_modifier_shortcut) {
    devtools_shortcut = true
  } else {
    devtools_shortcut = false
  }

  return devtools_shortcut
}

function register_development_devtools_shortcut(target_window: BrowserWindow): void {
  if (is_development_mode()) {
    // 开发态窗口隐藏了菜单栏，需要显式补一个 DevTools 入口，避免调试能力只能靠默认菜单兜底。
    target_window.webContents.on('before-input-event', (event, input) => {
      if (is_devtools_shortcut(input)) {
        event.preventDefault()
        target_window.webContents.toggleDevTools()
      }
    })
  }
}

function truncate_error_message(message: string): string {
  let truncated_message = message

  if (message.length > WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH) {
    truncated_message = `${message.slice(0, WINDOW_LOAD_FAILURE_BODY_MAX_LENGTH)}...`
  } else {
    truncated_message = message
  }

  return truncated_message
}

function escape_html(raw_text: string): string {
  const escape_map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }

  // 保持对 ES2020 构建目标兼容，这里不用 String.prototype.replaceAll。
  return raw_text.replace(/[&<>"']/g, (character) => {
    return escape_map[character] ?? character
  })
}

function build_window_load_failure_font_face_css(): string {
  const consolas_font_url = pathToFileURL(path.join(VITE_PUBLIC, 'fonts', 'Consolas.ttf')).href
  const base_font_url = pathToFileURL(path.join(VITE_PUBLIC, 'fonts', 'LGBaseFont.ttf')).href

  // data: 页面没有稳定的相对资源基址，这里直接注入 file URL，保证开发态和构建态都能命中同一份字体资源。
  return `
      @font-face {
        font-family: "LGConsolas";
        src: url("${consolas_font_url}") format("truetype");
        font-weight: 400 700;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "LGConsolas";
        src: url("${consolas_font_url}") format("truetype");
        font-weight: 400 700;
        font-style: italic;
        font-display: swap;
      }

      @font-face {
        font-family: "LGBaseFont";
        src: url("${base_font_url}") format("truetype");
        font-weight: 400 700;
        font-style: normal;
        font-display: swap;
      }

      @font-face {
        font-family: "LGBaseFont";
        src: url("${base_font_url}") format("truetype");
        font-weight: 400 700;
        font-style: italic;
        font-display: swap;
      }
`
}

function build_window_load_failure_page(url: string, message: string): string {
  const escaped_url = escape_html(url)
  const escaped_message = escape_html(truncate_error_message(message))
  const font_face_css = build_window_load_failure_font_face_css()

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${WINDOW_LOAD_FAILURE_TITLE}</title>
    <style>
${font_face_css}
      :root {
        color-scheme: light dark;
        font-family: ${WINDOW_FONT_STACK};
        background: #f8f7f7;
        color: #282522;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgb(255 255 255 / 0.72), transparent 22%),
          linear-gradient(180deg, #faf8f6 0%, #f2efeb 100%);
      }

      main {
        width: min(760px, calc(100vw - 64px));
        padding: 28px 30px;
        border: 1px solid #ddd8d3;
        border-radius: 18px;
        background: rgb(255 255 255 / 0.92);
        box-shadow: 0 28px 60px -36px rgb(15 23 42 / 0.28);
      }

      h1 {
        margin: 0 0 10px;
        font-size: 28px;
        line-height: 1.2;
      }

      p {
        margin: 0 0 18px;
        font-size: 15px;
        line-height: 1.7;
        color: #544f49;
      }

      dl {
        margin: 0;
        display: grid;
        gap: 12px;
      }

      dt {
        font-size: 13px;
        font-weight: 700;
        color: #7c756e;
      }

      dd {
        margin: 6px 0 0;
        padding: 12px 14px;
        border-radius: 12px;
        background: #f5f2ee;
        color: #282522;
        word-break: break-word;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${WINDOW_LOAD_FAILURE_TITLE}</h1>
      <p>主进程已经启动，但渲染层入口没有成功加载。开发态下会先把窗口显示出来，避免只看到 Electron 进程却没有前台应用。</p>
      <dl>
        <div>
          <dt>目标地址</dt>
          <dd>${escaped_url}</dd>
        </div>
        <div>
          <dt>错误信息</dt>
          <dd>${escaped_message}</dd>
        </div>
      </dl>
    </main>
  </body>
</html>`
}

function show_window_if_hidden(target_window: BrowserWindow): void {
  if (target_window.isVisible()) {
    target_window.focus()
  } else {
    target_window.show()
    target_window.focus()
  }
}

function register_window_runtime_events(target_window: BrowserWindow): void {
  target_window.webContents.on(
    'did-fail-load',
    (_event, error_code, error_description, validated_url, is_main_frame) => {
      const error_message = `加载失败 (${error_code.toString()}): ${error_description}`

      if (is_main_frame) {
        console.error('[frontend-vite] renderer load failed', {
          error_code,
          error_description,
          validated_url,
        })
        show_window_if_hidden(target_window)
        void target_window.loadURL(
          `data:text/html;charset=UTF-8,${encodeURIComponent(build_window_load_failure_page(validated_url, error_message))}`,
        )
      } else {
        console.warn('[frontend-vite] subframe load failed', {
          error_code,
          error_description,
          validated_url,
        })
      }
    },
  )

  target_window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[frontend-vite] renderer process gone', details)
    show_window_if_hidden(target_window)
  })

  target_window.on('unresponsive', () => {
    console.error('[frontend-vite] window became unresponsive')
    show_window_if_hidden(target_window)
  })
}

function build_title_bar_overlay(theme_mode: ThemeMode): Electron.TitleBarOverlay {
  if (theme_mode === 'dark') {
    return {
      color: DARK_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DARK_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    }
  } else {
    return {
      color: LIGHT_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: LIGHT_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    }
  }
}

function sync_title_bar_overlay(theme_mode: ThemeMode): void {
  if (win === null) {
    return
  }
  if (!uses_title_bar_overlay(process.platform)) {
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
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite 产出的预加载脚本默认是 ESM，关闭 sandbox 才能让 Electron 按模块语义正确执行。
      sandbox: false,
    },
  }

  if (process.platform === 'darwin') {
    // macOS 在隐藏标题栏后仍会保留红绿灯按钮，适合桌面壳层继续自定义。
    window_options.titleBarStyle = 'hidden'
  } else if (uses_title_bar_overlay(process.platform)) {
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
  register_development_devtools_shortcut(win)
  register_window_runtime_events(win)

  win.once('ready-to-show', () => {
    win?.show()
  })

  if (RENDERER_DEV_SERVER_URL) {
    // 开发态优先让窗口可见，这样就算首屏挂掉也能直接看到错误页和 DevTools。
    show_window_if_hidden(win)
    void win.loadURL(RENDERER_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

async function pick_open_path(
  options: Electron.OpenDialogOptions,
): Promise<DesktopPathPickResult> {
  const result = win === null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(win, options)
  const selected_path = result.filePaths[0] ?? null
  return {
    canceled: result.canceled || selected_path === null,
    path: selected_path,
  }
}

async function pick_save_path(default_name: string): Promise<DesktopPathPickResult> {
  const dialog_options: Electron.SaveDialogOptions = {
    defaultPath: default_name,
    filters: [
      {
        name: 'LinguaGacha Project',
        extensions: ['lg'],
      },
    ],
  }
  const result = win === null
    ? await dialog.showSaveDialog(dialog_options)
    : await dialog.showSaveDialog(win, dialog_options)

  return {
    canceled: result.canceled || result.filePath === undefined,
    path: result.filePath ?? null,
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

ipcMain.on(IPC_CHANNEL_TITLE_BAR_THEME, (_event, theme_mode: ThemeMode) => {
  sync_title_bar_overlay(theme_mode)
})

ipcMain.handle(IPC_CHANNEL_QUIT_APP, async () => {
  app.quit()
})

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_FILE_PATH, async () => {
  return pick_open_path({
    properties: ['openFile'],
  })
})

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SOURCE_DIRECTORY_PATH, async () => {
  return pick_open_path({
    properties: ['openDirectory'],
  })
})

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_FILE_PATH, async () => {
  return pick_open_path({
    properties: ['openFile'],
    filters: [
      {
        name: 'LinguaGacha Project',
        extensions: ['lg'],
      },
    ],
  })
})

ipcMain.handle(IPC_CHANNEL_PICK_PROJECT_SAVE_PATH, async (_event, default_name: string) => {
  return pick_save_path(default_name)
})

ipcMain.handle(IPC_CHANNEL_PICK_WORKBENCH_FILE_PATH, async () => {
  return pick_open_path({
    properties: ['openFile'],
  })
})

ipcMain.handle(IPC_CHANNEL_PICK_FIXED_PROJECT_DIRECTORY, async (_event, default_path?: string) => {
  return pick_open_path({
    defaultPath: typeof default_path === 'string' && default_path !== '' ? default_path : undefined,
    properties: ['openDirectory', 'createDirectory'],
  })
})
