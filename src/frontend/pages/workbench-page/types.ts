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

export type WorkbenchStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};
