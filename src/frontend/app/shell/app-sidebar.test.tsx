import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppLanguage } from "@domain/app-language";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
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
    window.localStorage.removeItem("lg-sidebar-width");
    root = null;
    container = null;
  });

  /** 复用同一挂载点，验证宿主更新侧栏与导航状态后的交互。 */
  async function render_sidebar(options: RenderSidebarOptions = {}): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <AppSidebar
              groups={[]}
              selected_route="agent"
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
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
  }

  it("选择语言后提交对应的持久化编码", async () => {
    const selected_languages: AppLanguage[] = [];
    await render_sidebar({
      on_select_app_language: (language) => {
        selected_languages.push(language);
      },
    });
    const trigger = container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    await act(async () => trigger.click());

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

    const trigger = container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
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

  it("导航入口可直接选择并独立高亮", async () => {
    const on_select_route = vi.fn();
    await render_sidebar({
      groups: NAVIGATION_GROUPS,
      selected_route: "skills",
      on_select_route,
    });
    const pre = container!.querySelector<HTMLButtonElement>('button[aria-label="模型管理"]')!;
    const post = container!.querySelector<HTMLButtonElement>('button[aria-label="技能"]')!;
    expect(pre.getAttribute("data-active")).toBe("false");
    expect(post.getAttribute("data-active")).toBe("true");
    await act(async () => {
      pre.click();
      post.click();
    });
    expect(on_select_route.mock.calls).toEqual([["model"], ["skills"]]);
  });

  it("键盘调整侧栏宽度，并在重新挂载后恢复", async () => {
    await render_sidebar();
    const resize = container!.querySelector('[role="separator"][tabindex="0"]')!;
    const initial = resize.getAttribute("aria-valuenow");
    const widest = resize.getAttribute("aria-valuemax");
    await act(async () =>
      resize.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(Number(resize.getAttribute("aria-valuenow"))).toBeGreaterThan(Number(initial));
    expect(resize.getAttribute("aria-valuenow")).toBe(widest);

    await act(async () => root?.unmount());
    root = createRoot(container!);
    await render_sidebar();
    expect(
      container!.querySelector('[role="separator"][tabindex="0"]')?.getAttribute("aria-valuenow"),
    ).toBe(widest);
  });
});
