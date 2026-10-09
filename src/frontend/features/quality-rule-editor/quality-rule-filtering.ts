import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import { create_text_keyword_matcher } from "@shared/text/text-pattern";

// 所有质量规则页共用同一自然排序器，避免页面间大小写和数字片段顺序不一致。
const QUALITY_RULE_TEXT_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

type QualityRuleFilterState = {
  keyword: string;
  is_regex: boolean;
};

type QualityRuleStatisticsState = {
  hits_by_entry_id: Record<string, number>;
  subset_parents_by_entry_id: Record<string, string[]>;
};

/**
 * 空白关键词不触发结果快照的查询态。
 */
export function has_active_quality_rule_filters(filter_state: QualityRuleFilterState): boolean {
  return filter_state.keyword.trim() !== "";
}

/**
 * 规则表文本按自然顺序排列，空值无论升降序都固定在末尾。
 */
export function compare_quality_rule_text_value(
  left_value: string,
  right_value: string,
  direction: "ascending" | "descending",
): number {
  const normalized_left_value = left_value.trim();
  const normalized_right_value = right_value.trim();

  if (normalized_left_value === "") {
    return normalized_right_value === "" ? 0 : 1;
  }
  if (normalized_right_value === "") {
    return -1;
  }

  const comparison_result = QUALITY_RULE_TEXT_SORTER.compare(
    normalized_left_value,
    normalized_right_value,
  );
  return direction === "ascending" ? comparison_result : comparison_result * -1;
}

/**
 * 只为已完成统计的条目生成徽章，避免把尚未计算误显示为零命中。
 */
export function resolve_quality_rule_hit_badge_kind(
  entry_id: string,
  statistics_state: QualityRuleStatisticsState,
  completed_statistics_entry_id_set: ReadonlySet<string>,
): "matched" | "unmatched" | "related" | null {
  if (!completed_statistics_entry_id_set.has(entry_id)) {
    return null;
  }

  if ((statistics_state.hits_by_entry_id[entry_id] ?? 0) === 0) {
    return "unmatched";
  }

  return (statistics_state.subset_parents_by_entry_id[entry_id] ?? []).length > 0
    ? "related"
    : "matched";
}

export type QualityRuleVisibleEntry<E> = { entry: E; entry_id: string; source_index: number };

/** 筛选和排序只生成展示副本，稳定身份与源位置始终来自原始条目。 */
export function build_quality_rule_filter_result<
  E extends { entry_id: string },
  Scope extends string,
>(options: {
  entries: E[];
  filter_state: QualityRuleFilterState & { scope: Scope };
  sort_state: AppTableSortState | null;
  hit_sort_available: boolean;
  hit_state: { hits_by_entry_id: Record<string, number> };
  select_text: (entry: E, scope: Scope) => string;
  compare_entries: (left: E, right: E, sort: AppTableSortState) => number;
}): { visible_entries: QualityRuleVisibleEntry<E>[]; invalid_regex_message: string | null } {
  const matcher = create_text_keyword_matcher({ ...options.filter_state, unicode: false });
  if (matcher.invalid_regex_message !== null) {
    return { visible_entries: [], invalid_regex_message: matcher.invalid_regex_message };
  }
  const visible_entries = options.entries.flatMap((entry, source_index) =>
    matcher.matches(options.select_text(entry, options.filter_state.scope))
      ? [{ entry, entry_id: entry.entry_id, source_index }]
      : [],
  );
  const sort = options.sort_state;
  if (sort !== null && (sort.column_id !== "hit" || options.hit_sort_available)) {
    visible_entries.sort((left, right) => {
      const comparison =
        sort.column_id === "hit"
          ? ((options.hit_state.hits_by_entry_id[left.entry_id] ?? 0) -
              (options.hit_state.hits_by_entry_id[right.entry_id] ?? 0)) *
            (sort.direction === "ascending" ? 1 : -1)
          : options.compare_entries(left.entry, right.entry, sort);
      return comparison || left.source_index - right.source_index;
    });
  }
  return { visible_entries, invalid_regex_message: null };
}
