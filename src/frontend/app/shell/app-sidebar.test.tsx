import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";
import { normalize_setting_snapshot } from "@domain/setting";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import {
  ProjectLifecycleContext,
  type ProjectLifecycle,
} from "../session/project-lifecycle/project-lifecycle-context";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppLanguage } from "@domain/app-language";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { NAVIGATION_GROUPS } from "@frontend/app/navigation/schema";
import { AppSidebar } from "./app-sidebar";

vi.mock("./app-appearance-menu", () => ({ AppAppearanceMenu: () => null }));

const api_fetch_mock = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/desktop/desktop-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@frontend/app/desktop/desktop-api")>();
  return { ...actual, api_fetch: api_fetch_mock };
});

const project_state = vi.hoisted(() => ({
  open_projects: [] as ProjectStore[],
  active_project: undefined as ProjectStore | undefined,
  settings_snapshot: { recent_projects: [] as { path: string; name: string }[] },
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => project_state,
  useRuntimeSnapshot: () => ({}),
}));

const lifecycle: ProjectLifecycle = {
  busy: false,
  attention: 0,
  notify_project_required: vi.fn(),
  show_create_dialog: vi.fn(),
  create_from_paths: vi.fn(),
  request_open: vi.fn(),
  open_recent_project: vi.fn(),
  remove_recent_project: vi.fn(),
  request_close: vi.fn(),
};

type RenderSidebarOptions = Partial<ComponentProps<typeof AppSidebar>>;

