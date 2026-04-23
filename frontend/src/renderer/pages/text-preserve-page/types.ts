import type { QualityStatisticsDependencySnapshot } from "@/app/project-runtime/quality-statistics-auto";
import type { AppTableSortState } from "@/widgets/app-table/app-table-types";

import type { LocaleKey } from "@/i18n";

export type TextPreserveEntry = {
  entry_id?: string;
  src: string;
  info: string;
};

export type TextPreserveEntryId = string;

export type TextPreserveMode = "off" | "smart" | "custom";

export type TextPreserveDialogMode = "create" | "edit";

export type TextPreserveDialogState = {
  open: boolean;
  mode: TextPreserveDialogMode;
  target_entry_id: TextPreserveEntryId | null;
  insert_after_entry_id: TextPreserveEntryId | null;
  draft_entry: TextPreserveEntry;
  dirty: boolean;
  saving: boolean;
  validation_message: string | null;
};

export type TextPreserveFilterScope = "all" | "src" | "info";

export type TextPreserveFilterState = {
  keyword: string;
  scope: TextPreserveFilterScope;
  is_regex: boolean;
};

export type TextPreserveStatisticsState = {
  running: boolean;
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  completed_entry_ids: TextPreserveEntryId[];
  matched_count_by_entry_id: Record<TextPreserveEntryId, number>;
  subset_parent_labels_by_entry_id: Record<TextPreserveEntryId, string[]>;
};

export type TextPreserveStatisticsBadgeKind = "matched" | "unmatched" | "related";

export type TextPreserveStatisticsBadgeState = {
  kind: TextPreserveStatisticsBadgeKind;
  matched_count: number;
  subset_parent_labels: string[];
  tooltip: string;
};

export type TextPreserveVisibleEntry = {
  entry: TextPreserveEntry;
  entry_id: TextPreserveEntryId;
  source_index: number;
};

export type TextPreservePresetItem = {
  name: string;
  virtual_id: string;
  type: "builtin" | "user";
  path?: string;
  is_default?: boolean;
};

export type TextPreserveConfirmState =
  | {
      open: false;
      kind: null;
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    }
  | {
      open: true;
      kind: "delete-selection" | "delete-preset" | "reset" | "overwrite-preset";
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    };

export type TextPreservePresetInputState =
  | {
      open: false;
      mode: null;
      value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    }
  | {
      open: true;
      mode: "save" | "rename";
      value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    };

type TextPreserveSortState = AppTableSortState | null;

export type UseTextPreservePageStateResult = {
  title_key: LocaleKey;
  mode: TextPreserveMode;
  mode_updating: boolean;
  filtered_entries: TextPreserveVisibleEntry[];
  filter_state: TextPreserveFilterState;
  sort_state: TextPreserveSortState;
  invalid_filter_message: string | null;
  drag_disabled: boolean;
  statistics_state: TextPreserveStatisticsState;
  statistics_ready: boolean;
  statistics_badge_by_entry_id: Record<TextPreserveEntryId, TextPreserveStatisticsBadgeState>;
  preset_items: TextPreservePresetItem[];
  selected_entry_ids: TextPreserveEntryId[];
  active_entry_id: TextPreserveEntryId | null;
  selection_anchor_entry_id: TextPreserveEntryId | null;
  preset_menu_open: boolean;
  dialog_state: TextPreserveDialogState;
  confirm_state: TextPreserveConfirmState;
  preset_input_state: TextPreservePresetInputState;
  update_filter_keyword: (next_keyword: string) => void;
  update_filter_scope: (next_scope: TextPreserveFilterScope) => void;
  update_filter_regex: (next_is_regex: boolean) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  apply_table_selection: (
    payload: import("@/widgets/app-table/app-table-types").AppTableSelectionChange,
  ) => void;
  update_mode: (next_mode: TextPreserveMode) => Promise<void>;
  open_create_dialog: () => void;
  open_edit_dialog: (entry_id: TextPreserveEntryId) => void;
  update_dialog_draft: (patch: Partial<TextPreserveEntry>) => void;
  import_entries_from_path: (path: string) => Promise<void>;
  import_entries_from_picker: () => Promise<void>;
  export_entries_from_picker: () => Promise<void>;
  open_preset_menu: () => Promise<void>;
  apply_preset: (virtual_id: string) => Promise<void>;
  request_reset_entries: () => void;
  request_save_preset: () => void;
  request_rename_preset: (preset_item: TextPreservePresetItem) => void;
  request_delete_preset: (preset_item: TextPreservePresetItem) => void;
  set_default_preset: (virtual_id: string) => Promise<void>;
  cancel_default_preset: () => Promise<void>;
  delete_selected_entries: () => Promise<void>;
  reorder_selected_entries: (
    active_entry_id: TextPreserveEntryId,
    over_entry_id: TextPreserveEntryId,
  ) => Promise<void>;
  query_entry_source: (entry_id: TextPreserveEntryId) => Promise<void>;
  search_entry_relations_from_statistics: (entry_id: TextPreserveEntryId) => void;
  save_dialog_entry: () => Promise<void>;
  request_close_dialog: () => Promise<void>;
  confirm_pending_action: () => Promise<void>;
  close_confirm_dialog: () => void;
  update_preset_input_value: (next_value: string) => void;
  submit_preset_input: () => Promise<void>;
  close_preset_input_dialog: () => void;
  set_preset_menu_open: (next_open: boolean) => void;
};
