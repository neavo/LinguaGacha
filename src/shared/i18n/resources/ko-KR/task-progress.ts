import type { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_task_progress = {
  total_lines: "합계",
  translation_completed: "번역 성공",
  translation_failed: "번역 실패",
  translation_pending: "번역 대기",
  translation_skipped: "번역 불필요",

  toggle_tooltip: "클릭하여 전환",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
