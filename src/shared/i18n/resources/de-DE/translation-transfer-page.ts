import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_translation_transfer_page = {
  title: "Übersetzungen übertragen",
  fields: {
    source: { title: "Quellprojekt" },
    base: { title: "Zielprojekt" },
    mode: {
      title: "Übertragungsmodus",
      fill: "Ergänzen",
      overwrite: "Überschreiben",
      fill_description: "Bei Konflikten die Übersetzung im Zielprojekt beibehalten",
      overwrite_description: "Bei Konflikten die Übersetzung aus dem Quellprojekt verwenden",
    },
  },
  action: { start: "Neues Projekt erzeugen" },
  feedback: {
    result: "Ergänzt {FILLED} · Ersetzt {REPLACED} · Nicht zugeordnet {UNMATCHED}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;
