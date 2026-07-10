import { zh_cn_analysis_prompt_page } from "../zh-CN/analysis-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_analysis_prompt_page = {
  title: "Analyse-Prompts",
  header: {
    title: "Benutzerdefinierte Analyse-Prompts",
    description_html:
      "Passen Sie den Umfang und die Ausgabeanforderungen der Glossar-Analyse durch benutzerdefinierte Prompts an" +
      "<br>" +
      "Hinweis: Präfix und Suffix sind fest und können nicht geändert werden" +
      "<br>" +
      "Der Inhalt dieser Seite wird nur in Analyse-Aufgaben verwendet, nachdem diese Seite aktiviert wurde",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_analysis_prompt_page>;
