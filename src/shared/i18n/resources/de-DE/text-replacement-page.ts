import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_text_replacement_page = {
  title: "Textersetzung",
  action: {
    create: "Hinzufügen",
  },

  fields: {
    replacement: "Ersetzung",

    statistics: "Treffer",
  },
  rule: {
    regex: "Regulärer Ausdruck",
    case_sensitive: "Groß-/Kleinschreibung beachten",
  },
  filter: {
    scope: {
      tooltip_label: "Suchbereich",

      replacement: "Ersetzung",
    },
  },

  dialog: {
    create_title: "Ersetzungsregel erstellen",
    edit_title: "Ersetzungsregel bearbeiten",
  },

  statistics: {
    subset_relations: "Teilmengenbeziehungen:",

    running: "Wird ausgeführt",
    action: {
      search_relation: "Beziehung suchen",
    },
  },

  feedback: {
    save_failed: "Fehler beim Speichern der Ersetzungsseite.",
    import_failed: "Fehler beim Importieren der Ersetzungsregeln.",

    export_failed: "Fehler beim Exportieren der Ersetzungsregeln.",

    preset_failed: "Fehler beim Laden der Ersetzungs-Voreinstellungen.",

    query_failed: "Fehler bei der Abfrage der Ersetzungsregel.",

    reset_success: "Zurücksetzen abgeschlossen …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
