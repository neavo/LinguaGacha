import type {
  TextPreserveEntry,
  TextPreserveEntryId,
  TextPreserveFilterState,
  TextPreserveStatisticsState,
  TextPreserveVisibleEntry,
} from "@frontend/pages/text-preserve-page/types";
import {
  compare_quality_rule_text_value,
  create_quality_rule_keyword_matcher,
} from "@frontend/features/quality-rule-editor/quality-rule-filtering";

type BuildTextPreserveFilterResultOptions = {
  entries: TextPreserveEntry[];
  entry_ids: TextPreserveEntryId[];
  filter_state: TextPreserveFilterState;
};

type BuildTextPreserveFilterResult = {
  visible_entries: TextPreserveVisibleEntry[];
  invalid_regex_message: string | null;
};

function build_keyword_matcher(filter_state: TextPreserveFilterState): {
  invalid_regex_message: string | null;
  matches: (entry: TextPreserveEntry) => boolean;
} {
  return create_quality_rule_keyword_matcher(filter_state, (entry: TextPreserveEntry) => {
    return filter_state.scope === "src"
      ? entry.src
      : filter_state.scope === "info"
        ? entry.info
        : [entry.src, entry.info].join("\n");
  });
}

/**
 * 将保护条目与同索引 ID 组合为只读展示结果；无对应 ID 的脏快照不会进入表格。
 */
export function build_text_preserve_filter_result(
  options: BuildTextPreserveFilterResultOptions,
): BuildTextPreserveFilterResult {
  const keyword_matcher = build_keyword_matcher(options.filter_state);
  if (keyword_matcher.invalid_regex_message !== null) {
    return {
      visible_entries: [],
      invalid_regex_message: keyword_matcher.invalid_regex_message,
    };
  }

  return {
    visible_entries: options.entries.flatMap((entry, source_index) => {
      const entry_id = options.entry_ids[source_index];
      if (entry_id === undefined) {
        return [];
      }

      return keyword_matcher.matches(entry) ? [{ entry, entry_id, source_index }] : [];
    }),
    invalid_regex_message: null,
  };
}

/**
 * 仅排序当前可见副本，并以项目原始顺序稳定处理相同值。
 */
export function sort_text_preserve_entries(
  visible_entries: TextPreserveVisibleEntry[],
  sort_state: import("@frontend/widgets/app-table/app-table-types").AppTableSortState | null,
  statistics_ready: boolean,
  statistics_state: TextPreserveStatisticsState,
): TextPreserveVisibleEntry[] {
  if (sort_state === null) {
    return visible_entries;
  }

  if (sort_state.column_id === "statistics" && !statistics_ready) {
    return visible_entries;
  }

  return [...visible_entries].sort((left_entry, right_entry) => {
    let comparison_result = 0;

    if (sort_state.column_id === "src" || sort_state.column_id === "info") {
      comparison_result = compare_quality_rule_text_value(
        left_entry.entry[sort_state.column_id],
        right_entry.entry[sort_state.column_id],
        sort_state.direction,
      );
    } else if (sort_state.column_id === "statistics") {
      const left_value = statistics_state.matched_count_by_entry_id[left_entry.entry_id] ?? 0;
      const right_value = statistics_state.matched_count_by_entry_id[right_entry.entry_id] ?? 0;
      comparison_result =
        sort_state.direction === "ascending" ? left_value - right_value : right_value - left_value;
    }

    if (comparison_result !== 0) {
      return comparison_result;
    }

    return left_entry.source_index - right_entry.source_index;
  });
}
