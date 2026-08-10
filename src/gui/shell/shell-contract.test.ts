import { describe, expect, it } from "vitest";

import { DESKTOP_TITLE_BAR_HEIGHT, resolve_desktop_shell_info } from "./shell-contract";

describe("桌面壳层契约", () => {
  it("按平台为原生窗口控制区留出安全区域", () => {
    const mac_shell_info = resolve_desktop_shell_info("darwin");

    expect(mac_shell_info).toMatchObject({
      platform: "darwin",
      usesTitleBarOverlay: false,
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      titleBarControlSide: "left",
    });
    expect(mac_shell_info.titleBarSafeAreaStart).toBeGreaterThan(
      mac_shell_info.titleBarSafeAreaEnd,
    );

    const windows_shell_info = resolve_desktop_shell_info("win32");

    expect(windows_shell_info).toMatchObject({
      usesTitleBarOverlay: true,
      titleBarControlSide: "right",
    });
    expect(windows_shell_info.titleBarSafeAreaStart).toBeLessThan(
      windows_shell_info.titleBarSafeAreaEnd,
    );
  });
});
