import { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_task_progress = {
  total_lines: "Total",
  translation_completed: "Tradução concluída",
  translation_pending: "Aguardando tradução",
  translation_skipped: "Dispensa tradução",
  line: "{status} - {count} linhas",
  page: "{status} - {count} páginas",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
