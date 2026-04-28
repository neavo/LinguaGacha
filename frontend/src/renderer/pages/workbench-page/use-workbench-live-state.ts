import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/runtime/project-pages/project-pages-barrier";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { is_task_stopping } from "@/app/runtime/tasks/task-lock";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import {
  create_workbench_add_files_plan,
  create_workbench_delete_files_plan,
  create_workbench_reorder_plan,
  create_workbench_reset_file_plan,
  type WorkbenchFileParsePreview,
  type WorkbenchProjectMutationPlan,
} from "@/pages/workbench-page/workbench-mutation-planner";
import {
  applyWorkbenchItemsDeltaToCache,
  createWorkbenchViewCache,
  type WorkbenchViewCache,
} from "@/pages/workbench-page/workbench-view";
import {
  useAnalysisTaskRuntime,
  type AnalysisTaskRuntime,
} from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";
import {
  useTranslationTaskRuntime,
  type TranslationTaskRuntime,
} from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";
import {
  normalize_project_mutation_ack,
  type ProjectMutationAckPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useI18n } from "@/i18n";
import { api_fetch } from "@/app/desktop-api";
import type {
  AnalysisTaskConfirmState,
  AnalysisTaskMetrics,
  AnalysisTaskSnapshot,
} from "@/pages/workbench-page/task-runtime/analysis-task-model";
import type {
  TranslationTaskConfirmState,
  TranslationTaskMetrics,
} from "@/pages/workbench-page/task-runtime/translation-task-model";
import type { AppTableSelectionChange } from "@/widgets/app-table/app-table-types";
import type {
  WorkbenchTaskConfirmDialogViewModel,
  WorkbenchTaskDetailViewModel,
  WorkbenchDialogState,
  WorkbenchFileEntry,
  WorkbenchTaskMetricEntry,
  WorkbenchSnapshot,
  WorkbenchSnapshotEntry,
  WorkbenchStats,
  WorkbenchStatsMode,
  WorkbenchTaskKind,
  WorkbenchTaskSummaryViewModel,
  WorkbenchTaskTone,
  WorkbenchTaskViewState,
} from "@/pages/workbench-page/types";

const EMPTY_WORKBENCH_STATS: WorkbenchStats = {
  total_items: 0,
  completed_count: 0,
  failed_count: 0,
  pending_count: 0,
  skipped_count: 0,
  completion_percent: 0,
};

const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  file_count: 0,
  total_items: 0,
  translation_stats: EMPTY_WORKBENCH_STATS,
  analysis_stats: EMPTY_WORKBENCH_STATS,
  entries: [],
};

function clamp_workbench_count(value: number, min_value: number, max_value: number): number {
  if (!Number.isFinite(value)) {
    return min_value;
  }

  return Math.min(max_value, Math.max(min_value, Math.floor(value)));
}

function complete_workbench_stats(args: {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
}): WorkbenchStats {
  const completed_or_skipped_count = args.completed_count + args.skipped_count;
  return {
    total_items: args.total_items,
    completed_count: args.completed_count,
    failed_count: args.failed_count,
    pending_count: args.pending_count,
    skipped_count: args.skipped_count,
    completion_percent:
      args.total_items > 0 ? (completed_or_skipped_count / args.total_items) * 100 : 0,
  };
}

function build_running_analysis_workbench_stats(args: {
  base_stats: WorkbenchStats;
  task_snapshot: AnalysisTaskSnapshot | null;
  task_metrics: AnalysisTaskMetrics;
}): WorkbenchStats {
  if (
    args.task_snapshot === null ||
    (!args.task_metrics.active && !args.task_metrics.stopping) ||
    args.task_snapshot.total_line <= 0
  ) {
    return args.base_stats;
  }

  const total_items = Math.max(args.base_stats.total_items, 0);
  const total_line = clamp_workbench_count(args.task_snapshot.total_line, 0, total_items);
  const completed_count = clamp_workbench_count(args.task_snapshot.processed_line, 0, total_line);
  const failed_count = clamp_workbench_count(
    args.task_snapshot.error_line,
    0,
    Math.max(0, total_line - completed_count),
  );
  const pending_count = Math.max(0, total_line - completed_count - failed_count);
  const skipped_count = Math.max(0, total_items - total_line);

  return complete_workbench_stats({
    total_items,
    completed_count,
    failed_count,
    pending_count,
    skipped_count,
  });
}

type PendingAddFilesRequest = {
  parsed_files: WorkbenchFileParsePreview[];
  barrier_checkpoint: ProjectPagesBarrierCheckpoint | null;
};

type WorkbenchAddFileDropIssue = "multiple" | "unavailable";

function normalize_path_key(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback_message;
}

function close_dialog_state(): WorkbenchDialogState {
  return {
    kind: null,
    target_rel_paths: [],
    pending_path: null,
    submitting: false,
  };
}

function normalize_workbench_file_parse_preview(
  source_path: string,
  payload: {
    target_rel_path?: unknown;
    file_type?: unknown;
    parsed_items?: unknown;
  },
): WorkbenchFileParsePreview {
  return {
    source_path,
    target_rel_path: String(payload.target_rel_path ?? ""),
    file_type: String(payload.file_type ?? "NONE"),
    parsed_items: Array.isArray(payload.parsed_items)
      ? payload.parsed_items.flatMap((item) => {
          return typeof item === "object" && item !== null
            ? [{ ...(item as Record<string, unknown>) }]
            : [];
        })
      : [],
  };
}

function map_snapshot_entries(entries: WorkbenchSnapshotEntry[]): WorkbenchFileEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

type WorkbenchSelectionState = {
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
};

function create_empty_selection_state(): WorkbenchSelectionState {
  return {
    selected_entry_ids: [],
    active_entry_id: null,
    anchor_entry_id: null,
  };
}

function dedupe_workbench_entry_ids(entry_ids: string[]): string[] {
  return Array.from(new Set(entry_ids));
}

function are_workbench_entry_ids_equal(
  left_entry_ids: string[],
  right_entry_ids: string[],
): boolean {
  if (left_entry_ids.length !== right_entry_ids.length) {
    return false;
  }

  return left_entry_ids.every((entry_id, index) => {
    return entry_id === right_entry_ids[index];
  });
}

