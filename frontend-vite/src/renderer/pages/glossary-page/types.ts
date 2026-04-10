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

export type GlossaryTextColumnFilter =
  | {
      mode: 'contains'
      keyword: string
    }
  | {
      mode: 'empty'
    }

export type GlossaryRuleColumnFilter =
  | 'case-sensitive'
  | 'case-insensitive'

export type GlossaryStatisticsColumnFilter =
  | 'matched'
  | 'unmatched'
  | 'related'

export type GlossaryColumnFilters = {
  src: GlossaryTextColumnFilter | null
  dst: GlossaryTextColumnFilter | null
  info: GlossaryTextColumnFilter | null
  rule: GlossaryRuleColumnFilter | null
  statistics: GlossaryStatisticsColumnFilter | null
}

export type GlossaryColumnFilterField = keyof GlossaryColumnFilters

export type GlossaryVisibleEntry = {
  entry: GlossaryEntry
  entry_id: GlossaryEntryId
  source_index: number
}

export type GlossaryFilterChip = {
  id: 'keyword' | 'regex' | GlossaryColumnFilterField
  label: string
}

export type GlossaryPresetItem = {
  name: string
  virtual_id: string
  type: 'builtin' | 'user'
  path?: string
}
