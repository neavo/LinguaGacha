import type { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_task_progress = {
  total_lines: "合計",
  translation_completed: "翻訳成功",
  translation_failed: "翻訳失敗",
  translation_pending: "翻訳待ち",
  translation_skipped: "翻訳不要",

  toggle_tooltip: "クリックして切り替え",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
