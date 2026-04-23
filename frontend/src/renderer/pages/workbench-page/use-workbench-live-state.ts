import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from "@/app/state/project-pages-barrier";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { useDesktopToast } from "@/app/state/use-desktop-toast";
import { buildWorkbenchView } from "@/app/project-runtime/selectors";
import {
  create_workbench_add_file_plan,
  create_workbench_delete_files_plan,
  create_workbench_reorder_plan,
  create_workbench_reset_file_plan,
  create_workbench_replace_file_plan,
  type WorkbenchFileParsePreview,
  type WorkbenchProjectMutationPlan,
} from "@/app/project-runtime/workbench-mutation-planner";
import {
  useAnalysisTaskRuntime,
  type AnalysisTaskRuntime,
} from "@/app/state/use-analysis-task-runtime";
import {
  useTranslationTaskRuntime,
  type TranslationTaskRuntime,
} from "@/app/state/use-translation-task-runtime";
import {
  normalize_project_mutation_ack,
  type ProjectMutationAckPayload,
} from "@/app/state/desktop-runtime-context";
import { useI18n } from "@/i18n";
import { api_fetch } from "@/app/desktop-api";
import type {
  AnalysisTaskConfirmState,
  AnalysisTaskMetrics,
  AnalysisTaskSnapshot,
} from "@/lib/analysis-task";
import type { TranslationTaskConfirmState, TranslationTaskMetrics } from "@/lib/translation-task";
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

const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  file_count: 0,
  total_items: 0,
  translated: 0,
  translated_in_past: 0,
  error_count: 0,
  entries: [],
};

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

function build_translation_stats(
  snapshot: WorkbenchSnapshot,
  translation_active: boolean,
  translated: number,
  error_count: number,
): WorkbenchStats {
  const translated_count = translation_active
    ? Math.min(snapshot.total_items, translated)
    : snapshot.translated;
  const error_total = translation_active
    ? Math.min(snapshot.total_items, error_count)
    : snapshot.error_count;

  return {
    total_items: snapshot.total_items,
    completed_count: translated_count,
    failed_count: error_total,
    pending_count: Math.max(0, snapshot.total_items - translated_count - error_total),
  };
}

