import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_laboratory_page = {
  title: "Labor",
  fields: {
    mtool_optimizer_enable: {
      title: "MTool-Optimierer",
      description:
        "Für MTool-Text <emphasis>reduziert dies die Übersetzungszeit und Token um bis zu 40%</emphasis>, standardmäßig aktiviert",
      help_label: "MTool-Optimierer-Anleitung anzeigen",
    },
    skip_duplicate_source_text_enable: {
      title: "Doppelten Quelltext überspringen",
      description:
        "In einer Datei identischen Quelltext nur einmal übersetzen, <emphasis>Duplikate verwenden den übersetzten Text wieder</emphasis>, standardmäßig aktiviert",
    },
  },
  feedback: {
    refresh_failed:
      "Laboreinstellungen können derzeit nicht aktualisiert werden. Bitte versuchen Sie es später erneut.",
    update_failed:
      "Fehler beim Speichern der Laboreinstellungen. Bitte versuchen Sie es später erneut.",
    mtool_optimizer_loading_toast: "Projekt-Cache wird aktualisiert …",
    skip_duplicate_source_text_loading_toast: "Projekt-Cache wird aktualisiert …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
