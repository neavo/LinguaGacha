export type ThemeMode = 'light' | 'dark'

export type DesktopShellInfo = {
  platform: NodeJS.Platform
  usesTitleBarOverlay: boolean
  titleBarOverlayHeight: number
}

export type DesktopPathPickResult = {
  canceled: boolean
  path: string | null
}
