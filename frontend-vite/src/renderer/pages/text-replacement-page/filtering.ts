import type {
  TextReplacementEntry,
  TextReplacementEntryId,
  TextReplacementFilterState,
  TextReplacementStatisticsBadgeKind,
  TextReplacementStatisticsState,
  TextReplacementVisibleEntry,
} from '@/pages/text-replacement-page/types'

const TEXT_REPLACEMENT_TEXT_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

type BuildTextReplacementFilterResultOptions = {
  entries: TextReplacementEntry[]
  entry_ids: TextReplacementEntryId[]
  filter_state: TextReplacementFilterState
}

type BuildTextReplacementFilterResult = {
  visible_entries: TextReplacementVisibleEntry[]
  invalid_regex_message: string | null
}

function build_keyword_matcher(
  filter_state: TextReplacementFilterState,
): {
  invalid_regex_message: string | null
  matches: (entry: TextReplacementEntry) => boolean
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
    matches: (entry: TextReplacementEntry): boolean => {
      if (invalid_regex_message !== null) {
        return false
      }

      const target_value = filter_state.scope === 'src'
        ? entry.src
        : filter_state.scope === 'dst'
          ? entry.dst
          : [entry.src, entry.dst].join('\n')

      return is_match(target_value)
    },
  }
}

function compare_text_replacement_text_value(
  left_value: string,
  right_value: string,
  direction: 'ascending' | 'descending',
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

  const comparison_result = TEXT_REPLACEMENT_TEXT_SORTER.compare(
    normalized_left_value,
    normalized_right_value,
  )

  return direction === 'ascending'
    ? comparison_result
    : comparison_result * -1
}

export function build_text_replacement_filter_result(
  options: BuildTextReplacementFilterResultOptions,
): BuildTextReplacementFilterResult {
  const keyword_matcher = build_keyword_matcher(options.filter_state)
  if (keyword_matcher.invalid_regex_message !== null) {
    return {
      visible_entries: [],
      invalid_regex_message: keyword_matcher.invalid_regex_message,
    }
  }

  return {
    visible_entries: options.entries.flatMap((entry, source_index) => {
      const entry_id = options.entry_ids[source_index]
      if (entry_id === undefined) {
        return []
      }

      return keyword_matcher.matches(entry)
        ? [{ entry, entry_id, source_index }]
        : []
    }),
    invalid_regex_message: null,
  }
}

export function has_active_text_replacement_filters(
  filter_state: TextReplacementFilterState,
): boolean {
  return filter_state.keyword.trim() !== ''
}

export function sort_text_replacement_entries(
  visible_entries: TextReplacementVisibleEntry[],
  sort_state: import('@/widgets/app-table/app-table-types').AppTableSortState | null,
  statistics_ready: boolean,
  statistics_state: TextReplacementStatisticsState,
): TextReplacementVisibleEntry[] {
  if (sort_state === null) {
    return visible_entries
  }

  if (sort_state.column_id === 'statistics' && !statistics_ready) {
    return visible_entries
  }

  return [...visible_entries].sort((left_entry, right_entry) => {
    let comparison_result = 0

    if (sort_state.column_id === 'src' || sort_state.column_id === 'dst') {
      comparison_result = compare_text_replacement_text_value(
        left_entry.entry[sort_state.column_id],
        right_entry.entry[sort_state.column_id],
        sort_state.direction,
      )
    } else if (sort_state.column_id === 'rule') {
      const left_value = Number(left_entry.entry.regex) * 2 + Number(left_entry.entry.case_sensitive)
      const right_value = Number(right_entry.entry.regex) * 2 + Number(right_entry.entry.case_sensitive)
      comparison_result = sort_state.direction === 'ascending'
        ? left_value - right_value
        : right_value - left_value
    } else if (sort_state.column_id === 'statistics') {
      const left_value = statistics_state.matched_count_by_entry_id[left_entry.entry_id] ?? 0
      const right_value = statistics_state.matched_count_by_entry_id[right_entry.entry_id] ?? 0
      comparison_result = sort_state.direction === 'ascending'
        ? left_value - right_value
        : right_value - left_value
    }

    if (comparison_result !== 0) {
      return comparison_result
    }

    return left_entry.source_index - right_entry.source_index
  })
}

export function resolve_text_replacement_statistics_badge_kind(
  entry_id: TextReplacementEntryId,
  statistics_state: TextReplacementStatisticsState,
  completed_statistics_entry_id_set: ReadonlySet<TextReplacementEntryId>,
): TextReplacementStatisticsBadgeKind | null {
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
