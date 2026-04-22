type WorkbenchActionKind =
  | "replace-file"
  | "reset-file"
  | "delete-file"
  | "export-translation"
  | "close-project";

export type WorkbenchSnapshotEntry = {
  rel_path: string;
  file_type: string;
  item_count: number;
};

export type WorkbenchFileEntry = WorkbenchSnapshotEntry;

export type WorkbenchSelectorFileRecord = {
  rel_path: string;
  file_type: string;
};

export type WorkbenchSelectorItemRecord = {
  item_id: number;
  file_path: string;
  status: string;
};

export type WorkbenchSnapshot = {
  file_count: number;
  total_items: number;
  translated: number;
  translated_in_past: number;
  error_count: number;
  file_op_running: boolean;
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

export type WorkbenchTaskSummaryViewModel = {
  status_text: string;
  trailing_text: string | null;
  tone: WorkbenchTaskTone;
  show_spinner: boolean;
  detail_tooltip_text: string;
};

export type WorkbenchTaskDetailViewModel = {
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

export type WorkbenchTaskConfirmDialogViewModel = {
  open: boolean;
  title: string;
  description: string;
  submitting: boolean;
};

export type WorkbenchStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
};
