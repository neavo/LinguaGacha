import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it } from "vitest";

import { open_context_menu_at_click_position, should_keep_submenu_open } from "./app-menu";

describe("应用二级菜单", () => {
  it("只忽略关闭期间由父子浮层焦点交接产生的关闭信号", () => {
    expect(should_keep_submenu_open(false, "focus-out")).toBe(true);
    expect(should_keep_submenu_open(true, "focus-out")).toBe(false);
    expect(should_keep_submenu_open(false, "trigger-press")).toBe(false);
  });
});

describe("点击打开右键菜单", () => {
  it.each([
    { name: "鼠标点击沿用指针位置", detail: 1, expected: [5, 6] },
    { name: "键盘激活以按钮中心定位", detail: 0, expected: [120, 210] },
  ])("$name", ({ detail, expected }) => {
    const button = document.createElement("button");
    button.getBoundingClientRect = () => new DOMRect(100, 200, 40, 20);
    const positions: number[][] = [];
    button.addEventListener("contextmenu", (event) =>
      positions.push([event.clientX, event.clientY]),
    );
    open_context_menu_at_click_position({
      currentTarget: button,
      detail,
      clientX: 5,
      clientY: 6,
      preventDefault: () => {},
    } as unknown as ReactMouseEvent<HTMLButtonElement>);
    expect(positions).toEqual([expected]);
  });
});
