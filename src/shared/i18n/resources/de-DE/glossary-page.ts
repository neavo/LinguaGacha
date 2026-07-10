import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_glossary_page = {
  title: "Glossar",
  action: {
    create: "Erstellen",
    import: "Importieren",
    export: "Exportieren",
    statistics: "Statistik",
    preset: "Voreinstellungen",
    edit: "Bearbeiten",
    delete: "Löschen",
    save: "Speichern",
    cancel: "Abbrechen",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
    tooltip:
      "Ein Glossar in Prompts einbauen, um die Übersetzung zu leiten, die Terminologie konsistent zu halten und Charaktereigenschaften zu korrigieren.",
  },
  fields: {
    drag: "Ziehen",
    source: "Quelle",
    translation: "Übersetzung",
    description: "Beschreibung",
    rule: "Regel",
    statistics: "Treffer",
  },
  statistics: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    subset_relations: "Enthält Teilmengenbeziehungen:",
    action: {
      query_source: "Quelle abfragen",
      search_relation: "Teilmengenbeziehungen abfragen",
    },
  },
  rule: {
    case_sensitive: "Groß-/Kleinschreibung beachten",
  },
  filter: {
    placeholder: "Abfrage …",
    clear: "Löschen",
    regex: "Regex",
    regex_tooltip_label: "Regex-Modus",
    scope: {
      label: "Bereich",
      tooltip_label: "Suchbereich",
      all: "Alle",
      source: "Quelle",
      translation: "Übersetzung",
      description: "Notizen",
    },
  },
  sort: {
    ascending: "Aufsteigend",
    descending: "Absteigend",
    clear: "Löschen",
  },
  dialog: {
    create_title: "Glossareintrag erstellen",
    edit_title: "Glossareintrag bearbeiten",
  },
  preset: {
    save: "Voreinstellung speichern",
    apply: "Importieren",
    rename: "Umbenennen",
    delete: "Voreinstellung löschen",
    set_default: "Als Standard-Voreinstellung festlegen",
    cancel_default: "Standard-Voreinstellung aufheben",
    dialog: {
      save_title: "Als Voreinstellung speichern",
      save_confirm: "Speichern",
      rename_title: "Voreinstellung umbenennen",
      rename_confirm: "Umbenennen",
      name_placeholder: "Namen der Voreinstellung eingeben …",
    },
  },
  confirm: {
    delete_selection: {
      description: "{COUNT} Einträge wirklich löschen …?",
    },
    delete_preset: {
      description: "Voreinstellung wirklich löschen …?",
    },
    reset: {
      description: "Daten wirklich zurücksetzen …?",
    },
    overwrite_preset: {
      description: "Voreinstellung wirklich überschreiben …?",
    },
  },
  feedback: {
    save_failed: "Fehler beim Speichern des Glossars.",
    import_failed: "Fehler beim Importieren des Glossars.",
    import_success: "Daten importiert …",
    export_failed: "Fehler beim Exportieren des Glossars.",
    export_success: "Daten exportiert …",
    preset_failed: "Fehler beim Laden der Glossar-Voreinstellungen.",
    preset_saved: "Voreinstellung gespeichert …",
    preset_renamed: "Voreinstellung umbenannt …",
    preset_deleted: "Voreinstellung gelöscht …",
    preset_name_required: "Name der Voreinstellung ist erforderlich.",
    preset_exists: "Datei existiert bereits …",
    default_preset_set: "Standard-Voreinstellung gesetzt …",
    default_preset_cleared: "Standard-Voreinstellung aufgehoben …",
    query_failed: "Fehler bei der Korrekturabfrage.",
    source_required: "Quelltext ist erforderlich.",
    reset_success: "Zurückgesetzt …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
