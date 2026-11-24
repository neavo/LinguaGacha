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

describe("ProjectWorkspace 翻译功能菜单", () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.useRealTimers();
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

  it("按指定顺序展示 8 个翻译功能，只为文件与 4 类规则表渲染含 0 的数值胶囊", async () => {
    const container = await mount(create_project());
    const trigger = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;
    expect(trigger.textContent).toBe("翻译功能");
    expect(trigger.dataset.active).toBe("false");

    await act(async () => trigger.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => ({
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

  it("悬停不展开菜单，仅点击触发器展开与收缩", async () => {
    vi.useFakeTimers();
    const container = await mount(create_project());
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
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("展开功能页后可再次点击标签切换其它功能，点击普通标签则经离页保存后关闭功能页", async () => {
    const container = await mount(create_project());
    const trigger = container.querySelector<HTMLButtonElement>(
      ".project-workspace__tools-trigger",
    )!;

    // 首次选择术语表。
    await act(async () => trigger.click());
    const glossary_item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("术语表"),
    )!;
    await act(async () => glossary_item.click());

    expect(trigger.dataset.active).toBe("true");
    expect(trigger.textContent).toBe("术语表");
    expect(container.querySelector(".project-workspace__tools-close")).not.toBeNull();
    expect(container.querySelector('[data-testid="page-glossary"]')).not.toBeNull();

    // 再次点击功能标签本体展开菜单并直接切换至校对页，当前项标记激活态。
    await act(async () => trigger.click());
    const menu_items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(
      menu_items.find((item) => item.textContent?.includes("术语表"))?.hasAttribute("data-active"),
    ).toBe(true);
    const proofreading_item = menu_items.find((item) => item.textContent?.includes("校对"))!;
    await act(async () => proofreading_item.click());

    expect(trigger.textContent).toBe("校对");
    expect(container.querySelector('[data-testid="page-glossary"]')).toBeNull();
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    // 点击关闭按钮：离页保存失败时保留功能页，成功后关闭并恢复菜单默认标题。
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
    const files_item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("文件"),
    )!;
    await act(async () => files_item.click());
    expect(container.querySelector('[data-testid="page-files"]')).not.toBeNull();

    const chat_tab = container.querySelector<HTMLButtonElement>('[data-testid="agent-chat-tab"]')!;
    await act(async () => chat_tab.click());
    expect(container.querySelector('[data-testid="page-files"]')).toBeNull();
    expect(trigger.dataset.active).toBe("false");
    expect(trigger.textContent).toBe("翻译功能");
  });
});
