export type TranslationResetPlan = {
  updatedSections: Array<"items" | "analysis"> | Array<"items">; // UI 预期刷新 section，实际 revision 以后端 write result 为准
  requestBody: Record<string, unknown>; // translation reset 命令体，不包含前端生成的 items 或 progress
};

type TranslationResetSectionRevisions = Record<string, number | undefined>;

// 失败重置只需要 items 乐观锁，后端按当前 ERROR item 重建最终事实。
export function create_translation_reset_failed_plan(args: {
  section_revisions: TranslationResetSectionRevisions;
  task_snapshot?: Record<string, unknown>;
}): TranslationResetPlan {
  return {
    updatedSections: ["items"],
    requestBody: {
      mode: "failed",
      expected_section_revisions: {
        items: args.section_revisions.items ?? 0,
      },
    },
  };
}

// 全量重置只提交设置镜像和依赖 revision，后端重新解析当前 asset 后写入。
export function create_translation_reset_all_plan(args: {
  section_revisions: TranslationResetSectionRevisions;
  task_snapshot?: Record<string, unknown>;
  source_language: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
}): TranslationResetPlan {
  return {
    updatedSections: ["items", "analysis"],
    requestBody: {
      mode: "all",
      project_settings: {
        source_language: args.source_language,
        mtool_optimizer_enable: args.mtool_optimizer_enable,
        skip_duplicate_source_text_enable: args.skip_duplicate_source_text_enable,
      },
      expected_section_revisions: {
        items: args.section_revisions.items ?? 0,
        analysis: args.section_revisions.analysis ?? 0,
      },
    },
  };
}
