import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useDesktopState,
  useProjectChangeSignal,
  useRuntimeSnapshot,
  useBatchTranslationSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { capture_renderer_error } from "@frontend/app/diagnostics/renderer-error-reporter";
import { is_task_stopping } from "@frontend/app/state/batch-translation-snapshot-store";

import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import {
  create_workbench_delete_files_plan,
  create_workbench_planner_settings,
  create_workbench_reorder_plan,
  create_workbench_reset_file_plan,
  type WorkbenchCommandPlanningState,
  type WorkbenchCommandPlan,
} from "@shared/workbench/workbench-command-planner";
import type { TranslationWorkbenchTask } from "@frontend/app/session/batch-translation/use-translation-workbench-task";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { format_source_file_parse_failure_error_toast } from "@frontend/app/feedback/source-file-parse-failure-feedback";
import {
  close_dialog_state,
  useWorkbenchImportFilesFlow,
} from "@frontend/pages/workbench-page/use-workbench-import-files-flow";
import type { RendererErrorContextInput } from "@shared/error";
import type { ProjectDataSection, ProjectDataSectionRevisions } from "@shared/project-event";
import type { BatchTranslationMetrics } from "@shared/workbench/batch-translation";

import type { AppTableSelectionChange } from "@frontend/widgets/app-table/app-table-types";
import { resolveProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import type {
  WorkbenchTranslationDetailDisplay,
  WorkbenchDialogState,
  WorkbenchFileEntry,
  WorkbenchTranslationMetricEntry,
  WorkbenchSnapshot,
  WorkbenchSnapshotEntry,
  WorkbenchStats,
  WorkbenchTranslationSummaryDisplay,
  WorkbenchTranslationTone,
  WorkbenchTranslationViewState,
} from "@frontend/pages/workbench-page/types";

// 缓存尚未就绪时使用零值统计，避免把旧项目进度带入新会话。
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
  entries: [],
};

// 页面缓存只有消费完这些 section revision 才能标记为 ready。
const WORKBENCH_REQUIRED_SECTIONS: ProjectDataSection[] = ["project", "files", "items"];
// 工作台列表 query 的项目事实依赖范围。
const WORKBENCH_REFRESH_SECTIONS: readonly ProjectDataSection[] = ["project", "files", "items"];
// 工作台文件写入由工作台页拥有业务动作名，desktop committer 只消费 operation。
const WORKBENCH_FILE_WRITE: ProjectWriteOperation = "workbench.file_write";

type WorkbenchAddFileDropIssue = "multiple" | "unavailable";

type WorkbenchQueryResponse = {
  projectPath: string;
  sectionRevisions: ProjectDataSectionRevisions;
  snapshot: WorkbenchSnapshot;
};

function map_snapshot_entries(entries: WorkbenchSnapshotEntry[]): WorkbenchFileEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

type WorkbenchSelectionState = {
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
};

/** 同时清空多选、活动行和范围选择锚点。 */
function create_empty_selection_state(): WorkbenchSelectionState {
  return {
    selected_entry_ids: [],
    active_entry_id: null,
    anchor_entry_id: null,
  };
}

/** 去重时保留首次出现顺序，避免改变表格范围选择语义。 */
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

/**
 * 快照变化后优先保留同一路径；文件被删时选中原索引附近的幸存项。
 */
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

/**
 * 按当前快照裁掉已删除文件，并收窄活动行与范围选择锚点。
 */
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

/**
 * 刷新后保留有效多选；全部失效时按旧活动位置恢复一个稳定单选。
 */
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

/**
 * 将秒数截断并限制为非负值，统一输出 HH:MM:SS。
 */
function format_duration_value(
  seconds: number,
): Pick<WorkbenchTranslationMetricEntry, "value_text" | "unit_text"> {
  const normalized_seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized_seconds / 60 / 60);
  const minutes = Math.floor((normalized_seconds % (60 * 60)) / 60);
  const remaining_seconds = normalized_seconds % 60;

  return {
    value_text: [hours, minutes, remaining_seconds]
      .map((part) => {
        return part.toString().padStart(2, "0");
      })
      .join(":"),
    unit_text: "",
  };
}

/**
 * 用 K/M 缩写压缩计数，同时把单位与数值分离给详情布局。
 */
