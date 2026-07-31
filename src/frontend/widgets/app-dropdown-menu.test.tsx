import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("radix-ui", () => ({
  DropdownMenu: {
    SubContent: (props: { children?: ReactNode; "data-slot"?: string; sideOffset?: number }) => (
      <div data-slot={props["data-slot"]} data-side-offset={props.sideOffset}>
        {props.children}
      </div>
    ),
  },
}));

import { AppDropdownMenuSubContent } from "./app-dropdown-menu";

describe("AppDropdownMenuSubContent", () => {
  it("默认在母菜单外侧留出间距并允许调用方覆盖", () => {
    const default_html = renderToStaticMarkup(
      <AppDropdownMenuSubContent>默认间距</AppDropdownMenuSubContent>,
    );
    const custom_html = renderToStaticMarkup(
      <AppDropdownMenuSubContent sideOffset={12}>自定义间距</AppDropdownMenuSubContent>,
    );

    expect(default_html).toContain('data-side-offset="8"');
    expect(custom_html).toContain('data-side-offset="12"');
  });
});
