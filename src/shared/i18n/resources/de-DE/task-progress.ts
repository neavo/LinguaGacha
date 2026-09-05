import { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";

export const de_de_task_progress = {
  total_lines: "Gesamt",
  translation_completed: "Übersetzung abgeschlossen",
  translation_failed: "Übersetzung fehlgeschlagen",
  translation_pending: "Übersetzung ausstehend",
  translation_skipped: "Keine Übersetzung nötig",

  toggle_tooltip: "Zum Umschalten klicken",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
