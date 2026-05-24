import { describe, expect, it } from "vitest";

import { DESKTOP_BRIDGE_GLOBAL_NAME } from "./bridge-api";

describe("DesktopBridgeApi contract", () => {
  it("固定 preload 暴露给 renderer 的全局名称", () => {
    expect(DESKTOP_BRIDGE_GLOBAL_NAME).toBe("desktopApp");
  });
});
