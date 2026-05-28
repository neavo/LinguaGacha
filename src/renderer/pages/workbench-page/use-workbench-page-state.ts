import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { capture_renderer_error } from "@/app/diagnostics/renderer-error-reporter";
import { is_task_stopping } from "@/project/tasks/task-lock";
import { useDesktopToast } from "@/app/ui-runtime/toast/use-desktop-toast";
import {
  create_workbench_delete_files_plan,
  create_workbench_planner_settings,
  create_workbench_reorder_plan,
  create_workbench_reset_file_plan,
  type WorkbenchMutationPlanningState,
  type WorkbenchProjectMutationPlan,
} from "@/pages/workbench-page/workbench-mutation-planner";
import type { AnalysisTaskRuntime } from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";
import type { TranslationTaskRuntime } from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";
import {
  type ProjectMutationOperation,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-project-mutation";
import { useI18n } from "@/app/locale/locale-provider";
import { api_fetch } from "@/app/desktop/desktop-api";
import { resolve_visible_error_message } from "@/app/ui-runtime/error-message";
import { format_source_file_parse_failure_error_toast } from "@/lib/source-file-parse-failure-toast";
import {
  close_dialog_state,
  useWorkbenchImportFilesFlow,
} from "@/pages/workbench-page/use-workbench-import-files-flow";
import type { AnalysisTaskMetrics } from "@/pages/workbench-page/task-runtime/analysis-task-model";
import type { RendererErrorContextInput } from "@shared/error";
import type { ProjectDataSection, ProjectDataSectionRevisions } from "@shared/project-event";
import type { TranslationTaskMetrics } from "@/pages/workbench-page/task-runtime/translation-task-model";
import type { AppTableSelectionChange } from "@/widgets/app-table/app-table-types";
import type {
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

// EMPTY WORKBENCH STATS 是默认快照事实，调用方只读取副本不临时拼装。
const EMPTY_WORKBENCH_STATS: WorkbenchStats = {
  total_items: 0,
  completed_count: 0,
  failed_count: 0,
  pending_count: 0,
  skipped_count: 0,
  completion_percent: 0,
};

type WorkbenchCacheErrorContext = Pick<RendererErrorContextInput, "stage" | "signalSeq">; // 工作台缓存异常只上报白名单诊断字段，不透传页面快照

const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  file_count: 0,
  total_items: 0,
  translation_stats: EMPTY_WORKBENCH_STATS,
  analysis_stats: EMPTY_WORKBENCH_STATS,
  entries: [],
};

// WORKBENCH REQUIRED SECTIONS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const WORKBENCH_REQUIRED_SECTIONS: ProjectDataSection[] = ["project", "files", "items", "analysis"];
const WORKBENCH_REFRESH_SECTIONS: readonly ProjectDataSection[] = [
  "project",
  "files",
  "items",
  "analysis",
];
// 工作台文件 mutation 由工作台页拥有业务动作名，desktop committer 只消费 operation。
const WORKBENCH_FILE_MUTATION: ProjectMutationOperation = "workbench.file_mutation";

type WorkbenchAddFileDropIssue = "multiple" | "unavailable";

type WorkbenchQueryResponse = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  view: WorkbenchSnapshot;
};

// map_snapshot_entries 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function map_snapshot_entries(entries: WorkbenchSnapshotEntry[]): WorkbenchFileEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

type WorkbenchSelectionState = {
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
};

// create_empty_selection_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_empty_selection_state(): WorkbenchSelectionState {
  return {
    selected_entry_ids: [],
    active_entry_id: null,
    anchor_entry_id: null,
  };
}

// dedupe_workbench_entry_ids 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function dedupe_workbench_entry_ids(entry_ids: string[]): string[] {
  return Array.from(new Set(entry_ids));
}

// are_workbench_entry_ids_equal 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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

// select_after_snapshot 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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

// normalize_workbench_selection_state 在边界处归一化输入，避免下游再处理坏载荷分支。
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

// resolve_workbench_selection_after_snapshot 集中解析运行时决策，避免调用点复制条件判断。
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

