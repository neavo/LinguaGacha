import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_laboratory_page = {
  title: "Labor",
  fields: {
    prompt_enhancement_enable: {
      title: "Prompt-Verbesserung",
      description:
        "Verbessert die Befolgung von Anweisungen durch die KI, indem eine Gedankenkette simuliert wird" +
        "\n" +
        "Deaktivieren senkt den Token-Verbrauch leicht, aber die KI-Intelligenz deutlich, standardmäßig aktiviert",
    },
    mtool_optimizer_enable: {
      title: "MTool-Optimierer",
      description:
        "Für MTool-Text <emphasis>reduziert dies die Übersetzungszeit und Token um bis zu 40%</emphasis>, standardmäßig aktiviert",
    },
    skip_duplicate_source_text_enable: {
      title: "Doppelten Quelltext überspringen",
      description:
        "Einträge mit identischem Text im gesamten Projekt teilen <emphasis>eine Übersetzung</emphasis>, standardmäßig aktiviert",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
