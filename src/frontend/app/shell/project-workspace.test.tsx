import { act, useEffect, useSyncExternalStore, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AppNavigationProvider } from "@frontend/app/navigation/navigation-provider";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";
import { ProjectScopeContext } from "@frontend/app/navigation/project-scope-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import type { RouteId } from "@frontend/app/navigation/types";
import { ProjectStore } from "@frontend/app/state/project-store-registry";

const mocks = vi.hoisted(() => ({
  leave: vi.fn<() => Promise<boolean>>(async () => true),
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
      useEffect(() => register_before_leave(mocks.leave), [register_before_leave]);
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
      files: { ...actual.SCREEN_REGISTRY.files, component: create_stub_page("files") },
      glossary: { ...actual.SCREEN_REGISTRY.glossary, component: create_stub_page("glossary") },
      "text-preserve": {
        ...actual.SCREEN_REGISTRY["text-preserve"],
        component: create_stub_page("text-preserve"),
      },
      "pre-translation-replacement": {
        ...actual.SCREEN_REGISTRY["pre-translation-replacement"],
        component: create_stub_page("pre-translation-replacement"),
      },
      "post-translation-replacement": {
        ...actual.SCREEN_REGISTRY["post-translation-replacement"],
        component: create_stub_page("post-translation-replacement"),
      },
      "project-knowledge": {
        ...actual.SCREEN_REGISTRY["project-knowledge"],
        component: create_stub_page("project-knowledge"),
      },
      "custom-prompt": {
        ...actual.SCREEN_REGISTRY["custom-prompt"],
        component: create_stub_page("custom-prompt"),
      },
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
      <ProjectScopeContext value={{ projectId: project.snapshot.projectId }}>
        <ProjectWorkspace project={project} selected={active_route} />
      </ProjectScopeContext>
    </AppNavigationProvider>
  );
}

function WorkspaceHarness({ project }: { project: ProjectStore }): JSX.Element {
  return (
    <LocaleProvider locale="zh-CN">
      <PageLeaveProvider>
        <WorkspaceHarnessInner project={project} />
      </PageLeaveProvider>
    </LocaleProvider>
  );
}

describe("ProjectWorkspace 翻译功能面板", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    TestResizeObserver.instances = [];
    await act(async () => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    mocks.leave.mockReset();
    mocks.leave.mockResolvedValue(true);
  });

  function create_project(): ProjectStore {
    return new ProjectStore({
      projectId: "project-1",
      path: "E:/demo.lg",
      name: "demo.lg",
      loaded: true,
      file_count: 3,
      quality_rule_counts: {
        glossary: 12,
        text_preserve: 0,
        pre_replacement: 4,
        post_replacement: 0,
      },
      languages: null,
    });
  }

  async function mount(project: ProjectStore): Promise<HTMLDivElement> {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<WorkspaceHarness project={project} />));
    return host;
  }

  function find_tool_item(container: HTMLElement, label: string): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>(".project-workspace__tool-item")].find(
      (item) => item.querySelector(".project-workspace__tool-label")?.textContent === label,
    )!;
  }

  it("按指定顺序展示 8 个翻译功能，只为文件与 4 类规则表渲染含 0 的数值胶囊", async () => {
    const container = await mount(create_project());
    const panel = container.querySelector<HTMLElement>(".project-workspace__tools-panel")!;
    const drawer = container.querySelector<HTMLDivElement>(".project-workspace__tools-drawer")!;
    const trigger = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;

    expect(trigger.textContent).toBe("翻译功能");
    expect(trigger.dataset.active).toBe("false");
    expect(panel.dataset.expanded).toBe("false");
    expect(drawer.hasAttribute("inert")).toBe(true);

    await act(async () => trigger.click());
    expect(panel.dataset.expanded).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(false);

    const items = [
      ...container.querySelectorAll<HTMLButtonElement>(".project-workspace__tool-item"),
    ].map((item) => ({
      label: item.querySelector(".project-workspace__tool-label")?.textContent,
      count: item.querySelector(".project-workspace__tool-count")?.textContent ?? null,
    }));

    expect(items).toEqual([
      { label: "校对", count: null },
      { label: "文件", count: "3" },
      { label: "术语表", count: "12" },
      { label: "文本保护", count: "0" },
      { label: "译前替换", count: "4" },
      { label: "译后替换", count: "0" },
      { label: "工程知识", count: null },
      { label: "自定义提示词", count: null },
    ]);
  });

  it("窄态悬停不展开，支持点击、外部点击、Esc 与窗口失焦收起菜单", async () => {
    vi.useFakeTimers();
    const container = await mount(create_project());
    const panel = container.querySelector<HTMLElement>(".project-workspace__tools-panel")!;
    const trigger = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
      );
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      trigger.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 12, clientY: 12 }),
      );
      vi.advanceTimersByTime(500);
    });
    expect(panel.dataset.expanded).toBe("false");

    // 点击展开并再次点击收起。
    await act(async () => trigger.click());
    expect(panel.dataset.expanded).toBe("true");
    await act(async () => trigger.click());
    expect(panel.dataset.expanded).toBe("false");

    // 外部点击收起。
    await act(async () => trigger.click());
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(panel.dataset.expanded).toBe("false");

    // Esc 收起并把焦点归还触发按钮。
    await act(async () => trigger.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel.dataset.expanded).toBe("false");
    expect(document.activeElement).toBe(trigger);

    // 窗口失焦收起。
    await act(async () => trigger.click());
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(panel.dataset.expanded).toBe("false");
  });

  it("展开功能页后可再次点击标签切换其它功能，点击关闭或普通标签均经离页保存关闭", async () => {
    const container = await mount(create_project());
    const panel = container.querySelector<HTMLElement>(".project-workspace__tools-panel")!;
    const trigger = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;

    // 首次选择术语表后菜单自动收起，头部切换为当前功能名与关闭按钮。
    await act(async () => trigger.click());
    await act(async () => find_tool_item(container, "术语表").click());

    expect(panel.dataset.expanded).toBe("false");
    expect(trigger.dataset.active).toBe("true");
    expect(trigger.textContent).toBe("术语表");
    expect(container.querySelector(".project-workspace__tools-close")).not.toBeNull();
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();

    // 再次点击标签展开并切换至校对页，当前项标记激活态。
    await act(async () => trigger.click());
    expect(find_tool_item(container, "术语表").hasAttribute("data-active")).toBe(true);
    await act(async () => find_tool_item(container, "校对").click());

    expect(trigger.textContent).toBe("校对");
    expect(container.querySelector('[data-testid="page-glossary"]')).toBeNull();
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    // 点击关闭按钮：离页保存失败时保留功能页，成功后关闭并恢复默认标题。
    const close_button = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-close",
    )!;
    mocks.leave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();
    expect(trigger.textContent).toBe("校对");

    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).toBeNull();
    expect(container.querySelector(".project-workspace__tools-close")).toBeNull();
    expect(trigger.dataset.active).toBe("false");
    expect(trigger.textContent).toBe("翻译功能");

    // 再次打开功能页后，点击左侧普通对话标签同样经离页保存关闭功能页。
    await act(async () => trigger.click());
    await act(async () => find_tool_item(container, "文件").click());
    expect(container.querySelector('[data-testid="page-files"]')).not.toBeNull();

    const chat_tab = container.querySelector<HTMLButtonElement>('[data-testid="agent-chat-tab"]')!;
    await act(async () => chat_tab.click());
    expect(container.querySelector('[data-testid="page-files"]')).toBeNull();
    expect(trigger.dataset.active).toBe("false");
    expect(trigger.textContent).toBe("翻译功能");
  });

  it("工作区宽度跨越 1280px 时原地常驻展开，缩窄回窄态后一并收起且不保留临时展开态", async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const container = await mount(create_project());
    const workspace = container.querySelector<HTMLDivElement>(".project-workspace")!;
    const panel = container.querySelector<HTMLElement>(".project-workspace__tools-panel")!;
    const drawer = container.querySelector<HTMLDivElement>(".project-workspace__tools-drawer")!;

    await act(async () => TestResizeObserver.emit(workspace, 1279));
    expect(workspace.dataset.toolsDocked).toBe("false");
    expect(panel.dataset.expanded).toBe("false");
    expect(drawer.hasAttribute("inert")).toBe(true);

    // 窄态先点开浮层菜单，再拉宽跨越 1280px：同一面板保持展开落地为常驻卡片。
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".project-workspace__tools-trigger")!.click(),
    );
    expect(panel.dataset.expanded).toBe("true");

    await act(async () => TestResizeObserver.emit(workspace, 1280));
    expect(workspace.dataset.toolsDocked).toBe("true");
    expect(panel.dataset.docked).toBe("true");
    expect(panel.dataset.expanded).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(false);
    // 宽态下外部点击与窗口失焦不会收起常驻卡片。
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      window.dispatchEvent(new Event("blur"));
    });
    expect(panel.dataset.expanded).toBe("true");

    // 宽态切换功能页时面板保持常驻展开，上方标签继续保留当前功能名与关闭按钮并受离页保存保护。
    await act(async () => find_tool_item(container, "术语表").click());
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();
    expect(panel.dataset.expanded).toBe("true");
    expect(find_tool_item(container, "术语表").getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".project-workspace__tools-label")?.textContent).toBe("术语表");

    const close_button = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-close",
    )!;
    mocks.leave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();

    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-glossary"]')).toBeNull();
    expect(container.querySelector(".project-workspace__tools-close")).toBeNull();
    expect(container.querySelector(".project-workspace__tools-label")?.textContent).toBe(
      "翻译功能",
    );

    // 缩窄回临界值以下：菜单一并向上收起，不会恢复此前窄态的临时展开态。
    await act(async () => TestResizeObserver.emit(workspace, 1279));
    expect(workspace.dataset.toolsDocked).toBe("false");
    expect(panel.dataset.expanded).toBe("false");
    expect(drawer.hasAttribute("inert")).toBe(true);
  });
});
