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