function build_analysis_stats(
  snapshot: WorkbenchSnapshot,
  analysis_display_snapshot: AnalysisTaskSnapshot | null,
  processed_count: number,
  failed_count: number,
): WorkbenchStats {
  const total_items = Math.max(snapshot.total_items, analysis_display_snapshot?.total_line ?? 0);
  const completed_total = Math.min(total_items, Math.max(0, processed_count));
  const failed_total = Math.min(
    Math.max(0, total_items - completed_total),
    Math.max(0, failed_count),
  );

  return {
    total_items,
    completed_count: completed_total,
    failed_count: failed_total,
    pending_count: Math.max(0, total_items - completed_total - failed_total),
  };
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
      title: t("workbench_page.translation_task.confirm.reset_all_title"),
      description: t("workbench_page.translation_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      title: t("workbench_page.translation_task.confirm.reset_failed_title"),
      description: t("workbench_page.translation_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    title: t("workbench_page.translation_task.confirm.stop_title"),
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
      title: t("workbench_page.analysis_task.confirm.reset_all_title"),
      description: t("workbench_page.analysis_task.confirm.reset_all_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "reset-failed") {
    return {
      open: state.open,
      title: t("workbench_page.analysis_task.confirm.reset_failed_title"),
      description: t("workbench_page.analysis_task.confirm.reset_failed_description"),
      submitting: state.submitting,
    };
  }

  if (state.kind === "import-glossary") {
    return {
      open: state.open,
      title: t("workbench_page.analysis_task.confirm.import_glossary_title"),
      description: t("workbench_page.analysis_task.confirm.import_glossary_description"),
      submitting: state.submitting,
    };
  }

  return {
    open: state.open,
    title: t("workbench_page.analysis_task.confirm.stop_title"),
    description: t("workbench_page.analysis_task.confirm.stop_description"),
    submitting: state.submitting,
  };
}

type UseWorkbenchLiveStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  cache_stale: boolean;
  last_loaded_at: number | null;
  refresh_request_id: number;
  settled_project_path: string;
  refresh_error: string | null;
  is_refreshing: boolean;
  file_op_running: boolean;
  stats: WorkbenchStats;
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
  request_export_translation: () => void;
  request_close_project: () => void;
  request_reset_file: (entry_id: string) => void;
  request_delete_file: (entry_id: string) => void;
  request_delete_selected_files: () => void;
  request_replace_file: (entry_id: string) => Promise<void>;
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>;
  confirm_dialog: () => Promise<void>;
  close_dialog: () => void;
};

type UseWorkbenchLiveStateOptions = {
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
  const [refresh_error, set_refresh_error] = useState<string | null>(null);
  const [is_refreshing, set_is_refreshing] = useState(false);
  const [file_op_running, set_file_op_running] = useState(false);
  const [selected_entry_ids, set_selected_entry_ids] = useState<string[]>([]);
  const [active_entry_id, set_active_entry_id] = useState<string | null>(null);
  const [anchor_entry_id, set_anchor_entry_id] = useState<string | null>(null);
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state());
  const [is_mutation_running, set_is_mutation_running] = useState(false);
  const [recent_workbench_task_kind, set_recent_workbench_task_kind] =
    useState<WorkbenchTaskKind | null>(null);
  const [stats_mode, set_stats_mode] = useState<WorkbenchStatsMode>("translation");
  const previous_workbench_change_seq_ref = useRef(workbench_change_signal.seq);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const refresh_request_id_ref = useRef(0);
  const snapshot_ref = useRef(snapshot);
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
    set_snapshot(EMPTY_SNAPSHOT);
    set_file_op_running(false);
    set_entries([]);
    apply_selection_state(create_empty_selection_state());
    set_dialog_state(close_dialog_state());
    set_refresh_error(null);
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
        const view = buildWorkbenchView(project_store.getState());
        const next_snapshot: WorkbenchSnapshot = {
          ...EMPTY_SNAPSHOT,
          ...view.summary,
          entries: view.entries,
        };

        if (request_id !== refresh_request_id_ref.current) {
          return next_snapshot;
        }

        snapshot_ref.current = next_snapshot;
        set_snapshot(next_snapshot);
        apply_refreshed_entries(next_snapshot, preferred_active_entry_id);
        set_file_op_running(false);
        set_refresh_error(null);
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
        set_refresh_error(message);
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

    // 为什么：工作台现在完全依赖 ProjectStore 重建视图，收到任意结构化变更后直接全量重算。
    if (previous_seq !== workbench_change_signal.seq) {
      set_cache_stale(true);
      void refresh_snapshot().catch(() => {});
    }
  }, [project_snapshot.loaded, workbench_change_signal.seq, refresh_snapshot]);

  const translation_stats = useMemo(() => {
    return build_translation_stats(
      snapshot,
      raw_translation_task_runtime.translation_task_metrics.active,
      raw_translation_task_runtime.translation_task_metrics.processed_count,
      raw_translation_task_runtime.translation_task_metrics.failed_count,
    );
  }, [
    snapshot,
    raw_translation_task_runtime.translation_task_metrics.active,
    raw_translation_task_runtime.translation_task_metrics.failed_count,
    raw_translation_task_runtime.translation_task_metrics.processed_count,
  ]);

  const analysis_stats = useMemo(() => {
    return build_analysis_stats(
      snapshot,
      raw_analysis_task_runtime.analysis_task_display_snapshot,
      raw_analysis_task_runtime.analysis_task_metrics.processed_count,
      raw_analysis_task_runtime.analysis_task_metrics.failed_count,
    );
  }, [
    raw_analysis_task_runtime.analysis_task_display_snapshot,
    raw_analysis_task_runtime.analysis_task_metrics.failed_count,
    raw_analysis_task_runtime.analysis_task_metrics.processed_count,
    snapshot,
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

  const stats = useMemo<WorkbenchStats>(() => {
    return stats_mode === "analysis" ? analysis_stats : translation_stats;
  }, [analysis_stats, stats_mode, translation_stats]);

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
  const can_export_translation =
    project_snapshot.loaded && !file_op_running && !is_mutation_running;
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

  async function request_add_file(): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath();
    if (result.canceled || result.path === null) {
      return;
    }
    const source_path = result.path;

    const barrier_checkpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null;

    try {
      await run_modal_progress_toast({
        message: t("workbench_page.feedback.add_file_loading_toast"),
        task: async () => {
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
          const add_plan = create_workbench_add_file_plan({
            state: project_store.getState(),
            parsed_file,
            settings: {
              source_language: settings_snapshot.source_language,
              mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
            },
          });
          await run_ack_only_file_mutation(
            add_plan,
            async (body) => {
              return await api_fetch<ProjectMutationAckPayload>(
                "/api/project/workbench/add-file",
                body,
              );
            },
            barrier_checkpoint,
          );
        },
      });
    } catch (error) {
      push_toast(
        "error",
        resolve_error_message(error, t("workbench_page.feedback.file_action_failed")),
      );
    }
  }

  function request_export_translation(): void {
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

  function request_delete_file(entry_id: string): void {
    request_delete_entries([entry_id]);
  }

  function request_delete_selected_files(): void {
    request_delete_entries(selection_state_ref.current.selected_entry_ids);
  }

  async function request_replace_file(entry_id: string): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath();
    if (result.canceled || result.path === null) {
      return;
    }
    const pending_path = result.path;

    set_dialog_state({
      kind: "replace-file",
      target_rel_paths: [entry_id],
      pending_path,
      submitting: false,
    });
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
      if (current_dialog_state.kind === "replace-file") {
        if (target_rel_path === null || current_dialog_state.pending_path === null) {
          set_dialog_submitting(false);
          return;
        }

        const parsed_file = normalize_workbench_file_parse_preview(
          current_dialog_state.pending_path,
          await api_fetch<{
            target_rel_path?: unknown;
            file_type?: unknown;
            parsed_items?: unknown;
          }>("/api/project/workbench/parse-file", {
            source_path: current_dialog_state.pending_path,
            rel_path: target_rel_path,
          }),
        );
        const replace_plan = create_workbench_replace_file_plan({
          state: project_store.getState(),
          rel_path: target_rel_path,
          parsed_file,
          settings: {
            source_language: settings_snapshot.source_language,
            mtool_optimizer_enable: settings_snapshot.mtool_optimizer_enable,
          },
        });
        await run_ack_only_file_mutation(
          replace_plan,
          async (body) => {
            return await api_fetch<ProjectMutationAckPayload>(
              "/api/project/workbench/replace-file",
              body,
            );
          },
          barrier_checkpoint,
        );
        set_dialog_state(close_dialog_state());
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

  function close_dialog(): void {
    if (dialog_state.submitting) {
      return;
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
    refresh_error,
    is_refreshing,
    file_op_running,
    stats,
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
    request_export_translation,
    request_close_project,
    request_reset_file,
    request_delete_file,
    request_delete_selected_files,
    request_replace_file,
    request_reorder_entries,
    confirm_dialog,
    close_dialog,
  };
}
