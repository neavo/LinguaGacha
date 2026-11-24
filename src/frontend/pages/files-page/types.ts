type WorkbenchActionKind =
  | "confirm-import-files"
  | "inherit-import-files"
  | "reset-file"
  | "rename-file"
  | "delete-file";

export type WorkbenchDialogState = {
  kind: WorkbenchActionKind | null;
  target_rel_paths: string[];
  pending_path: string | null;
  submitting: boolean;
};
