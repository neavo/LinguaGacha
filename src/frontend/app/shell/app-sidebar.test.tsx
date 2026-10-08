import { act, type ComponentProps } from "react";
import { ReplaceAll } from "lucide-react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppLanguage } from "@domain/app-language";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { SidebarProvider } from "@frontend/shadcn/sidebar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
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
                expanded_items={new Set()}
                disabled_route_ids={new Set()}
                app_language="ZH"
                is_language_updating={false}
                show_log_badge={false}
                profile_label_key="app.profile.status"
                profile_tooltip_key="app.profile.status_tooltip"
                is_profile_update_available={false}
                on_select_route={vi.fn()}
                on_toggle_group={vi.fn()}
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

  it("子导航提交页面选择，禁用项与折叠后的子项退出键盘导航", async () => {
    const on_select_route = vi.fn();
    const options: RenderSidebarOptions = {
      groups: [
        {
          id: "replacement",
          items: [
            {
              id: "text-replacement",
              title_key: "text_replacement_page.title",
              icon: ReplaceAll,
              children: [
                {
                  id: "pre-translation-replacement",
                  title_key: "pre_translation_replacement_page.title",
                  icon: ReplaceAll,
                },
                {
                  id: "post-translation-replacement",
                  title_key: "post_translation_replacement_page.title",
                  icon: ReplaceAll,
                },
              ],
            },
          ],
        },
      ],
      expanded_items: new Set(["text-replacement"]),
      disabled_route_ids: new Set(["post-translation-replacement"]),
      on_select_route,
    };
    await render_sidebar(options);
    const [enabled_child, disabled_child] = Array.from(
      container?.querySelectorAll<HTMLButtonElement>(".sidebar-subitems button") ?? [],
    );
    if (enabled_child === undefined || disabled_child === undefined)
      throw new Error("缺少测试子导航。");
    expect(enabled_child.tabIndex).toBe(0);
    expect(disabled_child.disabled).toBe(true);
    await act(async () => {
      enabled_child.click();
      disabled_child.click();
    });
    expect(on_select_route).toHaveBeenCalledExactlyOnceWith("pre-translation-replacement");

    await render_sidebar(options, false);
    expect([enabled_child.tabIndex, disabled_child.tabIndex]).toEqual([-1, -1]);
    expect(enabled_child.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
  });
});
