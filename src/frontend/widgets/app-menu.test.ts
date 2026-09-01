import { describe, expect, it } from "vitest";

import { should_keep_submenu_open } from "./app-menu";

describe("应用二级菜单", () => {
  it("只忽略关闭期间由父子浮层焦点交接产生的关闭信号", () => {
    expect(should_keep_submenu_open(false, "focus-out")).toBe(true);
    expect(should_keep_submenu_open(true, "focus-out")).toBe(false);
    expect(should_keep_submenu_open(false, "trigger-press")).toBe(false);
  });
});
