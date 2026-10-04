import { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_text_preserve_page = {
  title: "Textschutz",
  mode: {
    label: "Textschutz-Modus",
    loading_toast: "Korrektur-Cache wird aktualisiert …",
    content_html:
      "Schützt Textsegmente wie Code-Snippets, Steuerzeichen und Stilzeichen, die nicht übersetzt werden sollen, um falsche Übersetzungen zu verhindern" +
      "<br>" +
      "• Aus - Verwendet keine Schutzregeln und überlässt die Beurteilung und Verarbeitung vollständig der KI" +
      "<br>" +
      "• Smart - Bestimmt automatisch das Textformat und die Spiel-Engine, um geeignete Schutzregeln auszuwählen" +
      "<br>" +
      "• Benutzerdefiniert - Schützt entsprechenden Text basierend auf den auf dieser Seite konfigurierten <font color='darkgoldenrod'><b>Regex-Regeln</b></font>",
    options: {
      off: "Aus",
      smart: "Smart",
      custom: "Benutzerdefiniert",
    },
  },
  fields: {
    note: "Anmerkungen (nur zur Referenz, ohne Wirkung)",
  },
  filter: {
    scope: {
      rule: "Regel",
      note: "Bemerkungen",
    },
  },
  feedback: {
    unknown_error: "Der Vorgang ist fehlgeschlagen. Bitte versuchen Sie es später erneut …",
    mode_refresh_pending:
      "Der Textschutz-Modus wurde aktualisiert und der Korrektur-Cache wird noch aktualisiert. Bitte überprüfen Sie es in Kürze erneut …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;
