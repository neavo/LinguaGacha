import { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";

export const en_us_task_progress = {
  total_lines: "Total",
  translation_completed: "Translation Completed",
  translation_failed: "Translation Failed",
  translation_pending: "Awaiting Translation",
  translation_skipped: "No Translation Needed",
  analysis_completed: "Analysis Completed",
  analysis_failed: "Analysis Failed",
  analysis_pending: "Awaiting Analysis",
  analysis_skipped: "No Analysis Needed",
  toggle_tooltip: "Click to switch",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
