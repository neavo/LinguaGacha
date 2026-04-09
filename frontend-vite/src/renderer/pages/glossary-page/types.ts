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
  matched_entry_ids: GlossaryEntryId[]
  current_match_index: number
}

export type GlossaryStatisticsState = {
  running: boolean
  matched_count_by_entry_id: Record<GlossaryEntryId, number>
  subset_parent_labels_by_entry_id: Record<GlossaryEntryId, string[]>
}

export type GlossaryPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
}
