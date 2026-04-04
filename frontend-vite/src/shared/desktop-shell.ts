export const DESKTOP_TITLE_BAR_OVERLAY_HEIGHT = 40

export function uses_title_bar_overlay(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'linux'
}
