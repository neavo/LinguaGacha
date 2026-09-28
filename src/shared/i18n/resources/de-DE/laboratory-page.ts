import { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_laboratory_page = {
  title: "Labor",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "Adaptives Denkniveau",
      description:
        "Bei Übersetzungsaufgaben verbraucht tiefes Nachdenken <emphasis>3- bis 5-mal so viele Tokens</emphasis>" +
        "\n" +
        "Passt das Denkniveau bei Übersetzungsaufgaben intelligent an" +
        "\n" +
        "Um die Token-Effizienz zu steigern sowie Zeit und Kosten zu sparen, standardmäßig aktiviert",
    },
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
        "Einträge mit gleichem Quelltext in derselben Datei teilen <emphasis>eine Übersetzung</emphasis>, standardmäßig aktiviert",
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
