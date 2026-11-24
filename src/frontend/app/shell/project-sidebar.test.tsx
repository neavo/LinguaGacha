import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import {
  ProjectLifecycleContext,
  type ProjectLifecycle,
} from "../session/project-lifecycle/project-lifecycle-context";
import { ProjectSidebar } from "./project-sidebar";

const api_fetch_mock = vi.hoisted(() => vi.fn());
vi.mock("@frontend/app/desktop/desktop-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: api_fetch_mock,
}));

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

const recent_project = { path: "E:/最近.lg", name: "最近.lg" };

describe("ProjectSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    project_state.open_projects = [];
    project_state.active_project = undefined;
    project_state.settings_snapshot.recent_projects = [];
    vi.resetAllMocks();
  });

  async function render_project_sidebar(project_view_active = false): Promise<void> {
    await act(async () => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <ProjectLifecycleContext value={lifecycle}>
              <ProjectSidebar project_view_active={project_view_active} select={async () => {}} />
            </ProjectLifecycleContext>
          </TooltipProvider>
        </LocaleProvider>,
      );
    });
  }

  it("已打开工程排在最近工程之前，只有工程视图高亮当前工程", async () => {
    const first = new ProjectStore({
      projectId: "first",
      name: "翻译.lg",
      path: "E:/翻译.lg",
      loaded: true,
      file_count: 0,
      quality_rule_counts: {
        glossary: 0,
        text_preserve: 0,
        pre_replacement: 0,
        post_replacement: 0,
      },
      settings: null,
    });
    const second = new ProjectStore({
      ...first.snapshot,
      projectId: "second",
      name: "校对.lg",
      path: "E:/校对.lg",
    });
    project_state.active_project = first;
    project_state.open_projects = [first, second];
    project_state.settings_snapshot.recent_projects = [recent_project, first.snapshot];

    await render_project_sidebar(true);
    const rows = Array.from(container.querySelectorAll(".sidebar-project-item > button"));
    expect(rows.map((row) => row.textContent)).toEqual([
      first.snapshot.name,
      second.snapshot.name,
      recent_project.name,
    ]);
    expect(Array.from(container.querySelectorAll('[aria-current="page"]'))).toEqual([rows[0]]);

    await render_project_sidebar();
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("侧栏按钮发起新建与打开工程流程", async () => {
    await render_project_sidebar();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="创建工程"]')!.click();
      container.querySelector<HTMLButtonElement>('button[aria-label="打开工程"]')!.click();
    });

    expect(lifecycle.show_create_dialog).toHaveBeenCalledOnce();
    expect(lifecycle.request_open).toHaveBeenCalledOnce();
  });

  it("点击最近工程后预览目标，确认后才打开", async () => {
    api_fetch_mock.mockResolvedValueOnce({
      preview: {
        file_paths: ["a.txt"],
        created_at: "2026-11-24T17:23:15",
        updated_at: "2026-11-24T17:53:28",
        translation_stats: build_project_translation_stats([]),
      },
    });
    project_state.settings_snapshot.recent_projects = [recent_project];
    await render_project_sidebar();

    const row = container.querySelector<HTMLButtonElement>(".sidebar-project-item > button")!;
    await act(async () => row.click());
    expect(lifecycle.open_recent_project).not.toHaveBeenCalled();

    const dialog = document.querySelector('[data-slot="alert-dialog-content"]')!;
    expect(dialog.textContent).toContain(recent_project.path);
    const confirm = dialog.querySelector<HTMLButtonElement>(
      '[data-slot="alert-dialog-primary-action"]',
    )!;
    await act(async () => confirm.click());

    expect(lifecycle.open_recent_project).toHaveBeenCalledExactlyOnceWith(recent_project.path);
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("最近工程缺失时转交工程流程处理", async () => {
    api_fetch_mock.mockRejectedValueOnce(new DesktopApiError({ code: "project.not_found" }));
    project_state.settings_snapshot.recent_projects = [recent_project];
    await render_project_sidebar();

    const row = container.querySelector<HTMLButtonElement>(".sidebar-project-item > button")!;
    await act(async () => row.click());

    expect(lifecycle.open_recent_project).toHaveBeenCalledExactlyOnceWith(recent_project.path);
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });

  it("从工程空态切换为最近工程列表", async () => {
    await render_project_sidebar();
    expect(container.querySelector(".sidebar-projects__empty")).not.toBeNull();

    project_state.settings_snapshot.recent_projects = [recent_project];
    await render_project_sidebar();

    expect(container.querySelector(".sidebar-projects__empty")).toBeNull();
    expect(container.querySelector(".sidebar-project-item > button")?.textContent).toBe(
      recent_project.name,
    );
  });
});
