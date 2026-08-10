import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppLanguage } from "@domain/app-language";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { BOTTOM_ACTIONS } from "@frontend/app/navigation/schema";
import { SidebarProvider } from "@frontend/shadcn/sidebar";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AppSidebar } from "./app-sidebar";

type RenderSidebarOptions = {
  app_language?: AppLanguage;
  is_language_updating?: boolean;
  on_select_app_language?: (language: AppLanguage) => void;
};

describe("AppSidebar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  async function render_sidebar(options: RenderSidebarOptions = {}): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <SidebarProvider open>
              <AppSidebar
                groups={[]}
                bottom_actions={BOTTOM_ACTIONS}
                selected_route="project-home"
                expanded_items={new Set()}
                disabled_route_ids={new Set()}
                disabled_bottom_action_ids={
                  options.is_language_updating ? new Set(["language"]) : new Set()
                }
                badged_bottom_action_ids={new Set()}
                app_language={options.app_language ?? "ZH"}
                profile_label_key="app.profile.status"
                profile_tooltip_key="app.profile.status_tooltip"
                is_profile_update_available={false}
                on_select_route={vi.fn()}
                on_toggle_group={vi.fn()}
                on_bottom_action={vi.fn()}
                on_appearance_menu_action={vi.fn()}
                on_select_app_language={options.on_select_app_language ?? vi.fn()}
                on_profile_action={vi.fn()}
              />
            </SidebarProvider>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
  }

  async function open_language_menu(): Promise<void> {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="字字珠玑"]');
    if (trigger === null) {
      throw new Error("缺少界面语言菜单按钮。");
    }

    await act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
  }

  it("选择语言后提交明确的应用语言", async () => {
    const selected_languages: AppLanguage[] = [];
    await render_sidebar({
      on_select_app_language: (language) => {
        selected_languages.push(language);
      },
    });
    await open_language_menu();

    const german_option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ).find((option) => option.textContent?.trim() === "Deutsch");
    if (german_option === undefined) {
      throw new Error("缺少德文界面语言选项。");
    }

    await act(async () => {
      german_option.click();
    });

    expect(selected_languages).toEqual(["DE"]);
  });

  it("语言设置更新期间禁用菜单按钮", async () => {
    await render_sidebar({ is_language_updating: true });

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="字字珠玑"]');
    expect(trigger?.disabled).toBe(true);
  });
});
