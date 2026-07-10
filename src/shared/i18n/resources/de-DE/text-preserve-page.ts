import { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_text_preserve_page = {
  title: "Textschutz",
  action: {
    create: "Erstellen",
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
  mode: {
    label: "Textschutz-Modus",
    status: "{TITLE} - {STATE}",
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
    drag: "Ziehen",
    rule: "Regel",
    note: "Bemerkungen (Nur zur Referenz, keine tatsächliche Wirkung)",
    statistics: "Status",
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
      rule: "Regel",
      note: "Bemerkungen",
    },
  },
  sort: {
    ascending: "Aufsteigend",
    descending: "Absteigend",
    clear: "Löschen",
  },
  dialog: {
    create_title: "Textschutz-Regel erstellen",
    edit_title: "Textschutz-Regel bearbeiten",
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
      name_placeholder: "Bitte Namen der Voreinstellung eingeben …",
    },
  },
  statistics: {
    hit_count: "Anzahl übereinstimmender Einträge: {COUNT}",
    subset_relations: "Enthält Teilmengenbeziehungen:",
    relation_line: "{CHILD} -> {PARENT}",
    running: "Wird berechnet",
    action: {
      search_relation: "Enthalten-Beziehung suchen",
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
    import_success: "Daten importiert …",
    export_success: "Daten exportiert …",
    preset_saved: "Voreinstellung gespeichert …",
    preset_renamed: "Voreinstellung umbenannt …",
    preset_deleted: "Voreinstellung gelöscht …",
    preset_name_required: "Name der Voreinstellung darf nicht leer sein",
    preset_exists: "Datei existiert bereits …",
    default_preset_set: "Standard-Voreinstellung gesetzt …",
    default_preset_cleared: "Standard-Voreinstellung gelöscht …",
    unknown_error: "Der Vorgang ist fehlgeschlagen. Bitte versuchen Sie es später erneut.",
    regex_invalid: "Ungültiger regulärer Ausdruck",
    reset_success: "Zurücksetzen abgeschlossen …",
    mode_refresh_pending:
      "Der Textschutz-Modus wurde aktualisiert und der Korrektur-Cache wird noch aktualisiert. Bitte überprüfen Sie es in Kürze erneut.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;
