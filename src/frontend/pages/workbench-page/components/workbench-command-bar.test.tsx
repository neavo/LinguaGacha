vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ owner: null }),
}));
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { batch_task_metrics, empty_batch_task_snapshot } from "@shared/batch-task";
import { empty_batch_task_progress } from "@domain/batch-task";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { WorkbenchCommandBar } from "./workbench-command-bar";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

/** 构造命令栏公开契约所需的最小完整状态。 */
function create_workbench_command_bar_props(): ComponentProps<typeof WorkbenchCommandBar> {
  return {
    can_start_translation: true,
    on_request_start_translation: vi.fn(),
    batch_task: {
      task_display_snapshot: null,
      task_metrics: batch_task_metrics(null, 0),
      task_waveform_history: [],
      task_detail_sheet_open: false,
      task_confirm_state: null,
      translation_action_blocked: false,
      open_task_detail_sheet: () => {},
      close_task_detail_sheet: () => {},
      request_start_or_continue_translation: vi.fn(async () => {}),
      request_task_action_confirmation: vi.fn(),
      confirm_task_action: async () => {},
      close_task_action_confirmation: () => {},
    },

    translation_stats: null,

    can_edit_files: true,
    can_delete_selected_files: true,
    can_export_translation: true,
    can_close_project: true,
    on_add_file: () => {},
    on_delete_selected: () => {},
    on_export_translation: () => {},
    on_close_project: () => {},
  };
}

describe("WorkbenchCommandBar", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载命令栏并保留共用浮层环境。 */
  async function render_command_bar(
    props = create_workbench_command_bar_props(),
  ): Promise<ComponentProps<typeof WorkbenchCommandBar>> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <WorkbenchCommandBar {...props} />
        </TooltipProvider>,
      );
    });
    return props;
  }

  /** 按用户可见名称定位按钮，避免依赖组件内部层级。 */
  function find_button(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (button === undefined) throw new Error(`找不到按钮：${label}`);
    return button;
  }

  it("删除按钮只消费上游删除权限", async () => {
    const props = create_workbench_command_bar_props();
    props.can_delete_selected_files = false;
    props.can_edit_files = false;
    props.on_add_file = vi.fn();
    props.on_delete_selected = vi.fn();
    await render_command_bar(props);

    expect(find_button("app.action.delete").disabled).toBe(true);
    await act(async () => {
      find_button("app.action.delete").click();
      find_button("workbench_page.action.add_file").click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }));
    });
    expect(props.on_add_file).not.toHaveBeenCalled();
    expect(props.on_delete_selected).not.toHaveBeenCalled();
  });

  it("重置按钮请求会话确认", async () => {
    const props = await render_command_bar();
    await act(async () => find_button("app.action.reset").click());
    expect(props.batch_task.request_task_action_confirmation).toHaveBeenCalledExactlyOnceWith(
      "reset-all",
    );
  });

  it("任务运行时禁用重置，仍可悬停查看用途", async () => {
    const props = create_workbench_command_bar_props();
    props.batch_task.task_metrics.active = true;
    await render_command_bar(props);
    const reset = find_button("app.action.reset");
    expect(reset.disabled).toBe(true);
    await act(async () => {
      reset.parentElement!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"][data-open]')).not.toBeNull();
  });

  it("运行摘要使用同一批量任务的类型与完成率", async () => {
    const props = create_workbench_command_bar_props();
    const snapshot = {
      ...empty_batch_task_snapshot(),
      kind: "request" as const,
      status: "running" as const,
      progress: { ...empty_batch_task_progress("request", 10), succeeded: 3 },
    };
    props.batch_task.task_display_snapshot = snapshot;
    props.batch_task.task_metrics = batch_task_metrics(snapshot, 0);
    await render_command_bar(props);

    expect(find_button("batch_translation.summary.request.running")).toBeDefined();
    expect(container?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "30",
    );
  });
});
