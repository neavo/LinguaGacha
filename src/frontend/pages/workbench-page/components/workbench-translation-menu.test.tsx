import { type ReactNode, act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTranslationMenu } from "./workbench-translation-menu";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/features/model-selection/model-selection-menu", () => ({
  ModelSelectionMenu: (props: { usage: string; disabled?: boolean }) => (
    <button type="button" data-testid={`model-selection-${props.usage}`} disabled={props.disabled}>
      model-selection-{props.usage}
    </button>
  ),
}));

vi.mock("@frontend/widgets/app-dropdown-menu", () => ({
  AppDropdownMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSeparator: () => <hr />,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock("@frontend/widgets/segmented-progress/segmented-progress", () => ({
  SegmentedProgress: () => <div data-testid="segmented-progress" />,
}));

vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipTrigger: (props: { children?: ReactNode; render?: ReactNode }) => (
    <>{props.render ?? props.children}</>
  ),
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
  TooltipTarget: (props: { children: ReactNode }) => <span>{props.children}</span>,
}));

const workbench_stats = {
  total_items: 4,
  completed_count: 1,
  pending_count: 3,
  skipped_count: 0,
  completion_percent: 25,
};

const shared_props = {
  can_start: true,
  active: false,
  workbench_stats,
  disabled: false,
  busy: false,
  model_selection: {
    snapshot: {
      model_selection: {
        translation: "",
        agent: "",
        agent_batch_translation: null,
        agent_media: null,
      },
      models: [],
    },
    loading: false,
    updating: false,
    select_model: vi.fn(async () => undefined),
  },
  active_task_action_kind: null,
  on_request_start: () => {},
  on_request_reset: () => {},
};

describe("WorkbenchTranslationMenu", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  /** 按可见标签选择动作，缺失时直接报告目标。 */
  function find_button(label: string): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (button === undefined) {
      throw new Error(`找不到按钮：${label}`);
    }
    return button;
  }

  /** 复用挂载点更新菜单，保留 React 的真实重渲染行为。 */
  async function render_menu(element: ReactNode): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(element);
    });
  }

  it("开始翻译请求页面选择方式，重置交给会话层", async () => {
    const on_request_start = vi.fn();
    const on_request_reset = vi.fn();
    await render_menu(
      <WorkbenchTranslationMenu
        {...shared_props}
        on_request_start={on_request_start}
        on_request_reset={on_request_reset}
      />,
    );

    await act(async () => {
      find_button("workbench_page.action.start_translation").click();
      find_button("workbench_page.action.reset_task_all").click();
    });

    expect(on_request_start).toHaveBeenCalledOnce();
    expect(on_request_reset).toHaveBeenCalledExactlyOnceWith("reset-all");
  });

  it("开始入口遵循页面权限，零文本条目的 PDF 工程仍可进入选择", async () => {
    const props = { ...shared_props, workbench_stats: { ...workbench_stats, total_items: 0 } };
    await render_menu(<WorkbenchTranslationMenu {...props} />);
    expect(find_button("workbench_page.action.start_translation").disabled).toBe(false);
    await render_menu(<WorkbenchTranslationMenu {...props} can_start={false} />);
    expect(find_button("workbench_page.action.start_translation").disabled).toBe(true);
  });
});
