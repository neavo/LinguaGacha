vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ owner: null }),
}));
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { WorkbenchCommandBar } from "./workbench-command-bar";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/pages/workbench-page/components/workbench-translation-menu", () => ({
  WorkbenchTranslationMenu: (props: { on_start_or_continue: () => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void props.on_start_or_continue();
      }}
    >
      translation-task
    </button>
  ),
}));

/** 构造命令栏公开契约所需的最小完整状态。 */
function create_workbench_command_bar_props(): ComponentProps<typeof WorkbenchCommandBar> {
  const stats = {
    total_items: 4,
    completed_count: 1,
    failed_count: 0,
    pending_count: 3,
    skipped_count: 0,
    completion_percent: 25,
  };
  const translation_task_metrics = {
    active: false,
    stopping: false,
    processed_count: 0,
    failed_count: 0,
    elapsed_seconds: 0,
    remaining_seconds: 0,
    average_generation_speed: 0,
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    request_in_flight_count: 0,
    completion_percent: 0,
  };

  return {
    batch_translation_task: {
      translation_task_display_snapshot: null,
      translation_task_metrics,
      translation_waveform_history: [],
      translation_detail_sheet_open: false,
      task_confirm_state: null,
      translation_task_menu_disabled: false,
      translation_task_menu_busy: false,
      open_translation_detail_sheet: () => {},
      close_translation_detail_sheet: () => {},
      request_start_or_continue_translation: vi.fn(async () => {}),
      request_task_action_confirmation: () => {},
      confirm_task_action: async () => {},
      close_task_action_confirmation: () => {},
    },

    translation_stats: stats,

    can_edit_files: true,
    can_delete_selected_files: true,
    can_generate_translation: true,
    can_close_project: true,
    on_add_file: () => {},
    on_delete_selected: () => {},
    on_generate_translation: () => {},
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

  /** 挂载命令栏，验证按钮权限与任务启动回调。 */
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
    await render_command_bar(props);

    expect(find_button("app.action.delete").disabled).toBe(true);
  });

  it("翻译按钮调用任务启动入口", async () => {
    const props = await render_command_bar();

    await act(async () => find_button("translation-task").click());

    expect(
      props.batch_translation_task.request_start_or_continue_translation,
    ).toHaveBeenCalledOnce();
  });
});
