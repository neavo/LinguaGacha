import { zh_cn_quality_editor } from "../zh-CN/quality-editor";
import type { LocaleMessageSchema } from "../../types";

export const de_de_quality_editor = {
  action: {
    cancel: "Abbrechen",
    create: "Erstellen",
    delete: "Löschen",
    edit: "Bearbeiten",
    export: "Exportieren",
    import: "Importieren",
    preset: "Voreinstellung",
    query: "Abfrage",
    save: "Speichern",
  },
  confirm: {
    delete_preset: {
      description: "Voreinstellung wirklich löschen …?",
    },
    delete_selection: {
      description: "{COUNT} Einträge wirklich löschen …?",
    },
    overwrite_preset: {
      description: "Voreinstellung wirklich überschreiben …?",
    },
    reset: {
      description: "Daten wirklich zurücksetzen …?",
    },
  },
  feedback: {
    default_preset_cleared: "Standard-Voreinstellung aufgehoben …",
    default_preset_set: "Standard-Voreinstellung gesetzt …",
    export_success: "Daten exportiert …",
    import_success: "Daten importiert …",
    preset_deleted: "Voreinstellung gelöscht …",
    preset_exists: "Datei existiert bereits …",
    preset_name_required: "Name der Voreinstellung ist erforderlich.",
    preset_renamed: "Voreinstellung umbenannt …",
    preset_saved: "Voreinstellung gespeichert …",
    regex_invalid: "Ungültiger regulärer Ausdruck",
    reset_success: "Zurückgesetzt …",
    source_required: "Quelltext ist erforderlich.",
  },
  fields: {
    drag: "Ziehen",
    rule: "Regel",
    source: "Quelle",
  },
  filter: {
    clear: "Löschen",
    placeholder: "Abfrage …",
    regex: "Regex",
    regex_tooltip_label: "Regex-Modus",
    scope: {
      all: "Alle",
      label: "Bereich",
      source: "Quelle",
      tooltip_label: "Suchbereich",
    },
  },
  preset: {
    apply: "Importieren",
    cancel_default: "Standard-Voreinstellung aufheben",
    delete: "Voreinstellung löschen",
    dialog: {
      name_placeholder: "Namen der Voreinstellung eingeben …",
      rename_confirm: "Umbenennen",
      save_confirm: "Speichern",
    },
    rename: "Umbenennen",
    save: "Voreinstellung speichern",
    set_default: "Als Standard-Voreinstellung festlegen",
  },
  sort: {
    ascending: "Aufsteigend",
    clear: "Löschen",
    descending: "Absteigend",
  },
  hit: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "Enthält Teilmengenbeziehungen:",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_editor>;