function select_after_snapshot(
  previous_entries: WorkbenchFileEntry[],
  next_entries: WorkbenchFileEntry[],
  selected_rel_path: string | null,
): string | null {
  if (next_entries.length === 0) {
    return null;
  }

  if (
    selected_rel_path !== null &&
    next_entries.some((entry) => entry.rel_path === selected_rel_path)
  ) {
    return selected_rel_path;
  }

  if (selected_rel_path !== null) {
    const previous_index = previous_entries.findIndex(
      (entry) => entry.rel_path === selected_rel_path,
    );
    if (previous_index >= 0) {
      const safe_index = Math.min(previous_index, next_entries.length - 1);
      return next_entries[safe_index]?.rel_path ?? null;
    }
  }

  return next_entries[0]?.rel_path ?? null;
}

function normalize_workbench_selection_state(
  selection_state: WorkbenchSelectionState,
  entries: WorkbenchFileEntry[],
): WorkbenchSelectionState {
  const visible_entry_id_set = new Set(entries.map((entry) => entry.rel_path));
  const selected_entry_ids = dedupe_workbench_entry_ids(selection_state.selected_entry_ids).filter(
    (entry_id) => {
      return visible_entry_id_set.has(entry_id);
    },
  );
  const active_entry_id =
    selection_state.active_entry_id !== null &&
    visible_entry_id_set.has(selection_state.active_entry_id)
      ? selection_state.active_entry_id
      : null;
  const anchor_entry_id =
    selection_state.anchor_entry_id !== null &&
    visible_entry_id_set.has(selection_state.anchor_entry_id)
      ? selection_state.anchor_entry_id
      : null;

  return {
    selected_entry_ids,
    active_entry_id,
    anchor_entry_id,
  };
}

function resolve_workbench_selection_after_snapshot(args: {
  previous_entries: WorkbenchFileEntry[];
  next_entries: WorkbenchFileEntry[];
  previous_selection_state: WorkbenchSelectionState;
  preferred_active_entry_id: string | null;
}): WorkbenchSelectionState {
  const normalized_selection_state = normalize_workbench_selection_state(
    args.previous_selection_state,
    args.next_entries,
  );

  if (normalized_selection_state.selected_entry_ids.length > 0) {
    const active_entry_id =
      normalized_selection_state.active_entry_id ??
      normalized_selection_state.selected_entry_ids.at(-1) ??
      null;
    const anchor_entry_id =
      normalized_selection_state.anchor_entry_id ??
      normalized_selection_state.selected_entry_ids[0] ??
      active_entry_id;

    return {
      selected_entry_ids: normalized_selection_state.selected_entry_ids,
      active_entry_id,
      anchor_entry_id,
    };
  }

  const fallback_entry_id = select_after_snapshot(
    args.previous_entries,
    args.next_entries,
    args.preferred_active_entry_id ??
      args.previous_selection_state.active_entry_id ??
      args.previous_selection_state.selected_entry_ids.at(-1) ??
      null,
  );

  if (fallback_entry_id === null) {
    return create_empty_selection_state();
  }

  return {
    selected_entry_ids: [fallback_entry_id],
    active_entry_id: fallback_entry_id,
    anchor_entry_id: fallback_entry_id,
  };
}

function is_workbench_task_kind(value: string): value is WorkbenchTaskKind {
  return value === "translation" || value === "analysis";
}

function resolve_active_workbench_task_kind(args: {
  running_task_kind: WorkbenchTaskKind | null;
  recent_task_kind: WorkbenchTaskKind | null;
  fallback_task_kind: WorkbenchTaskKind | null;
  has_translation_display: boolean;
  has_analysis_display: boolean;
}): WorkbenchTaskKind | null {
  if (args.running_task_kind !== null) {
    return args.running_task_kind;
  }

  if (args.recent_task_kind === "translation" && args.has_translation_display) {
    return "translation";
  }
  if (args.recent_task_kind === "analysis" && args.has_analysis_display) {
    return "analysis";
  }

  if (args.has_translation_display && !args.has_analysis_display) {
    return "translation";
  }
  if (args.has_analysis_display && !args.has_translation_display) {
    return "analysis";
  }

  if (
    args.fallback_task_kind !== null &&
    ((args.fallback_task_kind === "translation" && args.has_translation_display) ||
      (args.fallback_task_kind === "analysis" && args.has_analysis_display))
  ) {
    return args.fallback_task_kind;
  }

  return null;
}

function format_duration_value(
  seconds: number,
): Pick<WorkbenchTaskMetricEntry, "value_text" | "unit_text"> {
  const normalized_seconds = Math.max(0, Math.floor(seconds));

  if (normalized_seconds < 60) {
    return {
      value_text: normalized_seconds.toString(),
      unit_text: "S",
    };
  }

  if (normalized_seconds < 60 * 60) {
    return {
      value_text: (normalized_seconds / 60).toFixed(2),
      unit_text: "M",
    };
  }

  return {
    value_text: (normalized_seconds / 60 / 60).toFixed(2),
    unit_text: "H",
  };
}

function format_compact_metric_value(
  value: number,
  base_unit: string,
): Pick<WorkbenchTaskMetricEntry, "value_text" | "unit_text"> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(0),
      unit_text: base_unit,
    };
  }

  if (value < 1000 * 1000) {
    return {
      value_text: (value / 1000).toFixed(2),
      unit_text: `K${base_unit}`,
    };
  }

  return {
    value_text: (value / 1000 / 1000).toFixed(2),
    unit_text: `M${base_unit}`,
  };
}

function format_speed_value(
  value: number,
): Pick<WorkbenchTaskMetricEntry, "value_text" | "unit_text"> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(2),
      unit_text: "T/S",
    };
  }

  return {
    value_text: (value / 1000).toFixed(2),
    unit_text: "KT/S",
  };
}

function format_summary_speed(value: number): string {
  const metric_value = format_speed_value(value);
  return `${metric_value.value_text} ${metric_value.unit_text}`;
}

function resolve_task_tone(args: {
  active: boolean;
  stopping: boolean;
  emphasized_when_idle?: boolean;
}): WorkbenchTaskTone {
  if (args.stopping) {
    return "warning";
  }

  if (args.active || args.emphasized_when_idle) {
    return "success";
  }

  return "neutral";
}

function resolve_percent_tone(
  metrics: Pick<TranslationTaskMetrics, "active" | "stopping">,
): WorkbenchTaskTone {
  return resolve_task_tone({
    active: metrics.active,
    stopping: metrics.stopping,
  });
}