// is_workbench_task_kind 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_workbench_task_kind(value: string): value is WorkbenchTaskKind {
  return value === "translation" || value === "analysis";
}

// resolve_active_workbench_task_kind 集中解析运行时决策，避免调用点复制条件判断。
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

// format_duration_value 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
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

// format_compact_metric_value 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
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

// format_speed_value 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
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

// format_summary_speed 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
function format_summary_speed(value: number): string {
  const metric_value = format_speed_value(value);
  return `${metric_value.value_text} ${metric_value.unit_text}`;
}

// resolve_task_tone 集中解析运行时决策，避免调用点复制条件判断。
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

// resolve_percent_tone 集中解析运行时决策，避免调用点复制条件判断。
function resolve_percent_tone(
  metrics: Pick<TranslationTaskMetrics, "active" | "stopping">,
): WorkbenchTaskTone {
  return resolve_task_tone({
    active: metrics.active,
    stopping: metrics.stopping,
  });
}

// build_translation_task_metric_entries 构造跨层载荷，保证字段形状在一个入口维护。
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

// build_analysis_task_metric_entries 构造跨层载荷，保证字段形状在一个入口维护。
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

// build_empty_task_summary_view_model 构造跨层载荷，保证字段形状在一个入口维护。
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

// build_translation_task_summary_view_model 构造跨层载荷，保证字段形状在一个入口维护。
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

// build_analysis_task_summary_view_model 构造跨层载荷，保证字段形状在一个入口维护。
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

// resolve_task_detail_progress_percent 集中解析运行时决策，避免调用点复制条件判断。
function resolve_task_detail_progress_percent(args: {
  metrics: Pick<
    TranslationTaskMetrics | AnalysisTaskMetrics,
    "active" | "stopping" | "completion_percent"
  >;
  workbench_stats: WorkbenchStats;
}): number {
  // 任务详情运行中展示 TaskSnapshot 进度；空闲态才回落到项目事实统计，避免新任务沿用旧百分比。
  return args.metrics.active || args.metrics.stopping
    ? args.metrics.completion_percent
    : args.workbench_stats.completion_percent;
}

