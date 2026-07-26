import {
  is_active_analysis_task_status,
  is_active_translation_task_status,
  type TranslationScope,
} from "../../domain/task";

// 只有完整翻译从活跃态自然完成且确有结果时才提示导出。
export function should_open_translation_export_followup(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  scope: TranslationScope;
}): boolean {
  if (args.scope.kind === "items") {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_translation_task_status(args.previous_status)
  ) {
    return false;
  }

  if (args.next_status === "done") {
    return true;
  }

  return args.next_status === "idle" && args.has_result;
}

// 只有分析从活跃态自然完成且产生候选时才提示导入术语。
export function should_open_analysis_glossary_import_followup(args: {
  previous_status: string;
  next_status: string;
  candidate_count: number;
}): boolean {
  if (args.candidate_count <= 0) {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_analysis_task_status(args.previous_status)
  ) {
    return false;
  }

  return args.next_status === "done" || args.next_status === "idle";
}
