import type { QualityRuleImportConfirmState } from "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import type { QualityRuleConfirmState } from "@frontend/features/quality-rule-editor/quality-rule-confirm-state";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { PresetInputState, PresetItem } from "@frontend/features/preset-editor/preset-types";
import type { QualityRuleTextReplacementEntry as TextReplacementEntry } from "@domain/quality";
export type { QualityRuleTextReplacementEntry as TextReplacementEntry } from "@domain/quality";

export type TextReplacementEntryId = string;
/** 创建草稿尚未分配项目身份，编辑草稿保留既有身份。 */
export type TextReplacementEntryDraft = Omit<TextReplacementEntry, "entry_id"> & {
  entry_id?: string;
};

export type TextReplacementDialogMode = "create" | "edit";

export type TextReplacementDialogState = {
  open: boolean;
  mode: TextReplacementDialogMode;
  target_entry_id: TextReplacementEntryId | null;
  insert_after_entry_id: TextReplacementEntryId | null;
  draft_entry: TextReplacementEntryDraft;
  saving: boolean;
  validation_message: string | null;
};

export type TextReplacementFilterScope = "all" | "src" | "dst";

export type TextReplacementFilterState = {
  keyword: string;
  scope: TextReplacementFilterScope;
  is_regex: boolean;
};

export type TextReplacementHitState = {
  running: boolean; // 首次分析是否仍在计算
  entry_ids: TextReplacementEntryId[] | null; // null 表示尚无可展示结果
  hits_by_entry_id: Record<TextReplacementEntryId, number>; // 已完成规则的 item 命中数
  subset_parents_by_entry_id: Record<TextReplacementEntryId, string[]>; // 字面量真实包含父文本
};

export type TextReplacementHitBadgeKind = "matched" | "unmatched" | "related";

export type TextReplacementHitBadgeState = {
  kind: TextReplacementHitBadgeKind;
  hits: number;
  subset_parents: string[]; // tooltip 展示的父规则原文
  tooltip: string;
};

export type TextReplacementVisibleEntry = {
  entry: TextReplacementEntry;
  entry_id: TextReplacementEntryId;
  source_index: number;
};

type TextReplacementSortState = AppTableSortState | null;

export type UseTextReplacementPageStateResult = {
  title_key: LocaleKey;
  enabled: boolean;
  entries: TextReplacementEntry[];
  filtered_entries: TextReplacementVisibleEntry[];
  filter_state: TextReplacementFilterState;
  sort_state: TextReplacementSortState;
  invalid_filter_message: string | null;
  readonly: boolean;
  drag_disabled: boolean;
  hit_state: TextReplacementHitState;
  hit_ready: boolean;
  hit_badge_by_entry_id: Record<TextReplacementEntryId, TextReplacementHitBadgeState>;
  preset_items: PresetItem[];
  selected_entry_ids: TextReplacementEntryId[];
  active_entry_id: TextReplacementEntryId | null;
  selection_anchor_entry_id: TextReplacementEntryId | null;
  restore_scroll_entry_id: TextReplacementEntryId | null;
  preset_menu_open: boolean;
  dialog_state: TextReplacementDialogState;
  confirm_state: QualityRuleConfirmState;
  import_confirm_state: QualityRuleImportConfirmState;
  preset_input_state: PresetInputState;
  update_filter_keyword: (next_keyword: string) => void;
  update_filter_scope: (next_scope: TextReplacementFilterScope) => void;
  update_filter_regex: (next_is_regex: boolean) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  apply_table_selection: (
    payload: import("@frontend/widgets/app-table/app-table-types").AppTableSelectionChange,
  ) => void;
  update_enabled: (next_enabled: boolean) => Promise<void>;
  open_create_dialog: () => void;
  open_edit_dialog: (entry_id: TextReplacementEntryId) => void;
  update_dialog_draft: (patch: Partial<TextReplacementEntryDraft>) => void;
  import_entries_from_path: (path: string) => Promise<void>;
  import_entries_from_picker: () => Promise<void>;
  export_entries_from_picker: () => Promise<void>;
  open_preset_menu: () => Promise<void>;
  apply_preset: (virtual_id: string) => Promise<void>;
  request_reset_entries: () => void;
  request_save_preset: () => void;
  request_rename_preset: (preset_item: PresetItem) => void;
  request_delete_preset: (preset_item: PresetItem) => void;
  set_default_preset: (virtual_id: string) => Promise<void>;
  cancel_default_preset: () => Promise<void>;
  delete_selected_entries: () => Promise<void>;
  toggle_regex_for_selected: (next_value: boolean) => Promise<void>;
  toggle_case_sensitive_for_selected: (next_value: boolean) => Promise<void>;
  reorder_selected_entries: (
    active_entry_id: TextReplacementEntryId,
    over_entry_id: TextReplacementEntryId,
  ) => Promise<void>;
  query_entry_source: (entry_id: TextReplacementEntryId) => Promise<void>;
  search_entry_relations_from_hit: (entry_id: TextReplacementEntryId) => void;
  save_dialog_entry: () => Promise<void>;
  request_close_dialog: () => Promise<void>;
  confirm_pending_action: () => Promise<void>;
  close_confirm_dialog: () => void;
  import_duplicate_skip: () => Promise<void>;
  import_duplicate_overwrite: () => Promise<void>;
  close_import_duplicate_confirm: () => void;
  update_preset_input_value: (next_value: string) => void;
  submit_preset_input: () => Promise<void>;
  close_preset_input_dialog: () => void;
  set_preset_menu_open: (next_open: boolean) => void;
};
