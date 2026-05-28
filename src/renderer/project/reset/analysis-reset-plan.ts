export type AnalysisResetPlan = {
  updatedSections: Array<"analysis">; // UI 预期刷新 section，实际 revision 以后端事件为准
  requestBody: Record<string, unknown>; // analysis reset 命令体，不包含前端生成的 analysis_extras
};

type AnalysisResetSectionRevisions = Record<string, number | undefined>;

// 全量分析重置只提交 mode 和 analysis revision，后端清空 checkpoint 与候选事实。
export function create_analysis_reset_all_plan(args: {
  section_revisions: AnalysisResetSectionRevisions;
  task_snapshot?: Record<string, unknown>;
}): AnalysisResetPlan {
  return {
    updatedSections: ["analysis"],
    requestBody: {
      mode: "all",
      expected_section_revisions: {
        analysis: args.section_revisions.analysis ?? 0,
      },
    },
  };
}

// 失败分析重置只提交 mode 和 analysis revision，后端按 ERROR checkpoint 重建进度。
export function create_analysis_reset_failed_plan(args: {
  section_revisions: AnalysisResetSectionRevisions;
  task_snapshot?: Record<string, unknown>;
}): AnalysisResetPlan {
  return {
    updatedSections: ["analysis"],
    requestBody: {
      mode: "failed",
      expected_section_revisions: {
        analysis: args.section_revisions.analysis ?? 0,
      },
    },
  };
}
