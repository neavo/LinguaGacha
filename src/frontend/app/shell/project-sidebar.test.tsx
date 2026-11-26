import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import type { AgentDecisionCountdownSnapshot } from "@frontend/app/session/agent/agent-decision-countdown";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { create_text_resolver } from "@shared/i18n";
import { build_project_translation_stats } from "@shared/project-translation-stats";
import type { ProjectActivity } from "@shared/runtime-activity";
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
  activity: {} as Record<string, ProjectActivity>,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => project_state,
  useRuntimeSnapshot: () => ({ projects: project_state.activity }),
}));

const lifecycle: ProjectLifecycle = {
  busy: false,
  request_create: vi.fn(),
  create_for_agent: vi.fn(async () => null),
  request_open: vi.fn(),
  open_recent_project: vi.fn(),
  remove_recent_project: vi.fn(),
  request_close: vi.fn(),
  request_rename: vi.fn(),
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
    project_state.activity = {};
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

  async function open_project_menu(row: number): Promise<HTMLElement[]> {
    const trigger = container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')[
      row
    ]!;
    await act(async () => trigger.click());
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  it.each([
    ["打开空闲", true, false, [false, false, true, false]],
    ["打开忙碌", true, true, [true, true, true, false]],
    ["关闭", false, false, [true, false, false, false]],
  ])("工程菜单在%s时保留四个操作", async (_label, opened, busy, disabled) => {
    if (opened) project_state.open_projects = [opened_project("first", "翻译.lg")];
    else project_state.settings_snapshot.recent_projects = [recent_project];
    if (busy)
      project_state.activity.first = { agent: true, batchTranslation: false, projectWrite: false };

    await render_project_sidebar();
    const items = await open_project_menu(0);
    const t = create_text_resolver("zh-CN");
    expect(items.map((item) => item.textContent)).toEqual([
      t("project.close.action"),
      t("app.workspace.remove_recent"),
      t("project.rename"),
      t("app.workspace.reveal_path"),
    ]);
    expect(items.map((item) => item.getAttribute("aria-disabled") === "true")).toEqual(disabled);
    if (!opened) {
      await act(async () => items[2]!.click());
      expect(lifecycle.request_rename).toHaveBeenCalledWith(
        recent_project.path,
        recent_project.name,
      );
    }
  });

  it("已打开工程排在最近工程之前，只有工程视图高亮当前工程", async () => {
    const first = opened_project("first", "翻译.lg");
    const second = opened_project("second", "校对.lg");
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

    expect(lifecycle.request_create).toHaveBeenCalledOnce();
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

  it("后台工程独立显示决策倒计时，结束后恢复状态灯", async () => {
    const first = opened_project("first", "前台工程.lg");
    const second = opened_project("second", "后台工程.lg");
    const set_countdown = attach_countdown_source(second);
    project_state.active_project = first;
    project_state.open_projects = [first, second];

    await render_project_sidebar(true);
    const [foreground, background] = container.querySelectorAll(".sidebar-project-item > button");
    await act(async () =>
      set_countdown({ id: "question-bg", remainingSeconds: 240, remainingPercent: 80 }),
    );
    expect(foreground?.querySelector(".status-mark")).toBeInstanceOf(HTMLElement);
    expect(background?.querySelector(".status-mark")).toBeNull();
    expect(background?.querySelector('.countdown-ring[aria-hidden="true"]')).not.toBeNull();
    expect(background?.textContent).toBe(second.snapshot.name);

    await act(async () => set_countdown(null));
    expect(background?.querySelector(".countdown-ring")).toBeNull();
    expect(background?.querySelector(".status-mark")).not.toBeNull();
  });
});

/** 以同一份最小工程数据构造独立会话。 */
function opened_project(projectId: string, name: string): ProjectStore {
  return new ProjectStore({
    projectId,
    name,
    path: `E:/${name}`,
    loaded: true,
    file_count: 0,
    quality_rule_counts: { glossary: 0, text_preserve: 0, pre_replacement: 0, post_replacement: 0 },
    settings: null,
  });
}

/** 通过公开倒计时切片契约驱动外部订阅，避免在侧栏测试中耦合 SSE 恢复协议。 */
function attach_countdown_source(
  project: ProjectStore,
): (next: AgentDecisionCountdownSnapshot) => void {
  let snapshot: AgentDecisionCountdownSnapshot = null;
  const listeners = new Set<() => void>();
  vi.spyOn(project.agentChat, "get_countdown").mockImplementation(() => snapshot);
  vi.spyOn(project.agentChat, "subscribe_countdown").mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  return (next) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
}
