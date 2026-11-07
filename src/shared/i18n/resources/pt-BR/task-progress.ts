import { zh_cn_task_progress } from "../zh-CN/task-progress";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_task_progress = {
  total_lines: "Total",
  translation_completed: "Tradução Concluída",
  translation_pending: "Aguardando Tradução",
  translation_skipped: "Tradução Não Necessária",
  line: "{status} - {count} linhas",
  page: "{status} - {count} páginas",
} satisfies LocaleMessageSchema<typeof zh_cn_task_progress>;
