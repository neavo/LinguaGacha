import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppLanguage } from "@domain/app-language";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { SidebarProvider } from "@frontend/shadcn/sidebar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { NAVIGATION_GROUPS } from "@frontend/app/navigation/schema";
import { AppSidebar } from "./app-sidebar";

vi.mock("./app-appearance-menu", () => ({ AppAppearanceMenu: () => null }));

type RenderSidebarOptions = Partial<ComponentProps<typeof AppSidebar>>;

describe("AppSidebar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());

    container?.remove();
    root = null;
    container = null;
  });

  /** 复用同一挂载点，验证宿主更新侧栏与导航状态后的交互。 */
  async function render_sidebar(options: RenderSidebarOptions = {}, open = true): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <SidebarProvider open={open}>
              <AppSidebar
                groups={[]}
                selected_route="project-home"
                disabled_route_ids={new Set()}
                app_language="ZH"
                is_language_updating={false}
                show_log_badge={false}
                profile_label_key="app.profile.status"
                profile_tooltip_key="app.profile.status_tooltip"
                is_profile_update_available={false}
                on_select_route={vi.fn()}
                on_open_logs={vi.fn()}
                on_select_app_language={vi.fn()}
                on_profile_action={vi.fn()}
                {...options}
              />
            </SidebarProvider>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
  }

  /** 从用户可见入口打开语言菜单。 */
  async function open_language_menu(): Promise<void> {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="字字珠玑"]');
    if (trigger === null) {
      throw new Error("缺少界面语言菜单按钮。");
    }

    await act(async () => {
      trigger.click();
    });
  }

  it("选择语言自称后提交对应的持久化编码", async () => {
    const selected_languages: AppLanguage[] = [];
    await render_sidebar({
      on_select_app_language: (language) => {
        selected_languages.push(language);
      },
    });
    await open_language_menu();

    const language_option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((option) => option.textContent?.trim() === "日本語");
    if (language_option === undefined) {
      throw new Error("缺少日文界面语言选项。");
    }

    await act(async () => {
      language_option.click();
    });

    expect(selected_languages).toEqual(["JA"]);
  });

  it("语言设置更新期间禁用菜单按钮", async () => {
    await render_sidebar({ is_language_updating: true });

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="字字珠玑"]');
    expect(trigger?.disabled).toBe(true);
  });

  it("点击日志按钮直接打开日志窗口", async () => {
    const on_open_logs = vi.fn();
    await render_sidebar({ on_open_logs });

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="日志"]');
    await act(async () => {
      trigger?.click();
    });

    expect(on_open_logs).toHaveBeenCalledOnce();
  });

  it("侧栏折叠时导航入口仍可直接选择并独立高亮", async () => {
    const on_select_route = vi.fn();
    await render_sidebar(
      {
        groups: NAVIGATION_GROUPS,
        selected_route: "post-translation-replacement",
        on_select_route,
      },
      false,
    );
    const pre = container!.querySelector<HTMLButtonElement>('button[aria-label="译前替换"]')!;
    const post = container!.querySelector<HTMLButtonElement>('button[aria-label="译后替换"]')!;
    expect(pre.getAttribute("data-active")).toBe("false");
    expect(post.getAttribute("data-active")).toBe("true");
    await act(async () => {
      pre.click();
      post.click();
    });
    expect(on_select_route.mock.calls).toEqual([
      ["pre-translation-replacement"],
      ["post-translation-replacement"],
    ]);
  });

  it("禁用的替换入口不提交页面选择", async () => {
    const on_select_route = vi.fn();
    await render_sidebar({
      groups: NAVIGATION_GROUPS,
      disabled_route_ids: new Set(["pre-translation-replacement", "post-translation-replacement"]),
      on_select_route,
    });
    const pre = container!.querySelector<HTMLButtonElement>('button[aria-label="译前替换"]')!;
    const post = container!.querySelector<HTMLButtonElement>('button[aria-label="译后替换"]')!;
    expect(pre.disabled).toBe(true);
    expect(post.disabled).toBe(true);
    await act(async () => {
      pre.click();
      post.click();
    });
    expect(on_select_route).not.toHaveBeenCalled();
  });
});
