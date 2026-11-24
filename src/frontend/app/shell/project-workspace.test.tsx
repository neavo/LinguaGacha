import { act, useEffect, useSyncExternalStore, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from "@domain/project-settings";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppNavigationProvider } from "@frontend/app/navigation/navigation-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import type { RouteId } from "@frontend/app/navigation/types";
import { ProjectStore } from "@frontend/app/state/project-store-registry";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const leave = vi.hoisted(() => vi.fn<() => Promise<boolean>>(async () => true));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ commit_project_write: vi.fn() }),
  useRuntimeSnapshot: () => ({}),
}));

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

function WorkspaceHarnessInner({ project }: { project: ProjectStore }): JSX.Element {
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

function WorkspaceHarness({ project }: { project: ProjectStore }): JSX.Element {
  return (
    <LocaleProvider locale="zh-CN">
      <TooltipProvider delay={0}>
        <PageLeaveProvider>
          <WorkspaceHarnessInner project={project} />
        </PageLeaveProvider>
      </TooltipProvider>
    </LocaleProvider>
  );
}

describe("ProjectWorkspace 双功能块与预过滤确认框", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
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

  function create_project(id = "project-1", settings: Partial<ProjectSettings> = {}): ProjectStore {
    return new ProjectStore({
      projectId: id,
      path: `E:/${id}.lg`,
      name: `${id}.lg`,
      loaded: true,
      file_count: 3,
      quality_rule_counts: {
        glossary: 12,
        text_preserve: 0,
        pre_replacement: 4,
        post_replacement: 0,
      },
      settings: {
        ...DEFAULT_PROJECT_SETTINGS,
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
        ...settings,
      },
    });
  }

  async function mount(project: ProjectStore): Promise<HTMLDivElement> {
    if (host === null) {
      host = document.body.appendChild(document.createElement("div"));
      root = createRoot(host);
    }
    await act(async () => root?.render(<WorkspaceHarness project={project} />));
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

  it("从工程快照显示规则条数，零条也可见", async () => {
    const container = await mount(create_project());
    await act(async () => group_trigger(container, "quality").click());
    expect(find_tool_item(container, "术语表").textContent).toContain("12");
    expect(find_tool_item(container, "文本保护").textContent).toContain("0");
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
    const container = await mount(create_project());
    const workspace = container.querySelector<HTMLDivElement>(".project-workspace")!;
    const workbench = group_panel(container, "workbench");
    const quality = group_panel(container, "quality");

    await act(async () => TestResizeObserver.emit(workspace, 1000));
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");

    await act(async () => TestResizeObserver.emit(workspace, 1600));
    expect(workbench.dataset.expanded).toBe("true");
    expect(quality.dataset.expanded).toBe("true");

    // 宽态下外部点击与失焦不收起常驻卡片。
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      window.dispatchEvent(new Event("blur"));
    });
    expect(workbench.dataset.expanded).toBe("true");
    expect(quality.dataset.expanded).toBe("true");

    // 宽态点击子页保持双块展开，仅所属组头显示当前子页与关闭按钮。
    await act(async () => find_tool_item(container, "术语表").click());
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();
    expect(find_tool_item(container, "术语表").getAttribute("aria-current")).toBe("page");
    expect(quality.querySelector(".project-workspace__tools-label")?.textContent).toBe("术语表");
    expect(workbench.querySelector(".project-workspace__tools-label")?.textContent).toBe("工作台");

    await act(async () => TestResizeObserver.emit(workspace, 1000));
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");
  });
});