function build_translation_task_metric_entries(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskMetricEntry[] {
  return [
    {
      key: "elapsed",
      label: t("workbench_page.translation_task.detail.elapsed_time"),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: "remaining-time",
      label: t("workbench_page.translation_task.detail.remaining_time"),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: "speed",
      label: t("workbench_page.translation_task.detail.average_speed"),
      ...format_speed_value(metrics.average_output_speed),
    },
    {
      key: "input-tokens",
      label: t("workbench_page.translation_task.detail.input_tokens"),
      ...format_compact_metric_value(metrics.input_tokens, "T"),
    },
    {
      key: "output-tokens",
      label: t("workbench_page.translation_task.detail.output_tokens"),
      ...format_compact_metric_value(metrics.output_tokens, "T"),
    },
    {
      key: "active-requests",
      label: t("workbench_page.translation_task.detail.active_requests"),
      ...format_compact_metric_value(metrics.request_in_flight_count, "Task"),
    },
  ];
}

function build_analysis_task_metric_entries(
  metrics: AnalysisTaskMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskMetricEntry[] {
  return [
    {
      key: "elapsed",
      label: t("workbench_page.analysis_task.detail.elapsed_time"),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: "remaining-time",
      label: t("workbench_page.analysis_task.detail.remaining_time"),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: "speed",
      label: t("workbench_page.analysis_task.detail.average_speed"),
      ...format_speed_value(metrics.average_output_speed),
    },
    {
      key: "input-tokens",
      label: t("workbench_page.analysis_task.detail.input_tokens"),
      ...format_compact_metric_value(metrics.input_tokens, "T"),
    },
    {
      key: "output-tokens",
      label: t("workbench_page.analysis_task.detail.output_tokens"),
      ...format_compact_metric_value(metrics.output_tokens, "T"),
    },
    {
      key: "active-requests",
      label: t("workbench_page.analysis_task.detail.active_requests"),
      ...format_compact_metric_value(metrics.request_in_flight_count, "Task"),
    },
    {
      key: "candidate-count",
      label: t("workbench_page.analysis_task.detail.candidate_count"),
      ...format_compact_metric_value(metrics.candidate_count, "Term"),
    },
  ];
}

function build_empty_task_summary_view_model(
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskSummaryViewModel {
  return {
    status_text: t("workbench_page.translation_task.summary.empty"),
    trailing_text: null,
    tone: "neutral",
    show_spinner: false,
    detail_tooltip_text: t("workbench_page.translation_task.summary.detail_tooltip"),
  };
}

function build_translation_task_summary_view_model(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskSummaryViewModel {
  let status_text = t("workbench_page.translation_task.summary.empty");
  if (metrics.stopping) {
    status_text = t("workbench_page.translation_task.summary.stopping");
  } else if (metrics.active) {
    status_text = t("workbench_page.translation_task.summary.running");
  }

  const show_runtime = metrics.active || metrics.stopping;

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_output_speed) : null,
    tone: resolve_task_tone({
      active: metrics.active,
      stopping: metrics.stopping,
    }),
    show_spinner: show_runtime,
    detail_tooltip_text: t("workbench_page.translation_task.summary.detail_tooltip"),
  };
}

function build_analysis_task_summary_view_model(
  metrics: AnalysisTaskMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskSummaryViewModel {
  let status_text = t("workbench_page.analysis_task.summary.empty");
  if (metrics.stopping) {
    status_text = t("workbench_page.analysis_task.summary.stopping");
  } else if (metrics.active) {
    status_text = t("workbench_page.analysis_task.summary.running");
  }
  const show_runtime = metrics.active || metrics.stopping;

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_output_speed) : null,
    tone: resolve_task_tone({
      active: metrics.active,
      stopping: metrics.stopping,
    }),
    show_spinner: show_runtime,
    detail_tooltip_text: t("workbench_page.analysis_task.summary.detail_tooltip"),
  };
}

function build_translation_task_detail_view_model(args: {
  metrics: TranslationTaskMetrics;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t("workbench_page.translation_task.detail.title"),
    description: args.t("workbench_page.translation_task.detail.description"),
    waveform_title: args.t("workbench_page.translation_task.detail.waveform_title"),
    metrics_title: args.t("workbench_page.translation_task.detail.metrics_title"),
    completion_percent_text: `${args.metrics.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("workbench_page.action.translation_stopping")
      : args.t("workbench_page.action.stop_translation"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}

function build_analysis_task_detail_view_model(args: {
  metrics: AnalysisTaskMetrics;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t("workbench_page.analysis_task.detail.title"),
    description: args.t("workbench_page.analysis_task.detail.description"),
    waveform_title: args.t("workbench_page.analysis_task.detail.waveform_title"),
    metrics_title: args.t("workbench_page.analysis_task.detail.metrics_title"),
    completion_percent_text: `${args.metrics.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_analysis_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("workbench_page.action.analysis_stopping")
      : args.t("workbench_page.action.stop_analysis"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}

function build_translation_task_confirm_dialog_view_model(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogViewModel | null {
  if (state === null) {
    return null;
  }

  if (state.kind === "reset-all") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "export-translation") {
    return {
      open: state.open,
      description: t("workbench_page.translation_task.confirm.export_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    description: t("workbench_page.translation_task.confirm.stop_description"),
    submitting: state.submitting,
  };
}

function build_analysis_task_confirm_dialog_view_model(
  state: AnalysisTaskConfirmState | null,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTaskConfirmDialogViewModel | null {
  if (state === null) {
    return null;
  }

  if (state.kind === "reset-all") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "import-glossary") {
    return {
      open: state.open,
      description: t("workbench_page.analysis_task.confirm.import_glossary_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    description: t("workbench_page.analysis_task.confirm.stop_description"),
    submitting: state.submitting,
  };
}

export type UseWorkbenchLiveStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  cache_stale: boolean;
  last_loaded_at: number | null;
  refresh_request_id: number;
  settled_project_path: string;
  is_refreshing: boolean;
  file_op_running: boolean;
  stats: WorkbenchStats;
  translation_stats: WorkbenchStats;
  analysis_stats: WorkbenchStats;
  stats_mode: WorkbenchStatsMode;
  translation_task_runtime: TranslationTaskRuntime;
  analysis_task_runtime: AnalysisTaskRuntime;
  active_workbench_task_view: WorkbenchTaskViewState;
  active_workbench_task_summary: WorkbenchTaskSummaryViewModel;
  active_workbench_task_detail: WorkbenchTaskDetailViewModel | null;
  translation_task_confirm_dialog: WorkbenchTaskConfirmDialogViewModel | null;
  analysis_task_confirm_dialog: WorkbenchTaskConfirmDialogViewModel | null;
  entries: WorkbenchFileEntry[];
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
  readonly: boolean;
  can_edit_files: boolean;
  can_export_translation: boolean;
  can_close_project: boolean;
  dialog_state: WorkbenchDialogState;
  refresh_snapshot: () => Promise<WorkbenchSnapshot>;
  toggle_stats_mode: () => void;
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  prepare_entry_action: (entry_id: string) => void;
  request_add_file: () => Promise<void>;
  request_add_file_from_path: (source_path: string) => Promise<void>;
  request_add_files_from_paths: (source_paths: string[]) => Promise<void>;
  notify_add_file_drop_issue: (issue: WorkbenchAddFileDropIssue) => void;
  request_export_translation: () => void;
  request_close_project: () => void;
  request_reset_file: (entry_id: string) => void;
  request_delete_selected_files: () => void;
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>;
  confirm_dialog: () => Promise<void>;
  cancel_dialog: () => Promise<void>;
  close_dialog: () => void;
};

export type UseWorkbenchLiveStateOptions = {
  createProjectPagesBarrierCheckpoint?: () => ProjectPagesBarrierCheckpoint;
  waitForProjectPagesBarrier?: (
    kind: Exclude<ProjectPagesBarrierKind, "project_warmup">,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>;
};

export function useWorkbenchLiveState(
  options: UseWorkbenchLiveStateOptions = {},
): UseWorkbenchLiveStateResult {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const raw_translation_task_runtime = useTranslationTaskRuntime({
    createProjectPagesBarrierCheckpoint: options.createProjectPagesBarrierCheckpoint,
    waitForProjectPagesBarrier: options.waitForProjectPagesBarrier,
  });
  const raw_analysis_task_runtime = useAnalysisTaskRuntime({
    createProjectPagesBarrierCheckpoint: options.createProjectPagesBarrierCheckpoint,
    waitForProjectPagesBarrier: options.waitForProjectPagesBarrier,
  });
  const {
    align_project_runtime_ack,
    commit_local_project_patch,
    project_snapshot,
    project_store,
    refresh_project_runtime,
    workbench_change_signal,
    refresh_task,
    settings_snapshot,
    set_project_snapshot,
    task_snapshot,
  } = useDesktopRuntime();
  const [snapshot, set_snapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT);
  const [entries, set_entries] = useState<WorkbenchFileEntry[]>([]);
  const [cache_status, set_cache_status] = useState<"idle" | "refreshing" | "ready" | "error">(
    "idle",
  );
  const [cache_stale, set_cache_stale] = useState(false);
  const [last_loaded_at, set_last_loaded_at] = useState<number | null>(null);
  const [refresh_request_id, set_refresh_request_id] = useState(0);
  const [settled_project_path, set_settled_project_path] = useState("");
  const [is_refreshing, set_is_refreshing] = useState(false);
  const [file_op_running, set_file_op_running] = useState(false);
  const [selected_entry_ids, set_selected_entry_ids] = useState<string[]>([]);
  const [active_entry_id, set_active_entry_id] = useState<string | null>(null);
  const [anchor_entry_id, set_anchor_entry_id] = useState<string | null>(null);
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state());
  const [pending_add_files_request, set_pending_add_files_request] =
    useState<PendingAddFilesRequest | null>(null);
  const [is_mutation_running, set_is_mutation_running] = useState(false);
  const [recent_workbench_task_kind, set_recent_workbench_task_kind] =
    useState<WorkbenchTaskKind | null>(null);
  const [stats_mode, set_stats_mode] = useState<WorkbenchStatsMode>("translation");
  const previous_workbench_change_seq_ref = useRef(workbench_change_signal.seq);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const refresh_request_id_ref = useRef(0);
  const snapshot_ref = useRef(snapshot);
  const workbench_view_cache_ref = useRef<WorkbenchViewCache | null>(null);
  const entries_ref = useRef<WorkbenchFileEntry[]>(entries);
  const selection_state_ref = useRef<WorkbenchSelectionState>(create_empty_selection_state());

  const current_selection_state = useMemo<WorkbenchSelectionState>(() => {
    return {
      selected_entry_ids,
      active_entry_id,
      anchor_entry_id,
    };
  }, [active_entry_id, anchor_entry_id, selected_entry_ids]);

  const apply_selection_state = useCallback(
    (next_selection_state: WorkbenchSelectionState): void => {
      set_selected_entry_ids((previous_entry_ids) => {
        return are_workbench_entry_ids_equal(
          previous_entry_ids,
          next_selection_state.selected_entry_ids,
        )
          ? previous_entry_ids
          : next_selection_state.selected_entry_ids;
      });
      set_active_entry_id((previous_entry_id) => {
        return previous_entry_id === next_selection_state.active_entry_id
          ? previous_entry_id
          : next_selection_state.active_entry_id;
      });
      set_anchor_entry_id((previous_entry_id) => {
        return previous_entry_id === next_selection_state.anchor_entry_id
          ? previous_entry_id
          : next_selection_state.anchor_entry_id;
      });
    },
    [],
  );

  useEffect(() => {
    snapshot_ref.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    entries_ref.current = entries;
  }, [entries]);

  useEffect(() => {
    selection_state_ref.current = current_selection_state;
  }, [current_selection_state]);

  const clear_workbench_snapshot_state = useCallback((): void => {
    refresh_request_id_ref.current = 0;
    set_refresh_request_id(0);
    snapshot_ref.current = EMPTY_SNAPSHOT;
    workbench_view_cache_ref.current = null;
    set_snapshot(EMPTY_SNAPSHOT);
    set_file_op_running(false);
    set_entries([]);
    apply_selection_state(create_empty_selection_state());
    set_dialog_state(close_dialog_state());
    set_pending_add_files_request(null);
    set_is_refreshing(false);
    set_cache_stale(false);
    set_last_loaded_at(null);
    set_settled_project_path("");
  }, [apply_selection_state]);

  const apply_refreshed_entries = useCallback(
    (next_snapshot: WorkbenchSnapshot, preferred_active_entry_id: string | null): void => {
      const previous_entries = entries_ref.current;
      const previous_selection_state = selection_state_ref.current;
      const next_entries = map_snapshot_entries(next_snapshot.entries);

      set_entries(next_entries);
      apply_selection_state(
        resolve_workbench_selection_after_snapshot({
          previous_entries,
          next_entries,
          previous_selection_state,
          preferred_active_entry_id,
        }),
      );
    },
    [apply_selection_state],
  );

  const refresh_snapshot = useCallback(
    async (preferred_active_entry_id: string | null = null): Promise<WorkbenchSnapshot> => {
      if (!project_snapshot.loaded) {
        clear_workbench_snapshot_state();
        set_cache_status("idle");
        return EMPTY_SNAPSHOT;
      }

      const request_id = refresh_request_id_ref.current + 1;
      refresh_request_id_ref.current = request_id;
      set_refresh_request_id(request_id);
      set_is_refreshing(true);
      set_cache_status("refreshing");

      try {
        const next_cache = createWorkbenchViewCache(project_store.getState());
        const next_snapshot = next_cache.snapshot;

        if (request_id !== refresh_request_id_ref.current) {
          return next_snapshot;
        }

        workbench_view_cache_ref.current = next_cache;
        snapshot_ref.current = next_snapshot;
        set_snapshot(next_snapshot);
        apply_refreshed_entries(next_snapshot, preferred_active_entry_id);
        set_file_op_running(false);
        set_cache_status("ready");
        set_cache_stale(false);
        set_last_loaded_at(Date.now());
        set_settled_project_path(project_snapshot.path);
        return next_snapshot;
      } catch (error) {
        if (request_id !== refresh_request_id_ref.current) {
          return EMPTY_SNAPSHOT;
        }

        const message = resolve_error_message(error, t("workbench_page.feedback.refresh_failed"));
        set_cache_status("error");
        set_cache_stale(true);
        set_file_op_running(false);
        set_settled_project_path(project_snapshot.path);
        push_toast("error", message);
        return snapshot_ref.current;
      } finally {
        if (request_id === refresh_request_id_ref.current) {
          set_is_refreshing(false);
        }
      }
    },
    [
      apply_refreshed_entries,
      clear_workbench_snapshot_state,
      project_store,
      project_snapshot.loaded,
      project_snapshot.path,
      push_toast,
      t,
    ],
  );

  const apply_items_delta_snapshot = useCallback(
    (item_ids: Array<number | string>): boolean => {
      if (!project_snapshot.loaded || workbench_view_cache_ref.current === null) {
        return false;
      }

      const next_cache = applyWorkbenchItemsDeltaToCache({
        cache: workbench_view_cache_ref.current,
        state: project_store.getState(),
        item_ids,
      });
      if (next_cache === null) {
        return false;
      }

      const next_snapshot = next_cache.snapshot;
      workbench_view_cache_ref.current = next_cache;
      snapshot_ref.current = next_snapshot;
      set_snapshot(next_snapshot);
      apply_refreshed_entries(next_snapshot, null);
      set_file_op_running(false);
      set_cache_status("ready");
      set_cache_stale(false);
      set_last_loaded_at(Date.now());
      set_settled_project_path(project_snapshot.path);
      return true;
    },
    [apply_refreshed_entries, project_snapshot.loaded, project_snapshot.path, project_store],
  );

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      clear_workbench_snapshot_state();
      set_cache_status("idle");
      set_recent_workbench_task_kind(null);
      set_stats_mode("translation");
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_workbench_snapshot_state();
      set_cache_status("refreshing");
      set_recent_workbench_task_kind(null);
      set_stats_mode("translation");
    }
  }, [clear_workbench_snapshot_state, project_snapshot.loaded, project_snapshot.path]);

  useEffect(() => {
    const previous_seq = previous_workbench_change_seq_ref.current;
    previous_workbench_change_seq_ref.current = workbench_change_signal.seq;

    if (!project_snapshot.loaded) {
      return;
    }

    if (previous_seq !== workbench_change_signal.seq) {
      set_cache_stale(true);
      if (
        workbench_change_signal.mode === "items_delta" &&
        apply_items_delta_snapshot(workbench_change_signal.item_ids)
      ) {
        return;
      }
      void refresh_snapshot().catch(() => {});
    }
  }, [
    apply_items_delta_snapshot,
    project_snapshot.loaded,
    refresh_snapshot,
    workbench_change_signal.item_ids,
    workbench_change_signal.mode,
    workbench_change_signal.seq,
  ]);

  const running_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    if (!task_snapshot.busy) {
      return null;
    }

    if (is_workbench_task_kind(task_snapshot.task_type)) {
      return task_snapshot.task_type;
    }

    return null;
  }, [task_snapshot.busy, task_snapshot.task_type]);

  const fallback_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    if (is_workbench_task_kind(task_snapshot.task_type)) {
      return task_snapshot.task_type;
    }

    return null;
  }, [task_snapshot.task_type]);

  useEffect(() => {
    if (running_workbench_task_kind !== null) {
      // 为什么：任务一旦开始，顶部卡片就该马上切到对应语义，避免统计视角和底部状态栏互相打架。
      set_stats_mode(running_workbench_task_kind);
    }
  }, [running_workbench_task_kind]);

  const toggle_stats_mode = useCallback((): void => {
    set_stats_mode((previous_mode) => {
      return previous_mode === "translation" ? "analysis" : "translation";
    });
  }, []);

  const display_analysis_stats = useMemo<WorkbenchStats>(() => {
    return build_running_analysis_workbench_stats({
      base_stats: snapshot.analysis_stats,
      task_snapshot: raw_analysis_task_runtime.analysis_task_display_snapshot,
      task_metrics: raw_analysis_task_runtime.analysis_task_metrics,
    });
  }, [
    raw_analysis_task_runtime.analysis_task_display_snapshot,
    raw_analysis_task_runtime.analysis_task_metrics,
    snapshot.analysis_stats,
  ]);

  const stats = useMemo<WorkbenchStats>(() => {
    return stats_mode === "analysis" ? display_analysis_stats : snapshot.translation_stats;
  }, [display_analysis_stats, snapshot.translation_stats, stats_mode]);

  const has_translation_display =
    raw_translation_task_runtime.translation_task_display_snapshot !== null;
  const has_analysis_display = raw_analysis_task_runtime.analysis_task_display_snapshot !== null;

  const active_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    return resolve_active_workbench_task_kind({
      running_task_kind: running_workbench_task_kind,
      recent_task_kind: recent_workbench_task_kind,
      fallback_task_kind: fallback_workbench_task_kind,
      has_translation_display,
      has_analysis_display,
    });
  }, [
    fallback_workbench_task_kind,
    has_analysis_display,
    has_translation_display,
    recent_workbench_task_kind,
    running_workbench_task_kind,
  ]);

  const display_workbench_task_kind = active_workbench_task_kind ?? "translation";

  const active_workbench_task_view = useMemo<WorkbenchTaskViewState>(() => {
    return {
      task_kind: display_workbench_task_kind,
      can_open_detail: true,
    };
  }, [display_workbench_task_kind]);

  const active_workbench_task_summary = useMemo<WorkbenchTaskSummaryViewModel>(() => {
    if (active_workbench_task_kind === "translation") {
      return build_translation_task_summary_view_model(
        raw_translation_task_runtime.translation_task_metrics,
        t,
      );
    }

    if (active_workbench_task_kind === "analysis") {
      return build_analysis_task_summary_view_model(
        raw_analysis_task_runtime.analysis_task_metrics,
        t,
      );
    }

    return build_empty_task_summary_view_model(t);
  }, [
    active_workbench_task_kind,
    raw_analysis_task_runtime.analysis_task_metrics,
    raw_translation_task_runtime.translation_task_metrics,
    t,
  ]);

  const active_workbench_task_detail = useMemo<WorkbenchTaskDetailViewModel | null>(() => {
    // 为什么：工作台空态也要保留可点击的详情胶囊，默认沿用翻译任务模板展示基础指标。
    if (display_workbench_task_kind === "translation") {
      return build_translation_task_detail_view_model({
        metrics: raw_translation_task_runtime.translation_task_metrics,
        waveform_history: raw_translation_task_runtime.translation_waveform_history,
        t,
      });
    }

    if (display_workbench_task_kind === "analysis") {
      return build_analysis_task_detail_view_model({
        metrics: raw_analysis_task_runtime.analysis_task_metrics,
        waveform_history: raw_analysis_task_runtime.analysis_waveform_history,
        t,
      });
    }

    return null;
  }, [
    display_workbench_task_kind,
    raw_analysis_task_runtime.analysis_task_metrics,
    raw_analysis_task_runtime.analysis_waveform_history,
    raw_translation_task_runtime.translation_task_metrics,
    raw_translation_task_runtime.translation_waveform_history,
    t,
  ]);

  const translation_task_confirm_dialog =
    useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
      return build_translation_task_confirm_dialog_view_model(
        raw_translation_task_runtime.task_confirm_state,
        t,
      );
    }, [raw_translation_task_runtime.task_confirm_state, t]);

  const analysis_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
    return build_analysis_task_confirm_dialog_view_model(
      raw_analysis_task_runtime.analysis_confirm_state,
      t,
    );
  }, [raw_analysis_task_runtime.analysis_confirm_state, t]);

  useEffect(() => {
    if (running_workbench_task_kind !== null) {
      set_recent_workbench_task_kind(running_workbench_task_kind);
    }
  }, [running_workbench_task_kind]);

  useEffect(() => {
    if (active_workbench_task_view.task_kind === "translation") {
      raw_analysis_task_runtime.close_analysis_detail_sheet();
      return;
    }

    if (active_workbench_task_view.task_kind === "analysis") {
      raw_translation_task_runtime.close_translation_detail_sheet();
      return;
    }

    raw_translation_task_runtime.close_translation_detail_sheet();
    raw_analysis_task_runtime.close_analysis_detail_sheet();
  }, [
    active_workbench_task_view.task_kind,
    raw_analysis_task_runtime,
    raw_translation_task_runtime,
  ]);

  const readonly =
    !project_snapshot.loaded || task_snapshot.busy || file_op_running || is_mutation_running;
  const can_edit_files = !readonly;
  const export_translation_submitting =
    dialog_state.kind === "export-translation" && dialog_state.submitting;
  const can_export_translation =
    project_snapshot.loaded &&
    !file_op_running &&
    !is_mutation_running &&
    !export_translation_submitting &&
    !is_task_stopping(task_snapshot);
  const can_close_project = project_snapshot.loaded && !task_snapshot.busy && !is_mutation_running;

  const set_dialog_submitting = useCallback((next_submitting: boolean): void => {
    set_dialog_state((previous_state) => {
      if (previous_state.kind === null) {
        return previous_state;
      }

      return {
        ...previous_state,
        submitting: next_submitting,
      };
    });
  }, []);

  const run_ack_only_file_mutation = useCallback(
    async (
      plan: WorkbenchProjectMutationPlan,
      request: (body: Record<string, unknown>) => Promise<ProjectMutationAckPayload>,
      barrier_checkpoint: ProjectPagesBarrierCheckpoint | null,
    ): Promise<void> => {
      set_is_mutation_running(true);
      set_file_op_running(true);
      const local_commit = commit_local_project_patch({
        source: "workbench_mutation",
        updatedSections: plan.updatedSections,
        patch: plan.patch,
      });

      try {
        const mutation_ack = normalize_project_mutation_ack(await request(plan.requestBody));
        align_project_runtime_ack(mutation_ack);
        if (options.waitForProjectPagesBarrier !== undefined) {
          await options.waitForProjectPagesBarrier("workbench_file_mutation", {
            checkpoint: barrier_checkpoint,
          });
        }
      } catch (error) {
        set_file_op_running(false);
        local_commit.rollback();
        void refresh_project_runtime().catch(() => {});
        throw error;
      } finally {
        set_is_mutation_running(false);
      }
    },
    [align_project_runtime_ack, commit_local_project_patch, options, refresh_project_runtime],
  );

  const execute_add_file_request = useCallback(
    async (
      pending_request: PendingAddFilesRequest,
      inheritance_mode: "none" | "inherit",
    ): Promise<void> => {
      const add_plan = create_workbench_add_files_plan({
        state: project_store.getState(),
        parsed_files: pending_request.parsed_files,
        settings: {
          source_language: settings_snapshot.source_language,
          mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
        },
        inheritance_mode,
      });
      await run_ack_only_file_mutation(
        add_plan,
        async (body) => {
          return await api_fetch<ProjectMutationAckPayload>(
            "/api/project/workbench/add-file-batch",
            body,
          );
        },
        pending_request.barrier_checkpoint,
      );
      set_pending_add_files_request(null);
      set_dialog_state(close_dialog_state());
    },
    [
      project_store,
      run_ack_only_file_mutation,
      settings_snapshot.mtool_optimizer_enable,
      settings_snapshot.source_language,
    ],
  );

  const apply_table_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      apply_selection_state({
        selected_entry_ids: payload.selected_row_ids,
        active_entry_id: payload.active_row_id,
        anchor_entry_id: payload.anchor_row_id,
      });
    },
    [apply_selection_state],
  );

  const prepare_entry_action = useCallback(
    (entry_id: string): void => {
      const current_state = selection_state_ref.current;
      if (current_state.selected_entry_ids.includes(entry_id)) {
        apply_selection_state({
          selected_entry_ids: current_state.selected_entry_ids,
          active_entry_id: entry_id,
          anchor_entry_id: current_state.anchor_entry_id ?? entry_id,
        });
        return;
      }

      apply_selection_state({
        selected_entry_ids: [entry_id],
        active_entry_id: entry_id,
        anchor_entry_id: entry_id,
      });
    },
    [apply_selection_state],
  );

  const request_delete_entries = useCallback(
    (entry_ids: string[]): void => {
      const visible_entry_id_set = new Set(entries.map((entry) => entry.rel_path));
      const target_rel_paths = dedupe_workbench_entry_ids(entry_ids).filter((entry_id) => {
        return visible_entry_id_set.has(entry_id);
      });

      if (target_rel_paths.length === 0) {
        return;
      }

      set_dialog_state({
        kind: "delete-file",
        target_rel_paths,
        pending_path: null,
        submitting: false,
      });
    },
    [entries],
  );

  const request_add_files_from_paths = useCallback(
    async (source_paths: string[]): Promise<void> => {
      if (readonly) {
        return;
      }

      const normalized_source_paths = Array.from(
        new Set(
          source_paths
            .map((source_path) => source_path.trim())
            .filter((source_path) => source_path !== ""),
        ),
      );
      if (normalized_source_paths.length === 0) {
        push_toast("error", t("workbench_page.feedback.no_valid_file"));
        return;
      }

      const barrier_checkpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;
      const parsed_files: WorkbenchFileParsePreview[] = [];
      const state = project_store.getState();
      const existing_target_path_set = new Set(
        Object.values(state.files).flatMap((file) => {
          if (typeof file !== "object" || file === null) {
            return [];
          }
          const rel_path = String((file as { rel_path?: unknown }).rel_path ?? "").trim();
          return rel_path === "" ? [] : [normalize_path_key(rel_path)];
        }),
      );
      const batch_target_path_set = new Set<string>();

      await run_modal_progress_toast({
        message: t("workbench_page.feedback.add_file_loading_toast"),
        task: async () => {
          for (const source_path of normalized_source_paths) {
            try {
              const parsed_file = normalize_workbench_file_parse_preview(
                source_path,
                await api_fetch<{
                  target_rel_path?: unknown;
                  file_type?: unknown;
                  parsed_items?: unknown;
                }>("/api/project/workbench/parse-file", {
                  source_path,
                }),
              );
              const target_path_key = normalize_path_key(parsed_file.target_rel_path);
              if (
                target_path_key === "" ||
                existing_target_path_set.has(target_path_key) ||
                batch_target_path_set.has(target_path_key)
              ) {
                continue;
              }
              batch_target_path_set.add(target_path_key);
              parsed_files.push({
                ...parsed_file,
                target_rel_path: parsed_file.target_rel_path.trim(),
              });
            } catch {
              // 批量添加只在整批无有效项时提示，单项解析失败按计划静默跳过。
            }
          }
        },
      });

      if (parsed_files.length === 0) {
        push_toast("error", t("workbench_page.feedback.no_valid_file"));
        return;
      }

      set_pending_add_files_request({
        parsed_files,
        barrier_checkpoint,
      });
      set_dialog_state({
        kind: "inherit-add-file",
        target_rel_paths: parsed_files.map((parsed_file) => parsed_file.target_rel_path),
        pending_path: parsed_files[0]?.source_path ?? null,
        submitting: false,
      });
    },
    [
      options.createProjectPagesBarrierCheckpoint,
      project_store,
      push_toast,
      readonly,
      run_modal_progress_toast,
      t,
    ],
  );

  const request_add_file_from_path = useCallback(
    async (source_path: string): Promise<void> => {
      await request_add_files_from_paths([source_path]);
    },
    [request_add_files_from_paths],
  );

  async function request_add_file(): Promise<void> {
    if (readonly) {
      return;
    }

    const result = await window.desktopApp.pickWorkbenchFilePath();
    if (result.canceled || result.paths.length === 0) {
      return;
    }
    await request_add_files_from_paths(result.paths);
  }

  function notify_add_file_drop_issue(issue: WorkbenchAddFileDropIssue): void {
    push_toast(
      "warning",
      issue === "multiple" ? t("app.drop.multiple_unavailable") : t("app.drop.unavailable"),
    );
  }

  function request_export_translation(): void {
    if (!can_export_translation) {
      return;
    }

    set_dialog_state({
      kind: "export-translation",
      target_rel_paths: [],
      pending_path: null,
      submitting: false,
    });
  }

  function request_close_project(): void {
    set_dialog_state({
      kind: "close-project",
      target_rel_paths: [],
      pending_path: null,
      submitting: false,
    });
  }

  function request_reset_file(entry_id: string): void {
    set_dialog_state({
      kind: "reset-file",
      target_rel_paths: [entry_id],
      pending_path: null,
      submitting: false,
    });
  }

  function request_delete_selected_files(): void {
    request_delete_entries(selection_state_ref.current.selected_entry_ids);
  }

  const request_reorder_entries = useCallback(
    async (ordered_entry_ids: string[]): Promise<void> => {
      if (readonly) {
        return;
      }

      if (ordered_entry_ids.length !== entries.length) {
        return;
      }
      if (new Set(ordered_entry_ids).size !== ordered_entry_ids.length) {
        return;
      }

      try {
        const reorder_plan = create_workbench_reorder_plan({
          state: project_store.getState(),
          ordered_rel_paths: ordered_entry_ids,
        });
        await run_ack_only_file_mutation(
          reorder_plan,
          async (body) => {
            return await api_fetch<ProjectMutationAckPayload>(
              "/api/project/workbench/reorder-files",
              body,
            );
          },
          null,
        );
      } catch {
        push_toast("error", t("workbench_page.reorder.failed"));
      }
    },
    [entries.length, project_store, push_toast, readonly, run_ack_only_file_mutation, t],
  );

  async function confirm_dialog(): Promise<void> {
    const current_dialog_state = dialog_state;
    if (current_dialog_state.kind === null || current_dialog_state.submitting) {
      return;
    }

    const barrier_checkpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;
    const target_rel_path = current_dialog_state.target_rel_paths[0] ?? null;
    set_dialog_submitting(true);

    try {
      if (current_dialog_state.kind === "inherit-add-file") {
        if (pending_add_files_request === null) {
          set_dialog_submitting(false);
          return;
        }

        await execute_add_file_request(pending_add_files_request, "inherit");
        return;
      }

      if (current_dialog_state.kind === "reset-file") {
        if (target_rel_path === null) {
          set_dialog_submitting(false);
          return;
        }

        const reset_plan = create_workbench_reset_file_plan({
          state: project_store.getState(),
          rel_path: target_rel_path,
          settings: {
            source_language: settings_snapshot.source_language,
            mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
          },
        });
        await run_ack_only_file_mutation(
          reset_plan,
          async (body) => {
            return await api_fetch<ProjectMutationAckPayload>(
              "/api/project/workbench/reset-file",
              body,
            );
          },
          barrier_checkpoint,
        );
        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "delete-file") {
        if (current_dialog_state.target_rel_paths.length === 0) {
          set_dialog_submitting(false);
          return;
        }

        const delete_plan = create_workbench_delete_files_plan({
          state: project_store.getState(),
          rel_paths: current_dialog_state.target_rel_paths,
          settings: {
            source_language: settings_snapshot.source_language,
            mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
          },
        });
        await run_ack_only_file_mutation(
          delete_plan,
          async (body) => {
            return await api_fetch<ProjectMutationAckPayload>(
              current_dialog_state.target_rel_paths.length === 1
                ? "/api/project/workbench/delete-file"
                : "/api/project/workbench/delete-file-batch",
              current_dialog_state.target_rel_paths.length === 1
                ? {
                    ...body,
                    rel_path: current_dialog_state.target_rel_paths[0],
                  }
                : body,
            );
          },
          barrier_checkpoint,
        );

        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "export-translation") {
        if (!can_export_translation) {
          set_dialog_submitting(false);
          return;
        }

        await api_fetch("/api/tasks/export-translation", {});
        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "close-project") {
        set_is_mutation_running(true);
        try {
          const payload = await api_fetch<{
            project?: { path?: string; loaded?: boolean };
          }>("/api/project/unload", {});
          set_project_snapshot({
            path: String(payload.project?.path ?? ""),
            loaded: Boolean(payload.project?.loaded),
          });
          workbench_view_cache_ref.current = null;
          set_snapshot(EMPTY_SNAPSHOT);
          set_file_op_running(false);
          set_entries([]);
          apply_selection_state(create_empty_selection_state());
          await refresh_task();
          set_dialog_state(close_dialog_state());
        } finally {
          set_is_mutation_running(false);
        }
      }
    } catch (error) {
      const fallback_message =
        current_dialog_state.kind === "export-translation"
          ? t("workbench_page.feedback.export_failed")
          : current_dialog_state.kind === "close-project"
            ? t("workbench_page.feedback.close_project_failed")
            : t("workbench_page.feedback.file_action_failed");

      push_toast("error", resolve_error_message(error, fallback_message));
      set_dialog_submitting(false);
    }
  }

  async function cancel_dialog(): Promise<void> {
    const current_dialog_state = dialog_state;
    if (current_dialog_state.submitting) {
      return;
    }

    if (current_dialog_state.kind !== "inherit-add-file") {
      set_dialog_state(close_dialog_state());
      return;
    }

    if (pending_add_files_request === null) {
      set_dialog_state(close_dialog_state());
      return;
    }

    set_dialog_submitting(true);
    try {
      await execute_add_file_request(pending_add_files_request, "none");
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("workbench_page.feedback.file_action_failed")),
      );
      set_dialog_submitting(false);
    }
  }

  function close_dialog(): void {
    if (dialog_state.submitting) {
      return;
    }

    if (dialog_state.kind === "inherit-add-file") {
      set_pending_add_files_request(null);
    }
    set_dialog_state(close_dialog_state());
  }

  const translation_task_runtime = useMemo<TranslationTaskRuntime>(() => {
    return {
      ...raw_translation_task_runtime,
      open_translation_detail_sheet: () => {
        raw_analysis_task_runtime.close_analysis_detail_sheet();
        raw_translation_task_runtime.open_translation_detail_sheet();
      },
    };
  }, [raw_analysis_task_runtime, raw_translation_task_runtime]);

  const analysis_task_runtime = useMemo<AnalysisTaskRuntime>(() => {
    return {
      ...raw_analysis_task_runtime,
      open_analysis_detail_sheet: () => {
        raw_translation_task_runtime.close_translation_detail_sheet();
        raw_analysis_task_runtime.open_analysis_detail_sheet();
      },
    };
  }, [raw_analysis_task_runtime, raw_translation_task_runtime]);

  return {
    cache_status,
    cache_stale,
    last_loaded_at,
    refresh_request_id,
    settled_project_path,
    is_refreshing,
    file_op_running,
    stats,
    translation_stats: snapshot.translation_stats,
    analysis_stats: display_analysis_stats,
    stats_mode,
    translation_task_runtime,
    analysis_task_runtime,
    active_workbench_task_view,
    active_workbench_task_summary,
    active_workbench_task_detail,
    translation_task_confirm_dialog,
    analysis_task_confirm_dialog,
    entries,
    selected_entry_ids,
    active_entry_id,
    anchor_entry_id,
    readonly,
    can_edit_files,
    can_export_translation,
    can_close_project,
    dialog_state,
    refresh_snapshot,
    toggle_stats_mode,
    apply_table_selection,
    prepare_entry_action,
    request_add_file,
    request_add_file_from_path,
    request_add_files_from_paths,
    notify_add_file_drop_issue,
    request_export_translation,
    request_close_project,
    request_reset_file,
    request_delete_selected_files,
    request_reorder_entries,
    confirm_dialog,
    cancel_dialog,
    close_dialog,
  };
}
