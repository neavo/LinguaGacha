/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

type DesktopShellInfo = {
  platform: NodeJS.Platform
  usesTitleBarOverlay: boolean
  titleBarOverlayHeight: number
}

type ThemeMode = 'light' | 'dark'
type MainProcessMessageListener = (message: string) => void

// Used in Renderer process, expose in `preload.ts`
interface Window {
  desktopApp: {
    shell: DesktopShellInfo
    onMainProcessMessage: (listener: MainProcessMessageListener) => () => void
    setTitleBarTheme: (theme_mode: ThemeMode) => void
  }
}