describe("AppSidebar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());

    project_state.open_projects = [];
    project_state.active_project = undefined;
    project_state.settings_snapshot.recent_projects = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
            <ProjectLifecycleContext value={lifecycle}>
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
            </ProjectLifecycleContext>
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
    const narrowest = resize.getAttribute("aria-valuemin");
    await act(async () =>
      resize.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    expect(resize.getAttribute("aria-valuenow")).toBe(narrowest);
    const widest = resize.getAttribute("aria-valuemax");
    await act(async () =>
      resize.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    );
    expect(resize.getAttribute("aria-valuenow")).toBe(widest);

    await act(async () => root?.unmount());
    root = createRoot(container!);
    await render_sidebar();
    expect(
      container!.querySelector('[role="separator"][tabindex="0"]')?.getAttribute("aria-valuenow"),
    ).toBe(widest);
  });
  it("打开工程排在最近工程之前，导航与工程只显示一个选中态", async () => {
    const first = new ProjectStore({
      projectId: "first",
      name: "翻译.lg",
      path: "E:/翻译.lg",
      loaded: true,
      file_count: 0,
      languages: null,
    });
    const second = new ProjectStore({
      ...first.snapshot,
      projectId: "second",
      name: "校对.lg",
      path: "E:/校对.lg",
    });
    project_state.active_project = first;
    project_state.open_projects = [first, second];
    project_state.settings_snapshot = normalize_setting_snapshot({
      recent_projects: [{ path: "E:/最近.lg" }, { path: first.snapshot.path }],
    });
    const select = vi.fn(async () => {});
    await render_sidebar({
      groups: NAVIGATION_GROUPS,
      projects: { project_view_active: true, select },
    });
    const rows = Array.from(
      container!.querySelectorAll<HTMLButtonElement>(".sidebar-project-item > button"),
    );
    expect(rows.map((row) => row.textContent)).toEqual(["翻译.lg", "校对.lg", "最近.lg"]);
    expect(Array.from(container!.querySelectorAll('[aria-current="page"]'))).toEqual([rows[0]]);
    await render_sidebar({
      groups: NAVIGATION_GROUPS,
      selected_route: "skills",
      projects: { project_view_active: false, select },
    });
    expect(
      Array.from(container!.querySelectorAll('[aria-current="page"]')).map(
        (row) => row.textContent,
      ),
    ).toEqual(["技能"]);
  });

  it("工程区标题栏提供新建与打开按钮，更多菜单按固定顺序展示", async () => {
    const first = new ProjectStore({
      projectId: "first",
      name: "翻译.lg",
      path: "E:/翻译.lg",
      loaded: true,
      file_count: 0,
      languages: null,
    });
    project_state.active_project = first;
    project_state.open_projects = [first];
    await render_sidebar({
      projects: { project_view_active: true, select: vi.fn(async () => {}) },
    });

    const header = container!.querySelector(".sidebar-projects__header")!;
    expect(header.textContent).toBe("工程");
    expect(
      header.querySelector(".sidebar-projects__header-actions")?.hasAttribute("data-attention"),
    ).toBe(false);
    await act(async () => {
      header.querySelector<HTMLButtonElement>('button[aria-label="创建工程"]')?.click();
      header.querySelector<HTMLButtonElement>('button[aria-label="打开工程"]')?.click();
    });
    expect(lifecycle.show_create_dialog).toHaveBeenCalledOnce();
    expect(lifecycle.request_open).toHaveBeenCalledOnce();

    const prev_actions = header.querySelector(".sidebar-projects__header-actions");
    await act(async () => {
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <ProjectLifecycleContext value={{ ...lifecycle, attention: 1 }}>
              <AppSidebar
                groups={[]}
                projects={{ project_view_active: true, select: vi.fn(async () => {}) }}
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
              />
            </ProjectLifecycleContext>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
    const next_actions = container!.querySelector(".sidebar-projects__header-actions");
    expect(next_actions?.hasAttribute("data-attention")).toBe(true);
    expect(next_actions).not.toBe(prev_actions);

    const more = container!.querySelector<HTMLButtonElement>(
      '.sidebar-project-item button[aria-label="更多"]',
    )!;
    await act(async () => more.click());
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]'), (item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["关闭工程", "从列表移除", "打开文件目录"]);
  });

  it("点击关闭态工程先弹出双列预览确认框，确认后才打开", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      preview: {
        file_paths: ["a.txt"],
        created_at: "2026-11-24T17:23:15",
        updated_at: "2026-11-24T17:53:28",
        translation_stats: build_project_translation_stats([]),
      },
    });
    project_state.settings_snapshot = normalize_setting_snapshot({
      recent_projects: [{ path: "E:/最近.lg" }],
    });
    await render_sidebar({
      projects: { project_view_active: false, select: vi.fn(async () => {}) },
    });

    const row = container!.querySelector<HTMLButtonElement>(".sidebar-project-item > button")!;
    await act(async () => row.click());
    expect(lifecycle.open_recent_project).not.toHaveBeenCalled();

    const dialog = document.querySelector('[data-slot="alert-dialog-content"]')!;
    expect(dialog.textContent).toContain("E:/最近.lg");
    expect(dialog.textContent).toContain("1 个文件");
    const primary = dialog.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    expect(primary.textContent).toContain("打开");

    await act(async () => primary.click());
    expect(lifecycle.open_recent_project).toHaveBeenCalledExactlyOnceWith("E:/最近.lg");
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("点击失效的关闭态工程时直接回退到移除确认流程", async () => {
    api_fetch_mock.mockRejectedValueOnce(new DesktopApiError({ code: "project.not_found" }));
    project_state.settings_snapshot = normalize_setting_snapshot({
      recent_projects: [{ path: "E:/失效.lg" }],
    });
    await render_sidebar({
      projects: { project_view_active: false, select: vi.fn(async () => {}) },
    });

    const row = container!.querySelector<HTMLButtonElement>(".sidebar-project-item > button")!;
    await act(async () => row.click());

    expect(lifecycle.open_recent_project).toHaveBeenCalledExactlyOnceWith("E:/失效.lg");
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("侧栏底部也接收单个工程文件", async () => {
    vi.stubGlobal(
      "desktopApp",
      create_desktop_bridge_api_mock({
        methods: { getPathForFile: (file) => `E:/${file.name}` },
      }),
    );
    await render_sidebar({ projects: { project_view_active: false, select: vi.fn() } });
    const footer = container!.querySelector("footer")!;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["Files"], files: [new File([], "工程.LG")] },
    });
    await act(async () => footer.dispatchEvent(event));
    expect(lifecycle.request_open).toHaveBeenCalledExactlyOnceWith("E:/工程.LG");
  });
});