function format_compact_metric_value(
  value: number,
  base_unit: string,
): Pick<WorkbenchTranslationMetricEntry, "value_text" | "unit_text"> {
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

/**
 * 按每秒千 token 阈值选择翻译速度单位。
 */
function format_speed_value(
  value: number,
): Pick<WorkbenchTranslationMetricEntry, "value_text" | "unit_text"> {
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

/** 将详情使用的速度值压平成摘要尾部文案。 */
function format_summary_speed(value: number): string {
  const metric_value = format_speed_value(value);
  return `${metric_value.value_text} ${metric_value.unit_text}`;
}

/**
 * 停止中优先显示警告；运行中或被强调的空闲任务显示成功色。
 */
function resolve_task_tone(args: {
  active: boolean;
  stopping: boolean;
  emphasized_when_idle?: boolean;
}): WorkbenchTranslationTone {
  if (args.stopping) {
    return "warning";
  }

  if (args.active || args.emphasized_when_idle) {
    return "success";
  }

  return "neutral";
}

function resolve_percent_tone(
  metrics: Pick<BatchTranslationMetrics, "active" | "stopping">,
): WorkbenchTranslationTone {
  return resolve_task_tone({
    active: metrics.active,
    stopping: metrics.stopping,
  });
}

/**
 * 按详情面板的固定顺序投影翻译任务指标。
 */
function build_translation_task_metric_entries(
  metrics: BatchTranslationMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTranslationMetricEntry[] {
  return [
    {
      key: "elapsed",
      label: t("workbench_page.task.detail.elapsed_time"),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: "remaining-time",
      label: t("workbench_page.task.detail.remaining_time"),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: "speed",
      label: t("workbench_page.task.detail.average_speed"),
      ...format_speed_value(metrics.average_generation_speed),
    },
    {
      key: "input-tokens",
      label: t("workbench_page.task.detail.input_tokens"),
      ...format_compact_metric_value(metrics.input_tokens, "T"),
    },
    {
      key: "reasoning-tokens",
      label: t("workbench_page.task.detail.reasoning_tokens"),
      ...format_compact_metric_value(metrics.reasoning_tokens, "T"),
    },
    {
      key: "output-tokens",
      label: t("workbench_page.task.detail.output_tokens"),
      ...format_compact_metric_value(metrics.output_tokens, "T"),
    },
    {
      key: "active-requests",
      label: t("workbench_page.translation_task.detail.active_requests"),
      ...format_compact_metric_value(metrics.request_in_flight_count, "Task"),
    },
  ];
}

/** 无可展示任务时的摘要占位。 */
function build_empty_task_summary_display(
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTranslationSummaryDisplay {
  return {
    status_text: t("workbench_page.task.summary.empty"),
    trailing_text: null,
    tone: "neutral",
    show_spinner: false,
    detail_tooltip_text: t("workbench_page.task.summary.detail_tooltip"),
  };
}

/**
 * 将翻译任务运行态投影为命令栏摘要，空闲时不显示历史速度。
 */
function build_translation_task_summary_display(
  metrics: BatchTranslationMetrics,
  t: ReturnType<typeof useI18n>["t"],
): WorkbenchTranslationSummaryDisplay {
  let status_text = t("workbench_page.task.summary.empty");
  if (metrics.stopping) {
    status_text = t("workbench_page.task.summary.stopping");
  } else if (metrics.active) {
    status_text = t("workbench_page.translation_task.summary.running");
  }

  const show_runtime = metrics.active || metrics.stopping;

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_generation_speed) : null,
    tone: resolve_task_tone({
      active: metrics.active,
      stopping: metrics.stopping,
    }),
    show_spinner: show_runtime,
    detail_tooltip_text: t("workbench_page.task.summary.detail_tooltip"),
  };
}

/**
 * 运行或停止中信任任务快照；空闲后回落到项目事实统计。
 */
function resolve_task_detail_progress_percent(args: {
  metrics: Pick<BatchTranslationMetrics, "active" | "stopping" | "completion_percent">;
  workbench_stats: WorkbenchStats;
}): number {
  // 任务详情运行中展示 BatchTranslationSnapshot 进度；空闲态才回落到项目事实统计，避免新任务沿用旧百分比。
  return args.metrics.active || args.metrics.stopping
    ? args.metrics.completion_percent
    : args.workbench_stats.completion_percent;
}

/**
 * 将翻译任务快照组装成详情面板契约，停止中禁用重复停止。
 */
function build_translation_task_detail_display(args: {
  metrics: BatchTranslationMetrics;
  progress_percent: number;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): WorkbenchTranslationDetailDisplay {
  return {
    title: args.t("workbench_page.translation_task.detail.title"),
    description: args.t("workbench_page.translation_task.detail.description"),
    waveform_title: args.t("workbench_page.translation_task.detail.waveform_title"),
    metrics_title: args.t("workbench_page.translation_task.detail.metrics_title"),
    completion_percent_text: `${args.progress_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("workbench_page.task.summary.stopping")
      : args.t("workbench_page.action.stop_task"),
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
  translation_workbench_task: TranslationWorkbenchTask;
  active_workbench_task_view: WorkbenchTranslationViewState;
  active_workbench_task_summary: WorkbenchTranslationSummaryDisplay;
  active_workbench_task_detail: WorkbenchTranslationDetailDisplay | null;
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
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  prepare_entry_action: (entry_id: string) => void;
  request_add_file: () => Promise<void>;
  request_add_file_from_path: (source_path: string) => Promise<void>;
  request_add_files_from_paths: (source_paths: string[]) => Promise<void>;
  notify_add_file_drop_issue: (issue: WorkbenchAddFileDropIssue) => void;
  request_close_project: () => void;
  request_reset_file: (entry_id: string) => void;
  request_delete_selected_files: () => void;
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>;
  confirm_dialog: () => Promise<void>;
  secondary_dialog: () => Promise<void>;
  close_dialog: () => void;
};

type UseWorkbenchPageStateOptions = {
  translationWorkbenchTask: TranslationWorkbenchTask; // 常驻任务会话由 BatchTranslationSessionProvider 持有
};

/**
 * 将项目文件快照、选择状态、文件写入和常驻任务视图整合为工作台页面契约。
 *
 * 常驻任务由上层会话持有；此 Hook 只投影展示状态并串行化项目文件写入。
 */
export function useWorkbenchPageState(
  options: UseWorkbenchPageStateOptions,
): UseWorkbenchPageStateResult {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const raw_translation_workbench_task = options.translationWorkbenchTask;
  const {
    project_snapshot,
    commit_project_write,
    refresh_batch_translation,
    refresh_project_snapshot,
    settings_snapshot,
  } = useDesktopState();
  const project_change_signal = useProjectChangeSignal();
  const task_snapshot = useBatchTranslationSnapshot();
  const runtime_snapshot = useRuntimeSnapshot();
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
  const [is_write_running, set_is_write_running] = useState(false);
  const previous_workbench_change_seq_ref = useRef(0);
  const previous_project_loaded_ref = useRef(false);
  const workbench_change_seq = useMemo(() => {
    return resolveProjectChangeSeqForSections(project_change_signal, WORKBENCH_REFRESH_SECTIONS);
  }, [project_change_signal]);
  // 工作台文件写入共享同一份窄设置镜像，避免各入口重复拼命令字段。
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

  const get_workbench_planning_state = useCallback((): WorkbenchCommandPlanningState => {
    return {
      files: entries_ref.current.map((entry) => ({
        rel_path: entry.rel_path,
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
        const response = await api_fetch<WorkbenchQueryResponse>("/api/workbench/snapshot", {});
        const next_snapshot = response.snapshot;

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

  // 工作台缓存是可重建计算状态，增量更新失败只记录异常并回退到全量重建。
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
      }
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_workbench_snapshot_state();
      set_cache_status("refreshing");
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

  const stats = snapshot.translation_stats;
  const active_workbench_task_view = { can_open_detail: true };
  const active_workbench_task_summary =
    raw_translation_workbench_task.translation_task_display_snapshot === null
      ? build_empty_task_summary_display(t)
      : build_translation_task_summary_display(
          raw_translation_workbench_task.translation_task_metrics,
          t,
        );
  const active_workbench_task_detail = build_translation_task_detail_display({
    metrics: raw_translation_workbench_task.translation_task_metrics,
    progress_percent: resolve_task_detail_progress_percent({
      metrics: raw_translation_workbench_task.translation_task_metrics,
      workbench_stats: snapshot.translation_stats,
    }),
    waveform_history: raw_translation_workbench_task.translation_waveform_history,
    t,
  });

  const readonly =
    !project_snapshot.loaded ||
    is_runtime_busy(runtime_snapshot) ||
    file_op_running ||
    is_write_running;
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
  // 为什么：生成当前可用译文允许翻译运行中触发，但停止收尾和结构写入中必须保持单入口
  const can_generate_translation =
    project_snapshot.loaded &&
    !file_op_running &&
    !is_write_running &&
    !is_task_stopping(task_snapshot);
  const can_close_project =
    project_snapshot.loaded && !is_runtime_busy(runtime_snapshot) && !is_write_running;

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

  const run_project_file_write = useCallback(
    async (
      plan: WorkbenchCommandPlan,
      request: (body: Record<string, unknown>) => Promise<ProjectWriteResultPayload>,
    ): Promise<ProjectWriteResultPayload> => {
      set_is_write_running(true);
      set_file_op_running(true);

      try {
        const { payload } = await commit_project_write({
          operation: WORKBENCH_FILE_WRITE,
          run: async () => {
            return await request(plan.requestBody);
          },
        });
        await refresh_batch_translation();
        await refresh_snapshot();
        return payload;
      } catch (error) {
        set_file_op_running(false);
        throw error;
      } finally {
        set_is_write_running(false);
      }
    },
    [commit_project_write, refresh_snapshot, refresh_batch_translation],
  );

  const import_files_flow = useWorkbenchImportFilesFlow({
    readonly,
    project_identity: project_snapshot.loaded ? project_snapshot.path : "",
    dialog_state,
    get_planning_state: get_workbench_planning_state,
    planner_settings,
    run_modal_progress_toast,
    run_project_file_write,
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

  /**
   * 触发当前界面反馈行为。
   */
  function notify_add_file_drop_issue(issue: WorkbenchAddFileDropIssue): void {
    push_toast(
      "warning",
      issue === "multiple" ? t("app.drop.multiple_unavailable") : t("app.drop.unavailable"),
    );
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
          state: get_workbench_planning_state(),
          ordered_rel_paths: ordered_entry_ids,
        });
        await run_project_file_write(reorder_plan, async (body) => {
          return await api_fetch<ProjectWriteResultPayload>("/api/workbench/files/reorder", body);
        });
      } catch {
        push_toast("error", t("workbench_page.reorder.failed"));
      }
    },
    [entries.length, get_workbench_planning_state, push_toast, readonly, run_project_file_write, t],
  );

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
          rel_path: target_rel_path,
          settings: planner_settings,
        });
        await run_project_file_write(reset_plan, async (body) => {
          return await api_fetch<ProjectWriteResultPayload>("/api/workbench/file/reset", body);
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
          rel_paths: current_dialog_state.target_rel_paths,
          settings: planner_settings,
        });
        await run_project_file_write(delete_plan, async (body) => {
          return await api_fetch<ProjectWriteResultPayload>("/api/workbench/file/delete", body);
        });

        set_dialog_state(close_dialog_state());
        return;
      }

      if (current_dialog_state.kind === "close-project") {
        set_is_write_running(true);
        try {
          await api_fetch("/api/session/project/close", {});
          await refresh_project_snapshot();
          set_snapshot(EMPTY_SNAPSHOT);
          set_file_op_running(false);
          set_entries([]);
          apply_selection_state(create_empty_selection_state());
          await refresh_batch_translation();
          set_dialog_state(close_dialog_state());
        } finally {
          set_is_write_running(false);
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
        current_dialog_state.kind === "close-project"
          ? t("workbench_page.feedback.close_project_failed")
          : t("workbench_page.feedback.file_action_failed");

      push_toast("error", resolve_visible_error_message(error, t, fallback_message));
      set_dialog_submitting(false);
    }
  }

  async function secondary_dialog(): Promise<void> {
    await import_files_flow.secondary_dialog();
  }

  function close_dialog(): void {
    if (import_files_flow.close_dialog()) {
      return;
    }

    if (dialog_state.submitting) {
      return;
    }

    set_dialog_state(close_dialog_state());
  }

  const translation_workbench_task = raw_translation_workbench_task;

  return {
    cache_status,
    consumed_revisions,
    required_sections: WORKBENCH_REQUIRED_SECTIONS,
    settled_project_path,
    is_refreshing,
    file_op_running,
    stats,
    translation_stats: snapshot.translation_stats,
    translation_workbench_task,
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
    apply_table_selection,
    prepare_entry_action,
    request_add_file,
    request_add_file_from_path,
    request_add_files_from_paths,
    notify_add_file_drop_issue,
    request_close_project,
    request_reset_file,
    request_delete_selected_files,
    request_reorder_entries,
    confirm_dialog,
    secondary_dialog,
    close_dialog,
  };
}
