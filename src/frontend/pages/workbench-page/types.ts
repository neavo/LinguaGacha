type WorkbenchActionKind =
  | "confirm-import-files"
  | "inherit-import-files"
  | "reset-file"
  | "delete-file"
  | "close-project";

export type WorkbenchSnapshotEntry = {
  rel_path: string;
  file_type: string;
  sort_index: number;
  item_count: number;
};

export type WorkbenchFileEntry = WorkbenchSnapshotEntry;

export type WorkbenchSnapshot = {
  file_count: number;
  total_items: number;
  translation_stats: WorkbenchStats;
  entries: WorkbenchSnapshotEntry[];
};

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null;
  target_rel_paths: string[];
  pending_path: string | null;
  submitting: boolean;
};

export type WorkbenchTranslationViewState = {
  can_open_detail: boolean;
};

export type WorkbenchTranslationTone = "neutral" | "success" | "warning";

export type WorkbenchTranslationMetricEntry = {
  key: string;
  label: string;
  value_text: string;
  unit_text: string;
};

/**
 * WorkbenchTranslationSummaryDisplay 是任务胶囊需要的紧凑展示数据。
 */
export type WorkbenchTranslationSummaryDisplay = {
  status_text: string;
  trailing_text: string | null;
  tone: WorkbenchTranslationTone;
  show_spinner: boolean;
  detail_tooltip_text: string;
};

/**
 * WorkbenchTranslationDetailDisplay 是详情抽屉消费的完整任务展示数据。
 */
export type WorkbenchTranslationDetailDisplay = {
  title: string;
  description: string;
  waveform_title: string;
  metrics_title: string;
  completion_percent_text: string;
  percent_tone: WorkbenchTranslationTone;
  metric_entries: WorkbenchTranslationMetricEntry[];
  stop_button_label: string;
  stop_disabled: boolean;
  waveform_history: number[];
};

export type WorkbenchStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};
