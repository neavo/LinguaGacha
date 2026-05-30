type WorkbenchActionKind =
  | "confirm-import-files"
  | "inherit-import-files"
  | "reset-file"
  | "delete-file"
  | "generate-translation"
  | "close-project";

export type WorkbenchSnapshotEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
  item_count: number;
};

export type WorkbenchFileEntry = WorkbenchSnapshotEntry;

export type WorkbenchSelectorFileRecord = {
  rel_path: string;
  file_type: string;
  sort_index: number;
};

export type WorkbenchSelectorItemRecord = {
  item_id: number;
  file_path: string;
  src: string;
  status: string;
};

export type WorkbenchSnapshot = {
  file_count: number;
  total_items: number;
  translation_stats: WorkbenchStats;
  analysis_stats: WorkbenchStats;
  entries: WorkbenchSnapshotEntry[];
};

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null;
  target_rel_paths: string[];
  pending_path: string | null;
  submitting: boolean;
};

export type WorkbenchTaskKind = "translation" | "analysis";
export type WorkbenchStatsMode = WorkbenchTaskKind;

export type WorkbenchTaskViewState = {
  task_kind: WorkbenchTaskKind | null;
  can_open_detail: boolean;
};

export type WorkbenchTaskTone = "neutral" | "success" | "warning";

export type WorkbenchTaskMetricEntry = {
  key: string;
  label: string;
  value_text: string;
  unit_text: string;
};

/**
 * WorkbenchTaskSummaryDisplay 是任务胶囊需要的紧凑展示数据。
 */
export type WorkbenchTaskSummaryDisplay = {
  status_text: string;
  trailing_text: string | null;
  tone: WorkbenchTaskTone;
  show_spinner: boolean;
  detail_tooltip_text: string;
};

/**
 * WorkbenchTaskDetailDisplay 是详情抽屉消费的完整任务展示数据。
 */
export type WorkbenchTaskDetailDisplay = {
  title: string;
  description: string;
  waveform_title: string;
  metrics_title: string;
  completion_percent_text: string;
  percent_tone: WorkbenchTaskTone;
  metric_entries: WorkbenchTaskMetricEntry[];
  stop_button_label: string;
  stop_disabled: boolean;
  waveform_history: number[];
};

/**
 * WorkbenchTaskConfirmDialogDisplay 描述停止任务确认弹窗的展示状态。
 */
export type WorkbenchTaskConfirmDialogDisplay = {
  open: boolean;
  description: string;
  submitting: boolean;
};

export type WorkbenchStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};
