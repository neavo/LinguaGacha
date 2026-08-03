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
  matched_count_by_entry_id: Record<string, number>;
  subset_parent_labels_by_entry_id: Record<string, string[]>;
};

/**
 * 复用共享文本匹配器，并让页面仅提供其领域字段到可搜索文本的投影。
 */
export function create_quality_rule_keyword_matcher<Entry>(
  filter_state: QualityRuleFilterState,
  select_text: (entry: Entry) => string,
): {
  invalid_regex_message: string | null;
  matches: (entry: Entry) => boolean;
} {
  const keyword_matcher = create_text_keyword_matcher({
    keyword: filter_state.keyword,
    is_regex: filter_state.is_regex,
    unicode: false,
  });

  return {
    invalid_regex_message: keyword_matcher.invalid_regex_message,
    matches: (entry) => {
      return (
        keyword_matcher.invalid_regex_message === null &&
        keyword_matcher.matches(select_text(entry))
      );
    },
  };
}

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

  if ((statistics_state.matched_count_by_entry_id[entry_id] ?? 0) === 0) {
    return "unmatched";
  }

  return (statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? []).length > 0
    ? "related"
    : "matched";
}
