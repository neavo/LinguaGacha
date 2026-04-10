export type GlossaryEntry = {
  entry_id?: string
  src: string
  dst: string
  info: string
  case_sensitive: boolean
}

export type GlossaryEntryId = string

export type GlossaryDialogMode = 'create' | 'edit'

export type GlossaryDialogState = {
  open: boolean
  mode: GlossaryDialogMode
  target_entry_id: GlossaryEntryId | null
  insert_after_entry_id: GlossaryEntryId | null
  draft_entry: GlossaryEntry
  dirty: boolean
  saving: boolean
}

export type GlossaryFilterScope = 'all' | 'src' | 'dst' | 'info'

export type GlossaryFilterState = {
  keyword: string
  scope: GlossaryFilterScope
  is_regex: boolean
}

export type GlossaryStatisticsState = {
  running: boolean
  completed_revision: number | null
  completed_entry_ids: GlossaryEntryId[]
  matched_count_by_entry_id: Record<GlossaryEntryId, number>
  subset_parent_labels_by_entry_id: Record<GlossaryEntryId, string[]>
}

export type GlossaryStatisticsBadgeKind = 'matched' | 'unmatched' | 'related'

export type GlossaryStatisticsBadgeState = {
  kind: GlossaryStatisticsBadgeKind
  matched_count: number
  subset_parent_labels: string[]
  tooltip: string
}

export type GlossaryOptionalTextColumnFilter = 'empty'

export type GlossaryRuleColumnFilter =
  | 'case-sensitive'
  | 'case-insensitive'

export type GlossaryStatisticsColumnFilter =
  | 'matched'
  | 'unmatched'
  | 'related'

export type GlossaryColumnFilters = {
  dst: GlossaryOptionalTextColumnFilter | null
  info: GlossaryOptionalTextColumnFilter | null
  rule: GlossaryRuleColumnFilter | null
  statistics: GlossaryStatisticsColumnFilter | null
}

export type GlossaryColumnFilterField = keyof GlossaryColumnFilters

export type GlossaryVisibleEntry = {
  entry: GlossaryEntry
  entry_id: GlossaryEntryId
  source_index: number
}

export type GlossaryPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
  is_default?: boolean
}

export type GlossaryConfirmState =
  | {
      open: false
      kind: null
      selection_count: number
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
    }
  | {
      open: true
      kind: 'delete-selection' | 'delete-preset' | 'reset' | 'overwrite-preset'
      selection_count: number
      preset_name: string
      preset_input_value: string
      submitting: boolean
      target_virtual_id: string | null
    }

export type GlossaryPresetInputState =
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
