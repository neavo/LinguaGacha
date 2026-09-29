import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_custom_prompt_page = {
  save: {
    discard: "Ungespeicherte Änderungen verwerfen",
    waiting: "Bitte vor dem Speichern warten, bis die aktuelle Aufgabe abgeschlossen ist …",
  },
  title: "Eigene Prompts",
  header: {
    description_html:
      "Fügen Sie zusätzliche Übersetzungsanforderungen wie Handlungseinstellungen und Schreibstile über benutzerdefinierte Prompts hinzu",
  },
  section: {
    prefix_label: "Festes Präfix",
    suffix_label: "Festes Suffix",
  },
  confirm: {
    reset: {
      description: "Daten wirklich zurücksetzen …?",
    },
  },
  feedback: {
    load_failed: "Die Anweisung konnte nicht geladen werden. Bitte erneut versuchen …",
    save_failed:
      "Die Anweisung konnte nicht gespeichert werden. Ihre Änderungen bleiben erhalten …",
    import_failed: "Der Prompt konnte nicht importiert werden",
    export_failed: "Der Prompt konnte nicht exportiert werden",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
