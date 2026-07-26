import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_custom_prompt_page = {
  title: "Eigene Prompts",

  section: {
    prefix_label: "Festes Präfix",
    suffix_label: "Festes Suffix",
  },

  confirm: {
    enable_after_import: {
      description: "Eigene Prompts aktivieren …?",
    },
  },
  feedback: {
    load_failed: "Aufgabe fehlgeschlagen …",
    save_failed: "Aufgabe fehlgeschlagen …",
    import_failed: "Aufgabe fehlgeschlagen …",

    export_failed: "Aufgabe fehlgeschlagen …",

    preset_failed: "Aufgabe fehlgeschlagen …",

    preset_renamed: "Aufgabe erfolgreich …",
    preset_deleted: "Aufgabe erfolgreich …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
