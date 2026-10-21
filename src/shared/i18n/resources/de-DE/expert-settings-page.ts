import { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_expert_settings_page = {
  title: "Erweitert",
  fields: {
    preceding_lines_threshold: {
      title: "Schwellenwert für vorhergehende Zeilen",
      description:
        "Maximale Zahl vorheriger Kontextzeilen pro Übersetzungsaufgabe. Standardmäßig deaktiviert.",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "Der Schwellenwert für vorhergehende Zeilen muss eine Zahl innerhalb des gültigen Bereichs sein …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
