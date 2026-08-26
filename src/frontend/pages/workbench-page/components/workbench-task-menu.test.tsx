import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTaskMenu } from "./workbench-task-menu";

vi.mock("@frontend/app/locale/locale-provider", () => ({
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
  AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
  AppDropdownMenuSeparator: () => <hr />,
  AppDropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onSelect}>
      {props.children}
    </button>
  ),
}));

vi.mock("@frontend/widgets/segmented-progress/segmented-progress", () => ({
  SegmentedProgress: () => <div data-testid="segmented-progress" />,
}));

vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
  tooltip_trigger_target: (trigger: ReactNode) => <span className="inline-flex">{trigger}</span>,
}));

const workbench_stats = {
  total_items: 4,
  completed_count: 1,
  failed_count: 0,
  pending_count: 3,
  skipped_count: 0,
  completion_percent: 25,
};

const shared_props = {
  active: false,
  workbench_stats,
  disabled: false,
  busy: false,
  model_selection: {
    snapshot: {
      model_selection: { translation: "", analysis: "", agent: "" },
      models: [],
    },
    loading: false,
    updating: false,
    select_model: vi.fn(async () => undefined),
    update_thinking_level: vi.fn(async () => undefined),
  },
  active_task_action_kind: null,
  on_start_or_continue: async () => {},
  on_request_reset: () => {},
};

describe("WorkbenchTaskMenu", () => {
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

  function find_button(label: string): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (button === undefined) {
      throw new Error(`找不到按钮：${label}`);
    }
    return button;
  }

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

  it("启动与重置动作复用同一条交互路径", async () => {
    const on_start_or_continue = vi.fn(async () => {});
    const on_request_reset = vi.fn();
    await render_menu(
      <WorkbenchTaskMenu
        task_kind="translation"
        {...shared_props}
        on_start_or_continue={on_start_or_continue}
        on_request_reset={on_request_reset}
      />,
    );

    await act(async () => {
      find_button("workbench_page.action.start_translation").click();
      find_button("workbench_page.action.reset_task_all").click();
      find_button("workbench_page.action.reset_task_failed").click();
    });

    expect(on_start_or_continue).toHaveBeenCalledOnce();
    expect(on_request_reset).toHaveBeenNthCalledWith(1, "reset-all");
    expect(on_request_reset).toHaveBeenNthCalledWith(2, "reset-failed");
  });

  it("分析候选数控制导入动作并在提交前请求确认", async () => {
    const on_request = vi.fn();
    await render_menu(
      <WorkbenchTaskMenu
        task_kind="analysis"
        {...shared_props}
        analysis_import={{
          candidate_count: 2,
          importing: false,
          on_request,
        }}
      />,
    );

    const import_button = find_button("workbench_page.action.import_analysis_glossary");
    expect(import_button.textContent).toContain("2");
    expect(import_button.disabled).toBe(false);

    await act(async () => {
      import_button.click();
    });
    expect(on_request).toHaveBeenCalledOnce();

    await render_menu(
      <WorkbenchTaskMenu
        task_kind="analysis"
        {...shared_props}
        analysis_import={{
          candidate_count: 0,
          importing: false,
          on_request,
        }}
      />,
    );
    expect(find_button("workbench_page.action.import_analysis_glossary").disabled).toBe(true);

    await render_menu(
      <WorkbenchTaskMenu
        task_kind="analysis"
        {...shared_props}
        analysis_import={{
          candidate_count: 2,
          importing: true,
          on_request,
        }}
      />,
    );
    expect(find_button("workbench_page.action.import_analysis_glossary").disabled).toBe(true);
  });
});
