import { describe, expect, it } from "vitest";

import {
  DESKTOP_TITLE_BAR_HEIGHT,
  DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
  resolve_desktop_shell_info,
  resolve_title_bar_overlay_theme,
} from "./shell-contract";

describe("桌面壳层契约", () => {
  it("为 macOS 预留左侧原生控制区", () => {
    expect(resolve_desktop_shell_info("darwin")).toEqual({
      platform: "darwin",
      usesTitleBarOverlay: false,
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      titleBarControlSide: "left",
      titleBarSafeAreaStart: 80,
      titleBarSafeAreaEnd: 0,
    });
  });

  it("为 Windows/Linux 预留右侧 overlay 控制区", () => {
    expect(resolve_desktop_shell_info("win32")).toMatchObject({
      usesTitleBarOverlay: true,
      titleBarControlSide: "right",
      titleBarSafeAreaStart: 0,
      titleBarSafeAreaEnd: 144,
    });
  });

  it("让原生 overlay 高度比网页标题栏少 1px", () => {
    expect(resolve_title_bar_overlay_theme("light")).toEqual({
      color: "#F4F5F7",
      symbolColor: "#1F2329",
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    });
    expect(resolve_title_bar_overlay_theme("dark")).toEqual({
      color: "#121319",
      symbolColor: "#EEF2F7",
      height: DESKTOP_TITLE_BAR_OVERLAY_HEIGHT,
    });
  });
});
