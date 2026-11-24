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
import type { RuntimeActivitySnapshot } from "@shared/runtime-activity";

const mocks = vi.hoisted(() => ({
  leave: vi.fn<() => Promise<boolean>>(async () => true),
  api: vi.fn(),
  commit: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => ({ payload: await run() })),
  toast: vi.fn(),
  error_toast: vi.fn(),
  runtime: { revision: 0, owner: null, projects: {} } as RuntimeActivitySnapshot,
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

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: mocks.api,
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: mocks.toast,
  push_error_toast: mocks.error_toast,
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ commit_project_write: mocks.commit }),
  useRuntimeSnapshot: () => mocks.runtime,
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
    mocks.leave.mockResolvedValue(true);
    mocks.api.mockResolvedValue({ accepted: true, changes: [] });
    mocks.runtime = { revision: 0, owner: null, projects: {} };
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  function dialog_button(
    slot: "cancel" | "secondary-action" | "primary-action",
  ): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`[data-slot="alert-dialog-${slot}"]`)!;
  }

  it("按「工作台」与「翻译质量」分组呈现条目、计数胶囊、分割线和预过滤状态徽标", async () => {
    const container = await mount(create_project());
    const workbench = group_panel(container, "workbench");
    const quality = group_panel(container, "quality");

    expect(group_trigger(container, "workbench").textContent).toBe("工作台");
    expect(group_trigger(container, "quality").textContent).toBe("翻译质量");
    expect(workbench.querySelector(".project-workspace__tools-divider")).toBeNull();
    expect(quality.querySelector(".project-workspace__tools-divider")).not.toBeNull();

    const read_items = (panel: HTMLElement) =>
      [...panel.querySelectorAll<HTMLButtonElement>(".project-workspace__tool-item")].map(
        (item) => {
          const badge = item.querySelector<HTMLElement>('[data-slot="badge"]');
          return {
            label: item.querySelector(".project-workspace__tool-label")?.textContent,
            badge: badge?.textContent ?? null,
            tone: badge?.dataset.tone ?? null,
          };
        },
      );

    expect(read_items(workbench)).toEqual([
      { label: "校对", badge: null, tone: null },
      { label: "文件", badge: "3", tone: "neutral" },
    ]);
    expect(read_items(quality)).toEqual([
      { label: "术语表", badge: "12", tone: "neutral" },
      { label: "文本保护", badge: "0", tone: "neutral" },
      { label: "译前替换", badge: "4", tone: "neutral" },
      { label: "译后替换", badge: "0", tone: "neutral" },
      { label: "工程知识", badge: null, tone: null },
      { label: "自定义提示词", badge: null, tone: null },
      { label: "跳过重复原文", badge: "已禁用", tone: "neutral" },
      { label: "MTool 优化器", badge: "已启用", tone: "brand" },
    ]);
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
    mocks.leave.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    await act(async () => close_button.click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).toBeNull();
    expect(workbench_trigger.textContent).toBe("工作台");
  });

  it("工作区宽度跨越 1280px 时纵排双块常驻展开，缩窄回临界值以下时统一收起", async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const container = await mount(create_project());
    const workspace = container.querySelector<HTMLDivElement>(".project-workspace")!;
    const workbench = group_panel(container, "workbench");
    const quality = group_panel(container, "quality");

    await act(async () => TestResizeObserver.emit(workspace, 1279));
    expect(workspace.dataset.toolsDocked).toBe("false");
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");

    await act(async () => TestResizeObserver.emit(workspace, 1280));
    expect(workspace.dataset.toolsDocked).toBe("true");
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

    await act(async () => TestResizeObserver.emit(workspace, 1279));
    expect(workspace.dataset.toolsDocked).toBe("false");
    expect(workbench.dataset.expanded).toBe("false");
    expect(quality.dataset.expanded).toBe("false");
  });

  it("预过滤设置弹出三按钮确认框：受当前工程运行占用约束、提交单字段并刷新徽标", async () => {
    const project = create_project("project-1", {
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: false,
    });
    const container = await mount(project);

    // 先打开校对页，确认点击预过滤设置不会改变当前页面。
    await act(async () => group_trigger(container, "workbench").click());
    await act(async () => find_tool_item(container, "校对").click());
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    // 打开 MTool 优化器确认框：禁用与启用按钮均可用（不按当前值禁用），点击当前同态直接关闭且不发起请求。
    await act(async () => group_trigger(container, "quality").click());
    await act(async () => find_tool_item(container, "MTool 优化器").click());
    expect(group_panel(container, "quality").dataset.expanded).toBe("false");
    expect(container.querySelector('[data-testid="page-proofreading"]')).not.toBeNull();

    const dialog = document.querySelector('[data-slot="alert-dialog-content"]')!;
    expect(dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent).toBe("确认");
    expect(dialog.querySelector(".project-prefilter-dialog__emphasis")?.textContent).toContain(
      "40%",
    );
    expect(dialog.querySelector('[data-slot="alert-dialog-description"] br')).not.toBeNull();
    expect(dialog_button("primary-action").disabled).toBe(false);
    expect(dialog_button("secondary-action").disabled).toBe(false);

    await act(async () => dialog_button("primary-action").click());
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    expect(mocks.api).not.toHaveBeenCalled();

    // 重新打开后，当前工程 Agent 忙碌时双动作按钮同时禁用（不受其他工程状态影响）。
    await act(async () => group_trigger(container, "quality").click());
    await act(async () => find_tool_item(container, "MTool 优化器").click());
    mocks.runtime = {
      revision: 1,
      owner: "agent",
      projects: {
        "project-1": { agent: true, batchTranslation: false, projectWrite: false },
      },
    };
    await mount(project);
    expect(dialog_button("primary-action").disabled).toBe(true);
    expect(dialog_button("secondary-action").disabled).toBe(true);

    // 恢复空闲后点击「禁用」，仅提交单字段并回读更新徽标。
    mocks.runtime = {
      revision: 2,
      owner: null,
      projects: {
        "project-1": { agent: false, batchTranslation: false, projectWrite: false },
      },
    };
    await mount(project);

    let resolve_request!: (value: unknown) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_request = resolve;
        }),
    );
    await act(async () => dialog_button("secondary-action").click());
    expect(dialog_button("secondary-action").disabled).toBe(true);
    expect(dialog_button("cancel").disabled).toBe(true);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/project/settings/update", {
      projectId: "project-1",
      mtool_optimizer_enable: false,
    });

    project.snapshot = {
      ...project.snapshot,
      settings: {
        ...project.snapshot.settings!,
        mtool_optimizer_enable: false,
      },
    };
    await act(async () => resolve_request({ accepted: true, changes: [] }));
    await mount(project);

    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("info", expect.stringContaining("MTool 优化器"));
    expect(
      find_tool_item(container, "MTool 优化器").querySelector('[data-slot="badge"]')?.textContent,
    ).toBe("已禁用");

    // 跳过重复原文（已禁用）：提交失败时反馈错误并保留弹窗供重试。
    await act(async () => group_trigger(container, "quality").click());
    await act(async () => find_tool_item(container, "跳过重复原文").click());
    expect(dialog_button("secondary-action").disabled).toBe(false);
    expect(dialog_button("primary-action").disabled).toBe(false);

    mocks.api.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => dialog_button("primary-action").click());
    expect(mocks.error_toast).toHaveBeenCalledWith("保存失败 …", expect.any(Error));
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();

    // 切换工程时自动关闭弹窗。
    await mount(create_project("project-2"));
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
  });
});
