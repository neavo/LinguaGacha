import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_glossary_page = {
  title: "Glossar",
  action: {
    preset: "Voreinstellungen",
  },
  toggle: {
    tooltip:
      "Ein Glossar in Prompts einbauen, um die Übersetzung zu leiten, die Terminologie konsistent zu halten und Charaktereigenschaften zu korrigieren.",
  },
  fields: {
    translation: "Übersetzung",
    description: "Beschreibung",

    statistics: "Treffer",
  },
  statistics: {
    action: {
      query_source: "Quelle abfragen",
      search_relation: "Teilmengenbeziehungen abfragen",
    },
  },
  rule: {
    case_sensitive: "Groß-/Kleinschreibung beachten",
  },
  filter: {
    scope: {
      translation: "Übersetzung",
      description: "Notizen",
    },
  },

  feedback: {
    load_failed: "Glossar konnte nicht geladen werden. Bitte später erneut versuchen.",
    save_failed: "Fehler beim Speichern des Glossars.",
    import_failed: "Fehler beim Importieren des Glossars.",

    export_failed: "Fehler beim Exportieren des Glossars.",

    preset_failed: "Fehler beim Laden der Glossar-Voreinstellungen.",

    query_failed: "Fehler bei der Korrekturabfrage.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
