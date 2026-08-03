import type {
  TextReplacementEntry,
  TextReplacementEntryId,
  TextReplacementFilterState,
  TextReplacementHitState,
  TextReplacementVisibleEntry,
} from "@frontend/pages/text-replacement-page/types";
import {
  compare_quality_rule_text_value,
  create_quality_rule_keyword_matcher,
} from "@frontend/features/quality-rule-editor/quality-rule-filtering";

type BuildTextReplacementFilterResultOptions = {
  entries: TextReplacementEntry[];
  entry_ids: TextReplacementEntryId[];
  filter_state: TextReplacementFilterState;
};

type BuildTextReplacementFilterResult = {
  visible_entries: TextReplacementVisibleEntry[];
  invalid_regex_message: string | null;
};

function build_keyword_matcher(filter_state: TextReplacementFilterState): {
  invalid_regex_message: string | null;
  matches: (entry: TextReplacementEntry) => boolean;
} {
  return create_quality_rule_keyword_matcher(filter_state, (entry: TextReplacementEntry) => {
    return filter_state.scope === "src"
      ? entry.src
      : filter_state.scope === "dst"
        ? entry.dst
        : [entry.src, entry.dst].join("\n");
  });
}

/**
 * 将替换条目与同索引 ID 组合为只读展示结果；无对应 ID 的脏快照不会进入表格。
 */
export function build_text_replacement_filter_result(
  options: BuildTextReplacementFilterResultOptions,
): BuildTextReplacementFilterResult {
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
export function sort_text_replacement_entries(
  visible_entries: TextReplacementVisibleEntry[],
  sort_state: import("@frontend/widgets/app-table/app-table-types").AppTableSortState | null,
  hit_ready: boolean,
  hit_state: TextReplacementHitState,
): TextReplacementVisibleEntry[] {
  if (sort_state === null) {
    return visible_entries;
  }

  if (sort_state.column_id === "hit" && !hit_ready) {
    return visible_entries;
  }

  return [...visible_entries].sort((left_entry, right_entry) => {
    let comparison_result = 0;

    if (sort_state.column_id === "src" || sort_state.column_id === "dst") {
      comparison_result = compare_quality_rule_text_value(
        left_entry.entry[sort_state.column_id],
        right_entry.entry[sort_state.column_id],
        sort_state.direction,
      );
    } else if (sort_state.column_id === "rule") {
      const left_value =
        Number(left_entry.entry.regex) * 2 + Number(left_entry.entry.case_sensitive);
      const right_value =
        Number(right_entry.entry.regex) * 2 + Number(right_entry.entry.case_sensitive);
      comparison_result =
        sort_state.direction === "ascending" ? left_value - right_value : right_value - left_value;
    } else if (sort_state.column_id === "hit") {
      const left_value = hit_state.matched_count_by_entry_id[left_entry.entry_id] ?? 0;
      const right_value = hit_state.matched_count_by_entry_id[right_entry.entry_id] ?? 0;
      comparison_result =
        sort_state.direction === "ascending" ? left_value - right_value : right_value - left_value;
    }

    if (comparison_result !== 0) {
      return comparison_result;
    }

    return left_entry.source_index - right_entry.source_index;
  });
}
