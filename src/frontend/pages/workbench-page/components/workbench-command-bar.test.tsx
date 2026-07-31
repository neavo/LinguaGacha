import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { WorkbenchCommandBar } from "./workbench-command-bar";

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/pages/workbench-page/components/workbench-task-menu", () => {
  return {
    WorkbenchTaskMenu: (props: {
      task_kind: "translation" | "analysis";
      model_selection: unknown;
    }) => (
      <button type="button" data-model-selection={props.model_selection !== undefined}>
        {props.task_kind}-task
      </button>
    ),
  };
});

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
    average_output_speed: 0,
    input_tokens: 0,
    output_tokens: 0,
    request_in_flight_count: 0,
    completion_percent: 0,
  };
  const analysis_task_metrics = {
    ...translation_task_metrics,
    candidate_count: 0,
  };

  return {
    translation_workbench_task: {
      translation_task_display_snapshot: null,
      translation_task_metrics,
      translation_waveform_history: [],
      translation_detail_sheet_open: false,
      task_confirm_state: null,
      translation_task_menu_disabled: false,
      translation_task_menu_busy: false,
      open_translation_detail_sheet: () => {},
      close_translation_detail_sheet: () => {},
      request_start_or_continue_translation: async () => {},
      request_task_action_confirmation: () => {},
      confirm_task_action: async () => {},
      close_task_action_confirmation: () => {},
    },
    analysis_workbench_task: {
      analysis_task_display_snapshot: null,
      analysis_task_metrics,
      analysis_waveform_history: [],
      analysis_detail_sheet_open: false,
      analysis_confirm_state: null,
      analysis_import_confirm_state: {
        open: false,
        duplicate_count: 0,
        submitting: false,
      },
      analysis_importing: false,
      analysis_task_menu_disabled: false,
      analysis_task_menu_busy: false,
      open_analysis_detail_sheet: () => {},
      close_analysis_detail_sheet: () => {},
      request_start_or_continue_analysis: async () => {},
      request_analysis_task_action_confirmation: () => {},
      confirm_analysis_task_action: async () => {},
      close_analysis_task_action_confirmation: () => {},
      import_analysis_glossary_duplicate_skip: async () => {},
      import_analysis_glossary_duplicate_overwrite: async () => {},
      close_analysis_glossary_import_confirmation: () => {},
      refresh_analysis_task_snapshot: async () => {},
    },
    active_workbench_task_view: {
      task_kind: null,
      can_open_detail: false,
    },
    active_workbench_task_summary: {
      status_text: "idle",
      trailing_text: null,
      tone: "neutral",
      show_spinner: false,
      detail_tooltip_text: "idle",
    },
    translation_stats: stats,
    analysis_stats: stats,
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
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("添加与删除文件按钮展示平台化快捷键提示", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <WorkbenchCommandBar {...create_workbench_command_bar_props()} />
      </TooltipProvider>,
    );

    expect(html).toContain("workbench_page.section.command_bar");
    expect(html).toContain("workbench_page.action.add_file");
    expect(html).toContain("Ctrl+N");
    expect(html).toContain("workbench_page.action.delete_file");
    expect(html).toContain("Del");
    expect(html.match(/data-model-selection="true"/g)).toHaveLength(2);
  });

  it("删除按钮只消费上游删除权限", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <WorkbenchCommandBar
          {...create_workbench_command_bar_props()}
          can_edit_files={true}
          can_delete_selected_files={false}
        />
      </TooltipProvider>,
    );

    const container = document.createElement("div");
    container.innerHTML = html;
    const delete_button = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("workbench_page.action.delete_file"),
    );

    expect(delete_button).toBeInstanceOf(HTMLButtonElement);
    expect(delete_button?.disabled).toBe(true);
  });

  it("运行中的翻译任务会自动展示详情提示", async () => {
    const props = create_workbench_command_bar_props();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <WorkbenchCommandBar
            {...props}
            active_workbench_task_view={{ task_kind: "translation", can_open_detail: true }}
            active_workbench_task_summary={{
              ...props.active_workbench_task_summary,
              show_spinner: true,
              detail_tooltip_text: "translation-running-detail",
            }}
          />
        </TooltipProvider>,
      );
    });

    expect(document.body.textContent).toContain("translation-running-detail");
  });
});
