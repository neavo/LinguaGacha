import type {
  DesktopPlatform,
  DesktopShellInfo,
  ThemeMode,
  TitleBarControlSide,
} from "./bridge-types";

// 标题栏高度由桌面契约统一定义，main overlay 与 renderer CSS 变量共同消费。
export const DESKTOP_TITLE_BAR_HEIGHT = 40;
// Windows/Linux 的原生 overlay 会盖住网页内容；少占 1px，让渲染层分隔线保持可见。
export const DESKTOP_TITLE_BAR_OVERLAY_HEIGHT = DESKTOP_TITLE_BAR_HEIGHT - 1;

// macOS 预留左侧红绿灯安全区，优先贴合系统原生布局而不是做镜像对称。
const MACOS_TITLE_BAR_SAFE_AREA_START = 80;
const MACOS_TITLE_BAR_SAFE_AREA_END = 0;
// Overlay 平台把原生控件放在右侧，需要给 renderer 留出稳定的逻辑安全区。
const OVERLAY_TITLE_BAR_SAFE_AREA_START = 0;
const OVERLAY_TITLE_BAR_SAFE_AREA_END = 144;

// 原生 overlay 配色必须和 renderer 的 --ui-titlebar-surface 保持一致。
const LIGHT_TITLE_BAR_OVERLAY_COLOR = "#F4F5F7";
const LIGHT_TITLE_BAR_SYMBOL_COLOR = "#1F2329";
const DARK_TITLE_BAR_OVERLAY_COLOR = "#121319";
const DARK_TITLE_BAR_SYMBOL_COLOR = "#EEF2F7";

export type DesktopTitleBarOverlayTheme = {
  color: string; // 原生标题栏背景色。
  symbolColor: string; // 原生窗口控制按钮颜色。
  height: number; // 原生 overlay 高度。
};

// 只有 Windows/Linux 使用 Electron 原生 overlay，macOS 走系统 inset 标题栏。
export function uses_title_bar_overlay(platform: DesktopPlatform): boolean {
  return platform === "win32" || platform === "linux";
}

// renderer 只关心控制按钮的逻辑侧，不直接分支 Electron 平台细节。
export function resolve_title_bar_control_side(platform: DesktopPlatform): TitleBarControlSide {
  let control_side: TitleBarControlSide = "none";

  if (platform === "darwin") {
    control_side = "left";
  } else if (uses_title_bar_overlay(platform)) {
    control_side = "right";
  } else {
    control_side = "none";
  }

  return control_side;
}

// 起始侧安全区用于避开 macOS 红绿灯，overlay 平台无需预留。
export function resolve_title_bar_safe_area_start(platform: DesktopPlatform): number {
  let safe_area_start = 0;

  if (platform === "darwin") {
    safe_area_start = MACOS_TITLE_BAR_SAFE_AREA_START;
  } else if (uses_title_bar_overlay(platform)) {
    safe_area_start = OVERLAY_TITLE_BAR_SAFE_AREA_START;
  } else {
    safe_area_start = 0;
  }

  return safe_area_start;
}

// 结束侧安全区用于避开 Windows/Linux 原生 overlay 控制按钮。
export function resolve_title_bar_safe_area_end(platform: DesktopPlatform): number {
  let safe_area_end = 0;

  if (platform === "darwin") {
    safe_area_end = MACOS_TITLE_BAR_SAFE_AREA_END;
  } else if (uses_title_bar_overlay(platform)) {
    safe_area_end = OVERLAY_TITLE_BAR_SAFE_AREA_END;
  } else {
    safe_area_end = 0;
  }

  return safe_area_end;
}

// preload 暴露完整 shell 快照，renderer 不再重复计算平台布局规则。
export function resolve_desktop_shell_info(platform: DesktopPlatform): DesktopShellInfo {
  return {
    platform,
    usesTitleBarOverlay: uses_title_bar_overlay(platform),
    titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
    titleBarControlSide: resolve_title_bar_control_side(platform),
    titleBarSafeAreaStart: resolve_title_bar_safe_area_start(platform),
    titleBarSafeAreaEnd: resolve_title_bar_safe_area_end(platform),
  };
}

// main 把网页明暗主题映射成 Electron 原生 overlay 可消费的稳定配色对象。
export function resolve_title_bar_overlay_theme(
  theme_mode: ThemeMode,
): DesktopTitleBarOverlayTheme {
  if (theme_mode === "dark") {
    return {
      color: DARK_TITLE_BAR_OVERLAY_COLOR,
      symbolColor: DARK_TITLE_BAR_SYMBOL_COLOR,
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    };
  }

  return {
    color: LIGHT_TITLE_BAR_OVERLAY_COLOR,
    symbolColor: LIGHT_TITLE_BAR_SYMBOL_COLOR,
    height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  };
}
