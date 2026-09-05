import {
  is_active_batch_translation_status,
  type BatchTranslationScope,
} from "../../domain/batch-translation";

// 只有完整翻译从活跃态自然完成且确有结果时才提示导出。
export function should_open_translation_export_followup(args: {
  previous_status: string;
  next_status: string;
  has_result: boolean;
  scope: BatchTranslationScope;
}): boolean {
  if (args.scope.kind === "items") {
    return false;
  }

  if (
    args.previous_status === "stopping" ||
    !is_active_batch_translation_status(args.previous_status)
  ) {
    return false;
  }

  if (args.next_status === "done") {
    return true;
  }

  return args.next_status === "idle" && args.has_result;
}
