import type { PDFSummary } from "@shared/pdf";
type WorkbenchActionKind =
  | "confirm-import-files"
  | "inherit-import-files"
  | "reset-file"
  | "delete-file"
  | "close-project";

export type WorkbenchFileEntry = {
  pdf?: PDFSummary;
  rel_path: string;
  file_type: string;
  sort_index: number;
  item_count: number;
};

export type WorkbenchSnapshot = {
  entries: WorkbenchFileEntry[];
};

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null;
  target_rel_paths: string[];
  pending_path: string | null;
  submitting: boolean;
};
