import type { AppTableSortState } from '@/widgets/app-table/app-table-types'

import type { LocaleKey } from '@/i18n'

export type TextReplacementEntry = {
  entry_id?: string
  src: string
  dst: string
  regex: boolean
  case_sensitive: boolean
}

export type TextReplacementEntryId = string

export type TextReplacementDialogMode = 'create' | 'edit'

export type TextReplacementDialogState = {
  open: boolean
  mode: TextReplacementDialogMode
  target_entry_id: TextReplacementEntryId | null
  insert_after_entry_id: TextReplacementEntryId | null
  draft_entry: TextReplacementEntry
  dirty: boolean
  saving: boolean
  validation_message: string | null
}

export type TextReplacementFilterScope = 'all' | 'src' | 'dst'

export type TextReplacementFilterState = {
  keyword: string
  scope: TextReplacementFilterScope
  is_regex: boolean
}

export type TextReplacementStatisticsState = {
  running: boolean
  completed_revision: number | null
  completed_entry_ids: TextReplacementEntryId[]
  matched_count_by_entry_id: Record<TextReplacementEntryId, number>
  subset_parent_labels_by_entry_id: Record<TextReplacementEntryId, string[]>
}

export type TextReplacementStatisticsBadgeKind = 'matched' | 'unmatched' | 'related'

export type TextReplacementStatisticsBadgeState = {
  kind: TextReplacementStatisticsBadgeKind
  matched_count: number
  subset_parent_labels: string[]
  tooltip: string
}

export type TextReplacementVisibleEntry = {
  entry: TextReplacementEntry
  entry_id: TextReplacementEntryId
  source_index: number
}

export type TextReplacementPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
  is_default?: boolean
}

export type TextReplacementConfirmState =
  | {
      open: false
      kind: null
      selection_count: number
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
      target_entry_id: TextReplacementEntryId | null
    }
  | {
      open: true
      kind:
        | 'delete-selection'
        | 'delete-preset'
        | 'reset'
        | 'overwrite-preset'
        | 'delete-entry'
      selection_count: number
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
      target_entry_id: TextReplacementEntryId | null
    }

export type TextReplacementPresetInputState =
  | {
      open: false
      mode: null
      value: string
      submitting: boolean
      target_virtual_id: string | null
    }
  | {
      open: true
      mode: 'save' | 'rename'
      value: string
      submitting: boolean
      target_virtual_id: string | null
    }

export type TextReplacementSortState = AppTableSortState | null

export type UseTextReplacementPageStateResult = {
  title_key: LocaleKey
  enabled: boolean
  entries: TextReplacementEntry[]
  filtered_entries: TextReplacementVisibleEntry[]
  filter_state: TextReplacementFilterState
  sort_state: TextReplacementSortState
  has_active_filters: boolean
  invalid_filter_message: string | null
  drag_disabled: boolean
  statistics_state: TextReplacementStatisticsState
  statistics_ready: boolean
  statistics_badge_by_entry_id: Record<
    TextReplacementEntryId,
    TextReplacementStatisticsBadgeState
  >
  preset_items: TextReplacementPresetItem[]
  selected_entry_ids: TextReplacementEntryId[]
  active_entry_id: TextReplacementEntryId | null
  selection_anchor_entry_id: TextReplacementEntryId | null
  preset_menu_open: boolean
  dialog_state: TextReplacementDialogState
  confirm_state: TextReplacementConfirmState
  preset_input_state: TextReplacementPresetInputState
  update_filter_keyword: (next_keyword: string) => void
  update_filter_scope: (next_scope: TextReplacementFilterScope) => void
  update_filter_regex: (next_is_regex: boolean) => void
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void
  apply_table_selection: (
    payload: import('@/widgets/app-table/app-table-types').AppTableSelectionChange,
  ) => void
  update_enabled: (next_enabled: boolean) => Promise<void>
  open_create_dialog: () => void
  open_edit_dialog: (entry_id: TextReplacementEntryId) => void
  update_dialog_draft: (patch: Partial<TextReplacementEntry>) => void
  import_entries_from_path: (path: string) => Promise<void>
  import_entries_from_picker: () => Promise<void>
  export_entries_from_picker: () => Promise<void>
  run_statistics: () => Promise<void>
  open_preset_menu: () => Promise<void>
  apply_preset: (virtual_id: string) => Promise<void>
  request_reset_entries: () => void
  request_save_preset: () => void
  request_rename_preset: (preset_item: TextReplacementPresetItem) => void
  request_delete_preset: (preset_item: TextReplacementPresetItem) => void
  set_default_preset: (virtual_id: string) => Promise<void>
  cancel_default_preset: () => Promise<void>
  delete_selected_entries: () => Promise<void>
  request_delete_entry: (entry_id: TextReplacementEntryId) => void
  toggle_regex_for_selected: (next_value: boolean) => Promise<void>
  toggle_case_sensitive_for_selected: (next_value: boolean) => Promise<void>
  reorder_selected_entries: (
    active_entry_id: TextReplacementEntryId,
    over_entry_id: TextReplacementEntryId,
  ) => Promise<void>
  move_selected_entries: (
    direction: 'up' | 'down' | 'top' | 'bottom',
  ) => Promise<void>
  query_entry_source: (entry_id: TextReplacementEntryId) => Promise<void>
  search_entry_relations_from_statistics: (
    entry_id: TextReplacementEntryId,
  ) => void
  save_dialog_entry: () => Promise<void>
  request_close_dialog: () => Promise<void>
  confirm_pending_action: () => Promise<void>
  close_confirm_dialog: () => void
  update_preset_input_value: (next_value: string) => void
  submit_preset_input: () => Promise<void>
  close_preset_input_dialog: () => void
  set_preset_menu_open: (next_open: boolean) => void
}
