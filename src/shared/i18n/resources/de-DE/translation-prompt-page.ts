import { zh_cn_translation_prompt_page } from "../zh-CN/translation-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_translation_prompt_page = {
  title: "Übersetzungs-Prompts",
  header: {
    title: "Benutzerdefinierte Übersetzungs-Prompts",
    description_html:
      "Fügen Sie zusätzliche Übersetzungsanforderungen wie Handlungseinstellungen und Schreibstile über benutzerdefinierte Prompts hinzu",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_prompt_page>;
