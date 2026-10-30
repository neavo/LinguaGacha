import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { SidebarProvider } from "@frontend/shadcn/sidebar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AppAppearanceMenu } from "./app-appearance-menu";

const appearance = vi.hoisted(() => ({
  font_size_preference: "normal",
  set_font_size_preference: vi.fn(),
  font_preference: "lg-base" as "lg-base" | "system",
  theme_preference: "system" as "system" | "light" | "dark",
  set_font_preference: vi.fn(),
  set_theme_preference: vi.fn(),
}));

vi.mock("@frontend/app/appearance/appearance-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@frontend/app/appearance/appearance-context")>()),
  useAppearance: () => appearance,
}));

describe("AppAppearanceMenu", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    appearance.set_font_size_preference.mockReset();
    appearance.set_font_preference.mockReset();
    appearance.set_theme_preference.mockReset();
  });

  /** 挂载真实菜单，沿用户入口验证外观偏好的提交。 */
  async function render_menu(open = true): Promise<HTMLButtonElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <SidebarProvider open={open}>
              <AppAppearanceMenu is_collapsed={!open} />
            </SidebarProvider>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
    return container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  }

  /** 通过可见文字选择选项，断言只锁定提交的持久化编码。 */
  function find_option(label: string): HTMLElement {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((candidate) => candidate.textContent?.trim() === label);
    if (option === undefined) {
      throw new Error(`缺少外观选项：${label}`);
    }
    return option;
  }

  it("折叠时悬停显示外观提示，选择选项后提交字体和主题偏好", async () => {
    const trigger = await render_menu(false);
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"][data-open]')?.textContent).toBe(
      trigger.getAttribute("aria-label"),
    );
    await act(async () => trigger.click());
    await act(async () => {
      find_option("系统字体").click();
    });

    await act(async () => trigger.click());
    await act(async () => {
      find_option("深色").click();
    });

    expect(appearance.set_font_preference).toHaveBeenCalledWith("system");
    expect(appearance.set_theme_preference).toHaveBeenCalledWith("dark");
  });
  it("选择字体大小时提交对应的持久化编码", async () => {
    const trigger = await render_menu();
    await act(async () => trigger.click());
    await act(async () => {
      find_option("更大字体").click();
    });
    expect(appearance.set_font_size_preference).toHaveBeenCalledWith("largest");
  });
});
