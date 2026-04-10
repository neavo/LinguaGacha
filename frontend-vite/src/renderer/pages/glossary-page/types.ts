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
  draft_entry: GlossaryEntry
  dirty: boolean
  saving: boolean
}

export type GlossarySearchState = {
  keyword: string
  is_regex: boolean
  matched_entry_ids: GlossaryEntryId[]
  current_match_index: number
  invalid_regex_message: string | null
}

export type GlossaryStatisticsState = {
  running: boolean
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

export type GlossaryPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
}
