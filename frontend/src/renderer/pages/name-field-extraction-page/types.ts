export type NameFieldStatus =
  | "untranslated"
  | "translated"
  | "translating"
  | "format-error"
  | "network-error";

export type NameFieldRow = {
  id: string;
  src: string;
  dst: string;
  context: string;
  status: NameFieldStatus;
};

export type NameFieldRowId = string;

export type NameFieldFilterScope = "all" | "src" | "dst";

export type NameFieldFilterState = {
  keyword: string;
  scope: NameFieldFilterScope;
  is_regex: boolean;
};

export type NameFieldConfirmState =
  | {
      open: false;
      kind: null;
      submitting: boolean;
      selection_count: number;
      target_row_ids: NameFieldRowId[];
    }
  | {
      open: true;
      kind: "delete-selection";
      submitting: boolean;
      selection_count: number;
      target_row_ids: NameFieldRowId[];
    };

export type NameFieldRunState = {
  extracting: boolean;
  translating: boolean;
  current_translating_row_id: NameFieldRowId | null;
};

export type NameFieldDialogState =
  | {
      open: false;
      target_row_id: null;
      draft_row: NameFieldRow;
      saving: boolean;
    }
  | {
      open: true;
      target_row_id: NameFieldRowId;
      draft_row: NameFieldRow;
      saving: boolean;
    };

export type NameFieldSortField = "index" | "src" | "dst" | "status";

export type NameFieldSortState =
  | {
      field: null;
      direction: null;
    }
  | {
      field: NameFieldSortField;
      direction: "ascending" | "descending";
    };
