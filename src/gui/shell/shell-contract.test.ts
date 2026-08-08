import { describe, expect, it } from "vitest";

import {
  DESKTOP_TITLE_BAR_HEIGHT,
  DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  resolve_desktop_shell_info,
  resolve_title_bar_overlay_theme,
} from "./shell-contract";

describe("桌面壳层契约", () => {
  it("为 macOS 预留左侧原生控制区", () => {
    const shell_info = resolve_desktop_shell_info("darwin");

    expect(shell_info).toMatchObject({
      platform: "darwin",
      usesTitleBarOverlay: false,
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      titleBarControlSide: "left",
    });
    expect(shell_info.titleBarSafeAreaStart).toBeGreaterThan(shell_info.titleBarSafeAreaEnd);
  });

  it("为 Windows/Linux 预留右侧 overlay 控制区", () => {
    const shell_info = resolve_desktop_shell_info("win32");

    expect(shell_info).toMatchObject({
      usesTitleBarOverlay: true,
      titleBarControlSide: "right",
    });
    expect(shell_info.titleBarSafeAreaStart).toBeLessThan(shell_info.titleBarSafeAreaEnd);
  });

  it("生成固定高度且明暗可区分的原生 overlay 主题", () => {
    const light_theme = resolve_title_bar_overlay_theme("light");
    const dark_theme = resolve_title_bar_overlay_theme("dark");

    expect(light_theme.height).toBe(DESKTOP_TITLE_BAR_OVERLAY_HEIGHT);
    expect(dark_theme.height).toBe(DESKTOP_TITLE_BAR_OVERLAY_HEIGHT);
    expect(light_theme.color).not.toBe(light_theme.symbolColor);
    expect(dark_theme.color).not.toBe(dark_theme.symbolColor);
    expect(dark_theme).not.toEqual(light_theme);
  });
});
