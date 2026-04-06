/// <reference types="electron-vite/node" />

import type {
  DesktopPathPickResult,
  DesktopShellInfo,
  ThemeMode,
} from './shared/desktop-types'

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

declare global {
  interface Window {
    desktopApp: {
      shell: DesktopShellInfo
      coreApi: {
        baseUrlCandidates: string[]
      }
      setTitleBarTheme: (theme_mode: ThemeMode) => void
      quitApp: () => Promise<void>
      pickProjectSourceFilePath: () => Promise<DesktopPathPickResult>
      pickProjectSourceDirectoryPath: () => Promise<DesktopPathPickResult>
      pickProjectFilePath: () => Promise<DesktopPathPickResult>
      pickProjectSavePath: (default_name: string) => Promise<DesktopPathPickResult>
      pickWorkbenchFilePath: () => Promise<DesktopPathPickResult>
      pickFixedProjectDirectory: (default_path?: string) => Promise<DesktopPathPickResult>
    }
  }
}

export {}
