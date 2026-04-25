import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shadcn/tooltip";
import { WorkbenchCommandBar } from "./workbench-command-bar";

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/pages/workbench-page/components/translation-task-menu", () => {
  return {
    TranslationTaskMenu: () => <button type="button">translation-task</button>,
  };
});

vi.mock("@/pages/workbench-page/components/analysis-task-menu", () => {
  return {
    AnalysisTaskMenu: () => <button type="button">analysis-task</button>,
  };
});

vi.mock("@/pages/workbench-page/components/task-runtime/task-runtime-summary", () => {
  return {
    TaskRuntimeSummary: () => <span>task-summary</span>,
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
    completion_percent: 0,
    processed_count: 0,
    failed_count: 0,
    elapsed_seconds: 0,
    remaining_seconds: 0,
    average_output_speed: 0,
    input_tokens: 0,
    output_tokens: 0,
    request_in_flight_count: 0,
  };
  const analysis_task_metrics = {
    ...translation_task_metrics,
    candidate_count: 0,
  };

  return {
    translation_task_runtime: {
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
    analysis_task_runtime: {
      analysis_task_display_snapshot: null,
      analysis_task_metrics,
      analysis_waveform_history: [],
      analysis_detail_sheet_open: false,
      analysis_confirm_state: null,
      analysis_importing: false,
      analysis_task_menu_disabled: false,
      analysis_task_menu_busy: false,
      open_analysis_detail_sheet: () => {},
      close_analysis_detail_sheet: () => {},
      request_start_or_continue_analysis: async () => {},
      request_analysis_task_action_confirmation: () => {},
      confirm_analysis_task_action: async () => {},
      close_analysis_task_action_confirmation: () => {},
      request_import_analysis_glossary: async () => {},
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
    selected_entry_count: 1,
    can_export_translation: true,
    can_close_project: true,
    on_add_file: () => {},
    on_delete_selected: () => {},
    on_export_translation: () => {},
    on_close_project: () => {},
  };
}

describe("WorkbenchCommandBar", () => {
  it("添加与删除文件按钮展示平台化快捷键提示", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <WorkbenchCommandBar {...create_workbench_command_bar_props()} />
      </TooltipProvider>,
    );

    expect(html).toContain("workbench_page.action.add_file");
    expect(html).toContain("Ctrl+N");
    expect(html).toContain("workbench_page.action.delete_file");
    expect(html).toContain("Del");
  });
});
