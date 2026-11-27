import { act, useEffect, useSyncExternalStore, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "@domain/project-settings";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppNavigationProvider } from "@frontend/app/navigation/navigation-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import type { RouteId } from "@frontend/app/navigation/types";
import { ProjectTranslationStatsContext } from "@frontend/app/session/project-translation-stats-context";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { createRuntimeActivityStore } from "@frontend/app/state/runtime-activity-store";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const leave = vi.hoisted(() => vi.fn<() => Promise<boolean>>(async () => true));
let runtime_activity: ReturnType<typeof createRuntimeActivityStore>;

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ commit_project_write: vi.fn() }),
  useRuntimeSnapshot: () =>
    useSyncExternalStore(runtime_activity.subscribe, runtime_activity.getSnapshot),
}));

/** 让 renderer 测试驱动工作区宽度变化。 */
class TestResizeObserver implements ResizeObserver {
  static instances: TestResizeObserver[] = [];

  private readonly callback: ResizeObserverCallback;
  private targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  static emit(target: Element, width: number): void {
    const entry = {
      target,
      contentRect: new DOMRect(0, 0, width, 800),
    } as ResizeObserverEntry;
    for (const instance of TestResizeObserver.instances) {
      if (instance.targets.has(target)) {
        instance.callback([entry], instance);
      }
    }
  }
}

vi.mock("@frontend/pages/agent-page/page", () => ({
  AgentPage: ({ tabHost }: { tabHost?: HTMLElement | null }) => {
    const { navigate_to_route } = useAppNavigation();
    const tab = (
      <button type="button" data-testid="agent-chat-tab" onClick={() => navigate_to_route("agent")}>
        对话
      </button>
    );
    return (
      <>
        {tabHost ? createPortal(tab, tabHost) : tab}
        <div data-testid="agent-view">agent</div>
      </>
    );
  },
}));

vi.mock("@frontend/app/navigation/screen-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@frontend/app/navigation/screen-registry")>();
  /** 测试子页仅验证挂载身份与离页保存契约，不耦合各业务页的远端数据依赖。 */
  function create_stub_page(id: RouteId): () => JSX.Element {
    return function StubPage(): JSX.Element {
      const { register_before_leave } = usePageLeave();
      useEffect(() => register_before_leave(leave), [register_before_leave]);
      return <div data-testid={`page-${id}`}>{id}</div>;
    };
  }
  return {
    SCREEN_REGISTRY: {
      ...actual.SCREEN_REGISTRY,
      proofreading: {
        ...actual.SCREEN_REGISTRY.proofreading,
        component: create_stub_page("proofreading"),
      },
      glossary: { ...actual.SCREEN_REGISTRY.glossary, component: create_stub_page("glossary") },
    },
  };
});

import { ProjectWorkspace } from "./project-workspace";

/** 由工程路由驱动页面，让测试通过实际离页入口切换。 */
function WorkspaceHarness({ project }: { project: ProjectStore }): JSX.Element {
  const active_route = useSyncExternalStore(project.subscribe_route, project.get_active_route);
  const { prepare_page_leave } = usePageLeave();

  function navigate(route_id: RouteId): void {
    void (async () => {
      if (
        route_id !== active_route &&
        !(await prepare_page_leave({ kind: "project", projectId: project.snapshot.projectId }))
      ) {
        return;
      }
      project.select_route(route_id);
    })();
  }

  return (
    <AppNavigationProvider
      project_id={project.snapshot.projectId}
      selected_route={active_route}
      navigate_to_route={navigate}
      agent_input_request={null}
      clear_agent_input_request={() => undefined}
    >
      <ProjectScopeContext
        key={project.snapshot.projectId}
        value={{ projectId: project.snapshot.projectId }}
      >
        <ProjectWorkspace project={project} selected={active_route} />
      </ProjectScopeContext>
    </AppNavigationProvider>
  );
}

