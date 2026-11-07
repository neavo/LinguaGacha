import { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";

export const en_us_task_progress = {
  total_lines: "Total",
  translation_completed: "Translation completed",
  translation_pending: "Awaiting translation",
  translation_skipped: "No translation needed",
  line: "{status} - {count} lines",
  page: "{status} - {count} pages",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
