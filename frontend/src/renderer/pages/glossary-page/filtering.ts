import type {
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryFilterState,
  GlossarySortDirection,
  GlossarySortField,
  GlossarySortState,
  GlossaryStatisticsBadgeKind,
  GlossaryStatisticsState,
  GlossaryVisibleEntry,
} from '@/pages/glossary-page/types'

const GLOSSARY_TEXT_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

type BuildGlossaryFilterResultOptions = {
  entries: GlossaryEntry[]
  entry_ids: GlossaryEntryId[]
  filter_state: GlossaryFilterState
  sort_state: GlossarySortState
  statistics_ready: boolean
  statistics_state: GlossaryStatisticsState
  completed_statistics_entry_id_set: ReadonlySet<GlossaryEntryId>
}

type BuildGlossaryFilterResult = {
  visible_entries: GlossaryVisibleEntry[]
  invalid_regex_message: string | null
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

export function has_active_glossary_filters(
  filter_state: GlossaryFilterState,
): boolean {
  return filter_state.keyword.trim() !== ''
}

function compare_glossary_text_value(
  left_value: string,
  right_value: string,
  direction: GlossarySortDirection,
): number {
  const normalized_left_value = left_value.trim()
  const normalized_right_value = right_value.trim()
  const left_is_empty = normalized_left_value === ''
  const right_is_empty = normalized_right_value === ''

  if (left_is_empty && right_is_empty) {
    return 0
  }

  if (left_is_empty) {
    return 1
  }

  if (right_is_empty) {
    return -1
  }

  const comparison_result = GLOSSARY_TEXT_SORTER.compare(
    normalized_left_value,
    normalized_right_value,
  )

  return direction === 'ascending'
    ? comparison_result
    : comparison_result * -1
}

function resolve_glossary_sort_comparison(
  left_entry: GlossaryVisibleEntry,
  right_entry: GlossaryVisibleEntry,
  field: GlossarySortField,
  direction: GlossarySortDirection,
  statistics_state: GlossaryStatisticsState,
): number {
  if (field === 'src' || field === 'dst' || field === 'info') {
    return compare_glossary_text_value(
      left_entry.entry[field],
      right_entry.entry[field],
      direction,
    )
  }

  if (field === 'rule') {
    const left_value = left_entry.entry.case_sensitive ? 1 : 0
    const right_value = right_entry.entry.case_sensitive ? 1 : 0
    return direction === 'ascending'
      ? left_value - right_value
      : right_value - left_value
  }

  const left_value = statistics_state.matched_count_by_entry_id[left_entry.entry_id] ?? 0
  const right_value = statistics_state.matched_count_by_entry_id[right_entry.entry_id] ?? 0
  return direction === 'ascending'
    ? left_value - right_value
    : right_value - left_value
}

function apply_glossary_sort(
  visible_entries: GlossaryVisibleEntry[],
  sort_state: GlossarySortState,
  statistics_ready: boolean,
  statistics_state: GlossaryStatisticsState,
): GlossaryVisibleEntry[] {
  if (sort_state.field === null || sort_state.direction === null) {
    return visible_entries
  }

  if (sort_state.field === 'statistics' && !statistics_ready) {
    return visible_entries
  }

  // 逻辑排序只改变当前可见结果的展示顺序，真实数据顺序始终由 source_index 保底。
  return [...visible_entries].sort((left_entry, right_entry) => {
    const comparison_result = resolve_glossary_sort_comparison(
      left_entry,
      right_entry,
      sort_state.field,
      sort_state.direction,
      statistics_state,
    )

    if (comparison_result !== 0) {
      return comparison_result
    }

    return left_entry.source_index - right_entry.source_index
  })
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

    return keyword_matcher.matches(entry)
      ? [{ entry, entry_id, source_index }]
      : []
  })

  const sorted_visible_entries = apply_glossary_sort(
    visible_entries,
    options.sort_state,
    options.statistics_ready,
    options.statistics_state,
  )

  return {
    visible_entries: sorted_visible_entries,
    invalid_regex_message: null,
  }
}