describe("ProjectWorkspace 双功能块与预过滤确认框", () => {
  const partial_stats: ProjectTranslationStats = {
    total_items: 25,
    skipped_count: 1,
    completed_count: 8,
    pending_count: 16,
    completion_percent: 36,
  };
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    runtime_activity = createRuntimeActivityStore();
    vi.clearAllMocks();
    leave.mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    TestResizeObserver.instances = [];
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  function create_project(id = "project-1"): ProjectStore {
    return new ProjectStore({
      projectId: id,
      path: `E:/${id}.lg`,
      name: `${id}.lg`,
      loaded: true,
      file_count: 3,
      settings: DEFAULT_PROJECT_SETTINGS,
      quality_rule_counts: {
        glossary: 12,
        text_preserve: 0,
        pre_replacement: 4,
        post_replacement: 0,
      },
    });
  }

  async function mount(
    project: ProjectStore,
    translation_stats: ProjectTranslationStats | null = null,
  ): Promise<HTMLDivElement> {
    if (host === null) {
      host = document.body.appendChild(document.createElement("div"));
      root = createRoot(host);
    }
    await act(async () =>
      root?.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <PageLeaveProvider>
              <ProjectTranslationStatsContext value={translation_stats}>
                <WorkspaceHarness project={project} />
              </ProjectTranslationStatsContext>
            </PageLeaveProvider>
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );
    return host;
  }

  function group_panel(container: HTMLElement, id: "workbench" | "quality"): HTMLElement {
    return container.querySelector<HTMLElement>(
      `.project-workspace__tools-panel[data-group="${id}"]`,
    )!;
  }

  function group_trigger(container: HTMLElement, id: "workbench" | "quality"): HTMLButtonElement {
    return group_panel(container, id).querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;
  }

  function find_tool_item(container: HTMLElement, label: string): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>(".project-workspace__tool-item")].find(
      (item) => item.querySelector(".project-workspace__tool-label")?.textContent === label,
    )!;
  }

  it("校对菜单收到工程进度后共用行焦点、悬停提示与导航", async () => {
    const project = create_project();
    const container = await mount(project);
    const workbench = group_panel(container, "workbench");
    const trigger = group_trigger(container, "workbench");
    await act(async () => trigger.click());
    const item = find_tool_item(workbench, "校对");
    expect(item.querySelector(".app-badge")).toBeNull();

    await mount(project, partial_stats);
    const badge = item.querySelector<HTMLElement>(".app-badge")!;
    await act(async () => {
      item.focus();
      badge.focus();
    });
    expect(document.activeElement).toBe(item);
    await act(async () => item.blur());

    const label = item.querySelector(".project-workspace__tool-label")!;
    Object.defineProperty(label, "clientWidth", { value: 20 });
    Object.defineProperty(label, "scrollWidth", { value: 40 });

    const open_tooltip_texts = () =>
      Array.from(
        document.querySelectorAll('[role="tooltip"][data-open]'),
        (tip) => tip.textContent,
      );
    const progress_tip = expect.stringContaining(String(partial_stats.total_items));

    // jsdom 需要先派发冒泡的 mouseover，再派发各触发器的 mouseenter。
    const enter_badge = async (from: Element): Promise<void> => {
      await act(async () => {
        badge.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }));
        if (from === document.body)
          item.dispatchEvent(new MouseEvent("mouseenter", { relatedTarget: from }));
        badge.dispatchEvent(new MouseEvent("mouseenter", { relatedTarget: from }));
      });
    };
    await enter_badge(document.body);
    expect(open_tooltip_texts()).toEqual([progress_tip]);

    await act(async () => {
      badge.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: label }));
      label.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: badge }));
    });
    expect(open_tooltip_texts()).toEqual([label.textContent]);
    await enter_badge(label);
    expect(open_tooltip_texts()).toEqual([progress_tip]);

    await act(async () => badge.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();
    expect(trigger.querySelector(".app-badge")).toBeNull();
  });

  it("从工程快照显示规则条数，零条也可见", async () => {
    const container = await mount(create_project());
    await act(async () => group_trigger(container, "quality").click());
    expect(find_tool_item(container, "术语表").textContent).toContain("12");
    expect(find_tool_item(container, "文本保护").textContent).toContain("0");
  });

  it("本工程忙碌时在菜单和常驻卡片上禁用预过滤设置，空闲后恢复", async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const project = create_project();
    const container = await mount(project);
    const workspace = container.querySelector<HTMLDivElement>(".project-workspace")!;
    const quality = group_panel(container, "quality");
    const busy = { batchTranslation: true, agent: false, projectWrite: false };
    await act(async () => group_trigger(container, "quality").click());
    const disabled_labels = () =>
      [...quality.querySelectorAll("button:disabled .project-workspace__tool-label")].map(
        (label) => label.textContent,
      );
    const prefilter_labels = ["跳过重复原文", "MTool 优化器"];

    await act(async () =>
      runtime_activity.applySnapshot({
        revision: 1,
        projects: { [project.snapshot.projectId]: busy },
      }),
    );
    expect(disabled_labels()).toEqual(prefilter_labels);

    await act(async () => TestResizeObserver.emit(workspace, 1600));
    expect(quality.querySelector('[role="menu"]')).toBeNull();
    expect(disabled_labels()).toEqual(prefilter_labels);

    await act(async () =>
      runtime_activity.applySnapshot({ revision: 2, projects: { other: busy } }),
    );
    expect(disabled_labels()).toEqual([]);
  });

  it("窄态双 Tab 互斥展开并支持外部点击、Esc 与失焦收起，激活态与关闭按钮只归属对应组", async () => {
    const container = await mount(create_project());
    const workbench = group_panel(container, "workbench");
    const quality = group_panel(container, "quality");
    const workbench_trigger = group_trigger(container, "workbench");
    const quality_trigger = group_trigger(container, "quality");

    // 互斥展开。
    await act(async () => workbench_trigger.click());
    expect(workbench.dataset.expanded).toBe("true");
    expect(quality.dataset.expanded).toBe("false");

    await act(async () => quality_trigger.click());
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("true");

    // 外部点击收起。
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(quality.dataset.expanded).toBe("false");

    // Esc 收起并将焦点归还当前打开组的触发按钮。
    await act(async () => quality_trigger.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(quality.dataset.expanded).toBe("false");
    expect(document.activeElement).toBe(quality_trigger);

    // 窗口失焦收起。
    await act(async () => workbench_trigger.click());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(workbench.dataset.expanded).toBe("false");

    // 选中翻译质量子页：仅翻译质量头显示当前子页与关闭按钮，工作台保持组名。
    await act(async () => quality_trigger.click());
    await act(async () => find_tool_item(container, "术语表").click());
    expect(quality.dataset.expanded).toBe("false");
    expect(quality_trigger.textContent).toBe("术语表");
    expect(quality.querySelector(".project-workspace__tools-close")).not.toBeNull();
    expect(workbench_trigger.textContent).toBe("工作台");
    expect(workbench.querySelector(".project-workspace__tools-close")).toBeNull();
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();

    // 切换到工作台子页：工作台头接管激活态与关闭按钮，翻译质量恢复组名。
    await act(async () => workbench_trigger.click());
    await act(async () => find_tool_item(container, "校对").click());
    expect(workbench_trigger.textContent).toBe("校对");
    expect(workbench.querySelector(".project-workspace__tools-close")).not.toBeNull();
    expect(quality_trigger.textContent).toBe("翻译质量");
    expect(quality.querySelector(".project-workspace__tools-close")).toBeNull();
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    // 关闭按钮经离页保存生效。
    const close_button = workbench.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-close",
    )!;
    leave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).toBeNull();
    expect(workbench_trigger.textContent).toBe("工作台");

    // 预过滤确认留在当前页，切换工程后随工作区卸载。
    await act(async () => workbench_trigger.click());
    await act(async () => find_tool_item(container, "校对").click());
    await act(async () => quality_trigger.click());
    await act(async () => find_tool_item(container, "MTool 优化器").click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await mount(create_project("project-2"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("宽工作区常驻显示功能，缩窄后恢复折叠菜单", async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const container = await mount(create_project(), partial_stats);
    const workspace = container.querySelector<HTMLDivElement>(".project-workspace")!;
    const workbench = group_panel(container, "workbench");
    const quality = group_panel(container, "quality");

    await act(async () => TestResizeObserver.emit(workspace, 1000));
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");

    await act(async () => TestResizeObserver.emit(workspace, 1600));
    expect(workbench.dataset.expanded).toBe("true");
    expect(quality.dataset.expanded).toBe("true");
    expect(find_tool_item(workbench, "校对").querySelector(".app-badge")).not.toBeNull();

    // 宽态下外部点击与失焦不收起常驻卡片。
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      window.dispatchEvent(new Event("blur"));
    });
    expect(workbench.dataset.expanded).toBe("true");
    expect(quality.dataset.expanded).toBe("true");

    await act(async () => find_tool_item(container, "术语表").click());
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();
    expect(find_tool_item(container, "术语表").getAttribute("aria-current")).toBe("page");

    await act(async () => TestResizeObserver.emit(workspace, 1000));
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");
  });

  it("禁用的预过滤项仅在标题截断时显示完整标题提示", async () => {
    vi.useFakeTimers();
    try {
      const project = create_project();
      const container = await mount(project);
      await act(async () => group_trigger(container, "quality").click());

      await act(async () =>
        runtime_activity.applySnapshot({
          revision: 1,
          projects: {
            [project.snapshot.projectId]: {
              batchTranslation: true,
              agent: false,
              projectWrite: false,
            },
          },
        }),
      );
      const title = "跳过重复原文";
      const item = find_tool_item(container, title);
      const label = item.querySelector(".project-workspace__tool-label")!;
      const trigger = item.parentElement!; // 原生禁用按钮由外层承接悬停。
      const tooltip = () => document.querySelector('[role="tooltip"][data-open]');
      const hover = (clientX: number) =>
        act(async () => {
          trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX }));
          trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX }));
          vi.runAllTimers();
        });

      // jsdom 不计算布局，直接模拟标题刚好放下与实际截断两种情况。
      Object.defineProperty(label, "clientWidth", { value: 84 });
      Object.defineProperty(label, "scrollWidth", { configurable: true, value: 84 });
      await hover(10);
      expect(tooltip()).toBeNull();
      await act(async () =>
        trigger.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body })),
      );

      Object.defineProperty(label, "scrollWidth", { value: 160 });
      await hover(20);
      expect(tooltip()?.textContent).toBe(title);
    } finally {
      vi.useRealTimers();
    }
  });
});
