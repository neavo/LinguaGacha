import { zh_cn_translation_prompt_page } from "../zh-CN/translation-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_translation_prompt_page = {
  title: "Übersetzungs-Prompts",
  header: {
    title: "Benutzerdefinierte Übersetzungs-Prompts (SakuraLLM-Modell nicht unterstützt)",
    description_html:
      "Fügen Sie zusätzliche Übersetzungsanforderungen wie Handlungseinstellungen und Schreibstile über benutzerdefinierte Prompts hinzu" +
      "<br>" +
      "Hinweis: Präfix und Suffix sind fest und können nicht geändert werden" +
      "<br>" +
      "Der Inhalt dieser Seite wird nur in Übersetzungsaufgaben verwendet, nachdem diese Seite aktiviert wurde",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_prompt_page>;
