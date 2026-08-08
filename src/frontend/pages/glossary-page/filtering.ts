import type {
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryFilterState,
  GlossarySortDirection,
  GlossarySortField,
  GlossarySortState,
  GlossaryHitState,
  GlossaryVisibleEntry,
} from "@frontend/pages/glossary-page/types";
import {
  compare_quality_rule_text_value,
  create_quality_rule_keyword_matcher,
} from "@frontend/features/quality-rule-editor/quality-rule-filtering";

type BuildGlossaryFilterResultOptions = {
  entries: GlossaryEntry[];
  entry_ids: GlossaryEntryId[];
  filter_state: GlossaryFilterState;
  sort_state: GlossarySortState;
  hit_sort_available: boolean;
  hit_state: GlossaryHitState;
};

type BuildGlossaryFilterResult = {
  visible_entries: GlossaryVisibleEntry[];
  invalid_regex_message: string | null;
};

function build_keyword_matcher(filter_state: GlossaryFilterState): {
  invalid_regex_message: string | null;
  matches: (entry: GlossaryEntry) => boolean;
} {
  return create_quality_rule_keyword_matcher(filter_state, (entry: GlossaryEntry) => {
    return filter_state.scope === "src"
      ? entry.src
      : filter_state.scope === "dst"
        ? entry.dst
        : filter_state.scope === "info"
          ? entry.info
          : [entry.src, entry.dst, entry.info].join("\n");
  });
}

function resolve_glossary_sort_comparison(
  left_entry: GlossaryVisibleEntry,
  right_entry: GlossaryVisibleEntry,
  field: GlossarySortField,
  direction: GlossarySortDirection,
  hit_state: GlossaryHitState,
): number {
  if (field === "src" || field === "dst" || field === "info") {
    return compare_quality_rule_text_value(
      left_entry.entry[field],
      right_entry.entry[field],
      direction,
    );
  }

  if (field === "rule") {
    const left_value = left_entry.entry.case_sensitive ? 1 : 0;
    const right_value = right_entry.entry.case_sensitive ? 1 : 0;
    return direction === "ascending" ? left_value - right_value : right_value - left_value;
  }

  const left_value = hit_state.hits_by_entry_id[left_entry.entry_id] ?? 0;
  const right_value = hit_state.hits_by_entry_id[right_entry.entry_id] ?? 0;
  return direction === "ascending" ? left_value - right_value : right_value - left_value;
}

function apply_glossary_sort(
  visible_entries: GlossaryVisibleEntry[],
  sort_state: GlossarySortState,
  hit_sort_available: boolean,
  hit_state: GlossaryHitState,
): GlossaryVisibleEntry[] {
  if (sort_state.field === null || sort_state.direction === null) {
    return visible_entries;
  }

  if (sort_state.field === "hit" && !hit_sort_available) {
    return visible_entries;
  }

  // 逻辑排序只改变当前可见结果的展示顺序，真实数据顺序始终由 source_index 保底
  return [...visible_entries].sort((left_entry, right_entry) => {
    const comparison_result = resolve_glossary_sort_comparison(
      left_entry,
      right_entry,
      sort_state.field,
      sort_state.direction,
      hit_state,
    );

    if (comparison_result !== 0) {
      return comparison_result;
    }

    return left_entry.source_index - right_entry.source_index;
  });
}

/**
 * 将术语条目与同索引 ID 组合为只读展示结果；无对应 ID 的脏快照不会进入表格。
 */
export function build_glossary_filter_result(
  options: BuildGlossaryFilterResultOptions,
): BuildGlossaryFilterResult {
  const keyword_matcher = build_keyword_matcher(options.filter_state);
  if (keyword_matcher.invalid_regex_message !== null) {
    return {
      visible_entries: [],
      invalid_regex_message: keyword_matcher.invalid_regex_message,
    };
  }

  const visible_entries = options.entries.flatMap((entry, source_index) => {
    const entry_id = options.entry_ids[source_index];
    if (entry_id === undefined) {
      return [];
    }

    return keyword_matcher.matches(entry) ? [{ entry, entry_id, source_index }] : [];
  });

  const sorted_visible_entries = apply_glossary_sort(
    visible_entries,
    options.sort_state,
    options.hit_sort_available,
    options.hit_state,
  );

  return {
    visible_entries: sorted_visible_entries,
    invalid_regex_message: null,
  };
}
