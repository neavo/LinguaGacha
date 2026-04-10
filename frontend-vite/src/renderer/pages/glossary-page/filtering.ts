import type {
  GlossaryColumnFilters,
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryFilterState,
  GlossaryOptionalTextColumnFilter,
  GlossaryStatisticsBadgeKind,
  GlossaryStatisticsState,
  GlossaryVisibleEntry,
} from '@/pages/glossary-page/types'

type BuildGlossaryFilterResultOptions = {
  entries: GlossaryEntry[]
  entry_ids: GlossaryEntryId[]
  filter_state: GlossaryFilterState
  column_filters: GlossaryColumnFilters
  statistics_ready: boolean
  statistics_state: GlossaryStatisticsState
  completed_statistics_entry_id_set: ReadonlySet<GlossaryEntryId>
}

type BuildGlossaryFilterResult = {
  visible_entries: GlossaryVisibleEntry[]
  invalid_regex_message: string | null
}

function match_text_column_filter(
  value: string,
  filter: GlossaryOptionalTextColumnFilter | null,
): boolean {
  if (filter === null) {
    return true
  }

  return value.trim() === ''
}

function build_keyword_matcher(
  filter_state: GlossaryFilterState,
): {
  invalid_regex_message: string | null
  matches: (entry: GlossaryEntry) => boolean
} {
  const normalized_keyword = filter_state.keyword.trim()
  if (normalized_keyword === '') {
    return {
      invalid_regex_message: null,
      matches: () => true,
    }
  }

  let invalid_regex_message: string | null = null
  let is_match = (value: string): boolean => {
    return value.toLowerCase().includes(normalized_keyword.toLowerCase())
  }

  if (filter_state.is_regex) {
    try {
      const pattern = new RegExp(filter_state.keyword, 'i')
      is_match = (value: string): boolean => {
        return pattern.test(value)
      }
    } catch (error) {
      invalid_regex_message = error instanceof Error
        ? error.message
        : 'Invalid regular expression'
    }
  }

  return {
    invalid_regex_message,
    matches: (entry: GlossaryEntry): boolean => {
      if (invalid_regex_message !== null) {
        return false
      }

      const target_value = filter_state.scope === 'src'
        ? entry.src
        : filter_state.scope === 'dst'
          ? entry.dst
          : filter_state.scope === 'info'
            ? entry.info
            : [entry.src, entry.dst, entry.info].join('\n')

      return is_match(target_value)
    },
  }
}

export function create_empty_glossary_column_filters(): GlossaryColumnFilters {
  return {
    dst: null,
    info: null,
    rule: null,
    statistics: null,
  }
}

export function has_active_glossary_filters(
  filter_state: GlossaryFilterState,
  column_filters: GlossaryColumnFilters,
): boolean {
  return (
    filter_state.keyword.trim() !== ''
    || column_filters.dst !== null
    || column_filters.info !== null
    || column_filters.rule !== null
    || column_filters.statistics !== null
  )
}

export function resolve_glossary_statistics_badge_kind(
  entry_id: GlossaryEntryId,
  statistics_state: GlossaryStatisticsState,
  completed_statistics_entry_id_set: ReadonlySet<GlossaryEntryId>,
): GlossaryStatisticsBadgeKind | null {
  if (!completed_statistics_entry_id_set.has(entry_id)) {
    return null
  }

  const matched_count = statistics_state.matched_count_by_entry_id[entry_id] ?? 0
  const subset_parent_labels = statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? []

  if (matched_count === 0) {
    return 'unmatched'
  }

  if (subset_parent_labels.length > 0) {
    return 'related'
  }

  return 'matched'
}

export function build_glossary_filter_result(
  options: BuildGlossaryFilterResultOptions,
): BuildGlossaryFilterResult {
  const keyword_matcher = build_keyword_matcher(options.filter_state)
  if (keyword_matcher.invalid_regex_message !== null) {
    return {
      visible_entries: [],
      invalid_regex_message: keyword_matcher.invalid_regex_message,
    }
  }

  const visible_entries = options.entries.flatMap((entry, source_index) => {
    const entry_id = options.entry_ids[source_index]
    if (entry_id === undefined) {
      return []
    }

    const statistics_kind = !options.statistics_ready
      ? null
      : resolve_glossary_statistics_badge_kind(
          entry_id,
          options.statistics_state,
          options.completed_statistics_entry_id_set,
        )
    const matches_statistics = !options.statistics_ready
      || options.column_filters.statistics === null
      || statistics_kind === options.column_filters.statistics

    const matches_entry = keyword_matcher.matches(entry)
      && match_text_column_filter(entry.dst, options.column_filters.dst)
      && match_text_column_filter(entry.info, options.column_filters.info)
      && (
        options.column_filters.rule === null
        || (
          options.column_filters.rule === 'case-sensitive'
            ? entry.case_sensitive
            : !entry.case_sensitive
        )
      )
      && matches_statistics

    return matches_entry
      ? [{ entry, entry_id, source_index }]
      : []
  })

  return {
    visible_entries,
    invalid_regex_message: null,
  }
}
