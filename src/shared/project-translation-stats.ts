/** 工程条目状态的统计结果，完成率由后端统一计算。 */
export type ProjectTranslationStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};

export type ProjectTranslationStatsResponse = {
  projectPath: string;
  stats: ProjectTranslationStats;
};

/** 成功和跳过均计入完成；仍有未完成对象时取整最高为 99%。 */
export function calculate_completion_percent(
  total: number,
  completed: number,
  skipped: number,
): number {
  if (total === 0) return 0;
  const finished = completed + skipped;
  return finished === total ? 100 : Math.min(99, Math.round((finished / total) * 100));
}

/** 只读取条目状态，供磁盘预览和已加载工程使用同一统计口径。 */
export function build_project_translation_stats(
  items: readonly { status: string }[],
): ProjectTranslationStats {
  let completed_count = 0;
  let failed_count = 0;
  let skipped_count = 0;
  for (const item of items) {
    switch (item.status) {
      case "PROCESSED":
        completed_count += 1;
        break;
      case "ERROR":
        failed_count += 1;
        break;
      case "EXCLUDED":
      case "RULE_SKIPPED":
      case "LANGUAGE_SKIPPED":
      case "DUPLICATED":
        skipped_count += 1;
        break;
    }
  }
  const total_items = items.length;
  return {
    total_items,
    completed_count,
    failed_count,
    skipped_count,
    pending_count: total_items - completed_count - failed_count - skipped_count,
    completion_percent: calculate_completion_percent(total_items, completed_count, skipped_count),
  };
}
