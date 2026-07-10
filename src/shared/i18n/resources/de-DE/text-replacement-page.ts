import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_text_replacement_page = {
  title: "Textersetzung",
  action: {
    create: "Hinzufügen",
    edit: "Bearbeiten",
    delete: "Löschen",
    save: "Speichern",
    cancel: "Abbrechen",
    import: "Importieren",
    export: "Exportieren",
    statistics: "Statistik",
    preset: "Voreinstellung",
    query: "Abfrage",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
  },
  fields: {
    drag: "Ziehen",
    source: "Quelle",
    replacement: "Ersetzung",
    rule: "Regel",
    statistics: "Treffer",
  },
  rule: {
    regex: "Regulärer Ausdruck",
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
      replacement: "Ersetzung",
    },
  },
  sort: {
    ascending: "Aufsteigend",
    descending: "Absteigend",
    clear: "Löschen",
  },
  dialog: {
    create_title: "Ersetzungsregel erstellen",
    edit_title: "Ersetzungsregel bearbeiten",
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
  statistics: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    subset_relations: "Teilmengenbeziehungen:",
    relation_line: "{CHILD} -> {PARENT}",
    running: "Wird ausgeführt",
    action: {
      search_relation: "Beziehung suchen",
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
    save_failed: "Fehler beim Speichern der Ersetzungsseite.",
    import_failed: "Fehler beim Importieren der Ersetzungsregeln.",
    import_success: "Daten importiert …",
    export_failed: "Fehler beim Exportieren der Ersetzungsregeln.",
    export_success: "Daten exportiert …",
    preset_failed: "Fehler beim Laden der Ersetzungs-Voreinstellungen.",
    preset_saved: "Voreinstellung gespeichert …",
    preset_renamed: "Voreinstellung umbenannt …",
    preset_deleted: "Voreinstellung gelöscht …",
    preset_name_required: "Name der Voreinstellung ist erforderlich.",
    preset_exists: "Datei existiert bereits …",
    default_preset_set: "Standard-Voreinstellung gesetzt …",
    default_preset_cleared: "Standard-Voreinstellung aufgehoben …",
    query_failed: "Fehler bei der Abfrage der Ersetzungsregel.",
    source_required: "Quelltext ist erforderlich.",
    regex_invalid: "Ungültiger regulärer Ausdruck",
    reset_success: "Zurücksetzen abgeschlossen …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
