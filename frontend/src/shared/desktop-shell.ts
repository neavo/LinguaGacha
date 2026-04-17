import type { TitleBarControlSide } from './desktop-types'

// 统一由共享层定义标题栏高度，避免主进程和渲染层各自维护一套像素常量。
export const DESKTOP_TITLE_BAR_HEIGHT = 40
// macOS 预留左侧红绿灯安全区，优先贴合系统原生布局而不是做镜像对称。
export const MACOS_TITLE_BAR_SAFE_AREA_START = 80
export const MACOS_TITLE_BAR_SAFE_AREA_END = 0
// Overlay 平台把原生控件放在右侧，需要给渲染层留出稳定的逻辑安全区。
export const OVERLAY_TITLE_BAR_SAFE_AREA_START = 0
export const OVERLAY_TITLE_BAR_SAFE_AREA_END = 144

export function uses_title_bar_overlay(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'linux'
}

export function resolve_title_bar_control_side(platform: NodeJS.Platform): TitleBarControlSide {
  let control_side: TitleBarControlSide = 'none'

  if (platform === 'darwin') {
    control_side = 'left'
  } else if (uses_title_bar_overlay(platform)) {
    control_side = 'right'
  } else {
    control_side = 'none'
  }

  return control_side
}

export function resolve_title_bar_safe_area_start(platform: NodeJS.Platform): number {
  let safe_area_start = 0

  if (platform === 'darwin') {
    safe_area_start = MACOS_TITLE_BAR_SAFE_AREA_START
  } else if (uses_title_bar_overlay(platform)) {
    safe_area_start = OVERLAY_TITLE_BAR_SAFE_AREA_START
  } else {
    safe_area_start = 0
  }

  return safe_area_start
}

export function resolve_title_bar_safe_area_end(platform: NodeJS.Platform): number {
  let safe_area_end = 0

  if (platform === 'darwin') {
    safe_area_end = MACOS_TITLE_BAR_SAFE_AREA_END
  } else if (uses_title_bar_overlay(platform)) {
    safe_area_end = OVERLAY_TITLE_BAR_SAFE_AREA_END
  } else {
    safe_area_end = 0
  }

  return safe_area_end
}
