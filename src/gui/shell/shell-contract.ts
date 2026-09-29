import type { DesktopPlatform, DesktopShellInfo, ResolvedThemeMode } from "../bridge/bridge-types";

export const DESKTOP_TITLE_BAR_HEIGHT = 40; // 标题栏高度由桌面契约统一定义，main overlay 与 renderer CSS 变量共同消费
export const DESKTOP_TITLE_BAR_OVERLAY_HEIGHT = DESKTOP_TITLE_BAR_HEIGHT - 1; // Windows/Linux 的原生 overlay 会盖住网页内容；少占 1px，让渲染层分隔线保持可见

const MACOS_TITLE_BAR_SAFE_AREA_START = 80; // macOS 左侧为原生红绿灯预留安全区
const TITLE_BAR_SAFE_AREA_NONE = 0;
const OVERLAY_TITLE_BAR_SAFE_AREA_END = 144;

const LIGHT_TITLE_BAR_OVERLAY_COLOR = "#F3F4F6"; // 原生底色对应 `src/frontend/index.css` 的 `:root --background`
const LIGHT_TITLE_BAR_SYMBOL_COLOR = "#1F2329";
const DARK_TITLE_BAR_OVERLAY_COLOR = "#111318"; // 原生底色对应 `src/frontend/index.css` 的 `.dark --background`
const DARK_TITLE_BAR_SYMBOL_COLOR = "#EEF2F7";

export type DesktopTitleBarOverlayTheme = {
  color: string; // 原生标题栏背景色
  symbolColor: string; // 原生窗口控制按钮颜色
  height: number; // 原生 overlay 高度
};

// 只有 Windows/Linux 使用 Electron 原生 overlay，macOS 走系统 inset 标题栏
export function uses_title_bar_overlay(platform: DesktopPlatform): boolean {
  return platform === "win32" || platform === "linux";
}

// preload 暴露完整 shell 快照，renderer 不再重复计算平台布局规则
export function resolve_desktop_shell_info(platform: DesktopPlatform): DesktopShellInfo {
  const is_macos = platform === "darwin";
  const uses_overlay = uses_title_bar_overlay(platform); // Windows/Linux 的原生控制按钮位于右侧
  return {
    platform,
    usesTitleBarOverlay: uses_overlay,
    titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
    titleBarControlSide: is_macos ? "left" : uses_overlay ? "right" : "none",
    titleBarSafeAreaStart: is_macos ? MACOS_TITLE_BAR_SAFE_AREA_START : TITLE_BAR_SAFE_AREA_NONE,
    titleBarSafeAreaEnd: uses_overlay ? OVERLAY_TITLE_BAR_SAFE_AREA_END : TITLE_BAR_SAFE_AREA_NONE,
  };
}

// main 把网页明暗主题映射成 Electron 原生 overlay 可消费的稳定配色对象
export function resolve_title_bar_overlay_theme(
  theme_mode: ResolvedThemeMode,
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