// build_translation_task_detail_view_model 构造跨层载荷，保证字段形状在一个入口维护。
function build_translation_task_detail_view_model(args: {
  metrics: TranslationTaskMetrics;
  progress_percent: number;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t("workbench_page.translation_task.detail.title"),
    description: args.t("workbench_page.translation_task.detail.description"),
    waveform_title: args.t("workbench_page.translation_task.detail.waveform_title"),
    metrics_title: args.t("workbench_page.translation_task.detail.metrics_title"),
    completion_percent_text: `${args.progress_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("workbench_page.action.translation_stopping")
      : args.t("workbench_page.action.stop_translation"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}

// build_analysis_task_detail_view_model 构造跨层载荷，保证字段形状在一个入口维护。
function build_analysis_task_detail_view_model(args: {
  metrics: AnalysisTaskMetrics;
  progress_percent: number;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t("workbench_page.analysis_task.detail.title"),
    description: args.t("workbench_page.analysis_task.detail.description"),
    waveform_title: args.t("workbench_page.analysis_task.detail.waveform_title"),
    metrics_title: args.t("workbench_page.analysis_task.detail.metrics_title"),
    completion_percent_text: `${args.progress_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_analysis_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("workbench_page.action.analysis_stopping")
      : args.t("workbench_page.action.stop_analysis"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}

export type UseWorkbenchPageStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  consumed_revisions: ProjectDataSectionRevisions;
  required_sections: ProjectDataSection[];
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
  entries: WorkbenchFileEntry[];
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
  readonly: boolean;
  can_edit_files: boolean;
  can_delete_selected_files: boolean;
  can_generate_translation: boolean;
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
  request_generate_translation: () => void;
  request_close_project: () => void;
  request_reset_file: (entry_id: string) => void;
  request_delete_selected_files: () => void;
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>;
  confirm_dialog: () => Promise<void>;
  secondary_dialog: () => Promise<void>;
  cancel_dialog: () => Promise<void>;
  close_dialog: () => void;
};

type UseWorkbenchPageStateOptions = {
  translationTaskRuntime: TranslationTaskRuntime; // 常驻任务 runtime 由 WorkbenchTaskRuntimeProvider 持有
  analysisTaskRuntime: AnalysisTaskRuntime; // 页面只消费任务状态，不拥有任务完成意图
};

// useWorkbenchPageState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useWorkbenchPageState(
  options: UseWorkbenchPageStateOptions,
): UseWorkbenchPageStateResult {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const raw_translation_task_runtime = options.translationTaskRuntime;
  const raw_analysis_task_runtime = options.analysisTaskRuntime;
  const {
    project_snapshot,
    commit_project_mutation,
    project_change_signal,
    refresh_task,
    refresh_project_snapshot,
    settings_snapshot,
    task_snapshot,
  } = useDesktopRuntime();
  const [snapshot, set_snapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT);
  const [entries, set_entries] = useState<WorkbenchFileEntry[]>([]);
  const [cache_status, set_cache_status] = useState<"idle" | "refreshing" | "ready" | "error">(
    "idle",
  );
  const [consumed_revisions, set_consumed_revisions] = useState<ProjectDataSectionRevisions>({});
  const [settled_project_path, set_settled_project_path] = useState("");
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
  const previous_workbench_change_seq_ref = useRef(0);
  const previous_project_loaded_ref = useRef(false);
  const workbench_change_seq = useMemo(() => {
    return project_change_signal.updated_sections.some((section) =>
      WORKBENCH_REFRESH_SECTIONS.includes(section as ProjectDataSection),
    )
      ? project_change_signal.seq
      : null;
  }, [project_change_signal]);
  // 工作台文件 mutation 共享同一份窄设置镜像，避免各入口重复拼命令字段。
  const planner_settings = useMemo(
    () => create_workbench_planner_settings(settings_snapshot),
    [settings_snapshot],
  );
  const previous_project_path_ref = useRef("");
  const refresh_generation_ref = useRef(0);
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

  const get_workbench_planning_state = useCallback((): WorkbenchMutationPlanningState => {
    return {
      files: entries_ref.current.map((entry, index) => ({
        rel_path: entry.rel_path,
        file_type: entry.file_type,
        sort_index: entry.sort_index ?? index,
      })),
      section_revisions: consumed_revisions,
    };
  }, [consumed_revisions]);

  const clear_workbench_snapshot_state = useCallback((): void => {
    refresh_generation_ref.current += 1;
    snapshot_ref.current = EMPTY_SNAPSHOT;
    set_snapshot(EMPTY_SNAPSHOT);
    set_file_op_running(false);
    set_entries([]);
    apply_selection_state(create_empty_selection_state());
    set_dialog_state(close_dialog_state());
    set_is_refreshing(false);
    set_consumed_revisions({});
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

      const request_id = refresh_generation_ref.current + 1;
      refresh_generation_ref.current = request_id;
      set_is_refreshing(true);
      set_cache_status("refreshing");

      try {
        const response = await api_fetch<WorkbenchQueryResponse>(
          "/api/project/query/workbench",
          {},
        );
        const next_snapshot = response.view;

        if (request_id !== refresh_generation_ref.current) {
          return next_snapshot;
        }

        snapshot_ref.current = next_snapshot;
        set_snapshot(next_snapshot);
        apply_refreshed_entries(next_snapshot, preferred_active_entry_id);
        set_file_op_running(false);
        set_cache_status("ready");
        set_consumed_revisions(response.sectionRevisions);
        set_settled_project_path(response.projectPath);
        return next_snapshot;
      } catch (error) {
        if (request_id !== refresh_generation_ref.current) {
          return EMPTY_SNAPSHOT;
        }

        const message = resolve_visible_error_message(
          error,
          t,
          t("workbench_page.feedback.refresh_failed"),
        );
        set_cache_status("error");
        set_file_op_running(false);
        set_settled_project_path(project_snapshot.path);
        push_toast("error", message);
        return snapshot_ref.current;
      } finally {
        if (request_id === refresh_generation_ref.current) {
          set_is_refreshing(false);
        }
      }
    },
    [
      apply_refreshed_entries,
      clear_workbench_snapshot_state,
      project_snapshot.loaded,
      project_snapshot.path,
      push_toast,
      t,
    ],
  );

  // 工作台缓存是可重建派生状态，delta 失败只记录异常并回退到全量重建。
  const report_workbench_cache_error = useCallback(
    (error: unknown, context: WorkbenchCacheErrorContext): void => {
      capture_renderer_error(error, {
        source: "page-cache",
        context: {
          page: "workbench",
          ...context,
        },
      });
    },
    [],
  );

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      if (previous_project_loaded || previous_project_path !== "") {
        clear_workbench_snapshot_state();
        set_cache_status("idle");
        set_recent_workbench_task_kind(null);
        set_stats_mode("translation");
      }
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_workbench_snapshot_state();
      set_cache_status("refreshing");
      set_recent_workbench_task_kind(null);
      set_stats_mode("translation");
      previous_workbench_change_seq_ref.current =
        workbench_change_seq ?? previous_workbench_change_seq_ref.current;
      void refresh_snapshot();
    }
  }, [
    clear_workbench_snapshot_state,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_snapshot,
    workbench_change_seq,
  ]);

  useEffect(() => {
    const previous_seq = previous_workbench_change_seq_ref.current;

    if (!project_snapshot.loaded || workbench_change_seq === null) {
      return;
    }

    if (previous_seq !== workbench_change_seq) {
      previous_workbench_change_seq_ref.current = workbench_change_seq;
      void refresh_snapshot().catch((error) => {
        report_workbench_cache_error(error, {
          stage: "refresh_snapshot_after_workbench_signal",
          signalSeq: workbench_change_seq,
        });
      });
    }
  }, [
    project_snapshot.loaded,
    refresh_snapshot,
    report_workbench_cache_error,
    workbench_change_seq,
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
      set_stats_mode(running_workbench_task_kind); // 为什么：任务一旦开始，顶部卡片就该马上切到对应语义，避免统计视角和底部状态栏互相打架
    }
  }, [running_workbench_task_kind]);

  const toggle_stats_mode = useCallback((): void => {
    set_stats_mode((previous_mode) => {
      return previous_mode === "translation" ? "analysis" : "translation";
    });
  }, []);

  const stats = useMemo<WorkbenchStats>(() => {
    return stats_mode === "analysis" ? snapshot.analysis_stats : snapshot.translation_stats;
  }, [snapshot.analysis_stats, snapshot.translation_stats, stats_mode]);

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
    // 为什么：工作台空态也要保留可点击的详情胶囊，默认沿用翻译任务模板展示基础指标
    if (display_workbench_task_kind === "translation") {
      return build_translation_task_detail_view_model({
        metrics: raw_translation_task_runtime.translation_task_metrics,
        progress_percent: resolve_task_detail_progress_percent({
          metrics: raw_translation_task_runtime.translation_task_metrics,
          workbench_stats: snapshot.translation_stats,
        }),
        waveform_history: raw_translation_task_runtime.translation_waveform_history,
        t,
      });
    }

    if (display_workbench_task_kind === "analysis") {
      return build_analysis_task_detail_view_model({
        metrics: raw_analysis_task_runtime.analysis_task_metrics,
        progress_percent: resolve_task_detail_progress_percent({
          metrics: raw_analysis_task_runtime.analysis_task_metrics,
          workbench_stats: snapshot.analysis_stats,
        }),
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
    snapshot.analysis_stats.completion_percent,
    snapshot.translation_stats.completion_percent,
    t,
  ]);

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
  // 删除权限以当前可见工作台文件为准，避免全选或陈旧选择绕过最后文件保护
  const selected_delete_target_rel_paths = useMemo(() => {
    const visible_entry_id_set = new Set(entries.map((entry) => entry.rel_path));
    return dedupe_workbench_entry_ids(selected_entry_ids).filter((entry_id) => {
      return visible_entry_id_set.has(entry_id);
    });
  }, [entries, selected_entry_ids]);
  const can_delete_selected_files =
    can_edit_files &&
    selected_delete_target_rel_paths.length > 0 &&
    selected_delete_target_rel_paths.length < entries.length;
  const generate_translation_submitting =
    dialog_state.kind === "generate-translation" && dialog_state.submitting;
  // 为什么：生成当前可用译文允许翻译运行中触发，但停止收尾和提交中必须保持单入口
  const can_generate_translation =
    project_snapshot.loaded &&
    !file_op_running &&
    !is_mutation_running &&
    !generate_translation_submitting &&
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

  const run_project_file_mutation = useCallback(
    async (
      plan: WorkbenchProjectMutationPlan,
      request: (body: Record<string, unknown>) => Promise<ProjectMutationResultPayload>,
    ): Promise<ProjectMutationResultPayload> => {
      set_is_mutation_running(true);
      set_file_op_running(true);

      try {
        const { payload } = await commit_project_mutation({
          operation: WORKBENCH_FILE_MUTATION,
          run: async () => {
            return await request(plan.requestBody);
          },
        });
        await refresh_task();
        await refresh_snapshot();
        return payload;
      } catch (error) {
        set_file_op_running(false);
        throw error;
      } finally {
        set_is_mutation_running(false);
      }
    },
    [commit_project_mutation, refresh_snapshot, refresh_task],
  );

  const import_files_flow = useWorkbenchImportFilesFlow({
    readonly,
    project_identity: project_snapshot.loaded ? project_snapshot.path : "",
    dialog_state,
    get_planning_state: get_workbench_planning_state,
    task_snapshot,
    planner_settings,
    run_modal_progress_toast,
    run_project_file_mutation,
    set_dialog_state: set_dialog_state,
    set_dialog_submitting,
    push_toast,
    t,
  });

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
      if (!can_edit_files) {
        return;
      }

      const visible_entry_id_set = new Set(entries.map((entry) => entry.rel_path));
      const target_rel_paths = dedupe_workbench_entry_ids(entry_ids).filter((entry_id) => {
        return visible_entry_id_set.has(entry_id);
      });

      if (target_rel_paths.length === 0 || target_rel_paths.length >= entries.length) {
        return;
      }

      set_dialog_state({
        kind: "delete-file",
        target_rel_paths,
        pending_path: null,
        submitting: false,
      });
    },
    [can_edit_files, entries],
  );

  const request_add_files_from_paths = import_files_flow.request_add_files_from_paths;
  const request_add_file_from_path = import_files_flow.request_add_file_from_path;

  // request_add_file 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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

  // notify_add_file_drop_issue 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function notify_add_file_drop_issue(issue: WorkbenchAddFileDropIssue): void {
    push_toast(
      "warning",
      issue === "multiple" ? t("app.drop.multiple_unavailable") : t("app.drop.unavailable"),
    );
  }

  // request_generate_translation 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function request_generate_translation(): void {
    if (!can_generate_translation) {
      return;
    }

    set_dialog_state({
      kind: "generate-translation",
      target_rel_paths: [],
      pending_path: null,
      submitting: false,
    });
  }

  // request_close_project 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function request_close_project(): void {
    set_dialog_state({
      kind: "close-project",
      target_rel_paths: [],
      pending_path: null,
      submitting: false,
    });
  }

  // request_reset_file 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function request_reset_file(entry_id: string): void {
    set_dialog_state({
      kind: "reset-file",
      target_rel_paths: [entry_id],
      pending_path: null,
      submitting: false,
    });
  }

  // request_delete_selected_files 封装当前模块的共享逻辑，避免重复实现同一维护规则。
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
          state: get_workbench_planning_state(),
          ordered_rel_paths: ordered_entry_ids,
        });
        await run_project_file_mutation(reorder_plan, async (body) => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/workbench/reorder-files",
            body,
          );
        });
      } catch {
        push_toast("error", t("workbench_page.reorder.failed"));
      }
    },
    [
      entries.length,
      get_workbench_planning_state,
      push_toast,
      readonly,
      run_project_file_mutation,
      t,
    ],
  );

  // confirm_dialog 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  async function confirm_dialog(): Promise<void> {
    const current_dialog_state = dialog_state;
    if (current_dialog_state.kind === null || current_dialog_state.submitting) {
      return;
    }

    if (await import_files_flow.confirm_dialog()) {
      return;
    }

    const target_rel_path = current_dialog_state.target_rel_paths[0] ?? null;
    set_dialog_submitting(true);
    try {
      if (current_dialog_state.kind === "reset-file") {
        if (target_rel_path === null) {
          set_dialog_submitting(false);
          return;
        }

        const reset_plan = create_workbench_reset_file_plan({
          state: get_workbench_planning_state(),
          task_snapshot,
          rel_path: target_rel_path,
          settings: planner_settings,
        });
        await run_project_file_mutation(reset_plan, async (body) => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/workbench/reset-file",
            body,
          );
        });
        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "delete-file") {
        if (current_dialog_state.target_rel_paths.length === 0) {
          set_dialog_submitting(false);
          return;
        }

        const delete_plan = create_workbench_delete_files_plan({
          state: get_workbench_planning_state(),
          task_snapshot,
          rel_paths: current_dialog_state.target_rel_paths,
          settings: planner_settings,
        });
        await run_project_file_mutation(delete_plan, async (body) => {
          return await api_fetch<ProjectMutationResultPayload>(
            "/api/project/workbench/delete-file",
            body,
          );
        });

        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "generate-translation") {
        if (!can_generate_translation) {
          set_dialog_submitting(false);
          return;
        }

        await api_fetch("/api/tasks/generate-translation", {});
        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "close-project") {
        set_is_mutation_running(true);
        try {
          await api_fetch("/api/project/unload", {});
          await refresh_project_snapshot();
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
      const parse_failure_toast = format_source_file_parse_failure_error_toast({ error, text: t });
      if (parse_failure_toast !== null) {
        push_toast("error", parse_failure_toast);
        set_dialog_submitting(false);
        return;
      }
      const fallback_message =
        current_dialog_state.kind === "generate-translation"
          ? t("workbench_page.feedback.generate_translation_failed")
          : current_dialog_state.kind === "close-project"
            ? t("workbench_page.feedback.close_project_failed")
            : t("workbench_page.feedback.file_action_failed");

      push_toast("error", resolve_visible_error_message(error, t, fallback_message));
      set_dialog_submitting(false);
    }
  }

  // secondary_dialog 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  async function secondary_dialog(): Promise<void> {
    await import_files_flow.secondary_dialog();
  }

  // cancel_dialog 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  async function cancel_dialog(): Promise<void> {
    const current_dialog_state = dialog_state;
    if (await import_files_flow.cancel_dialog()) {
      return;
    }

    if (current_dialog_state.submitting) {
      return;
    }

    set_dialog_state(close_dialog_state());
  }

  // close_dialog 封装当前模块的共享逻辑，避免重复实现同一维护规则。
  function close_dialog(): void {
    if (import_files_flow.close_dialog()) {
      return;
    }

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
    consumed_revisions,
    required_sections: WORKBENCH_REQUIRED_SECTIONS,
    settled_project_path,
    is_refreshing,
    file_op_running,
    stats,
    translation_stats: snapshot.translation_stats,
    analysis_stats: snapshot.analysis_stats,
    stats_mode,
    translation_task_runtime,
    analysis_task_runtime,
    active_workbench_task_view,
    active_workbench_task_summary,
    active_workbench_task_detail,
    entries,
    selected_entry_ids,
    active_entry_id,
    anchor_entry_id,
    readonly,
    can_edit_files,
    can_delete_selected_files,
    can_generate_translation,
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
    request_generate_translation,
    request_close_project,
    request_reset_file,
    request_delete_selected_files,
    request_reorder_entries,
    confirm_dialog,
    secondary_dialog,
    cancel_dialog,
    close_dialog,
  };
}
