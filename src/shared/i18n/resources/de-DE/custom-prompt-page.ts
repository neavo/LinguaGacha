import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_custom_prompt_page = {
  title: "Eigene Prompts",
  action: {
    import: "Importieren",
    export: "Exportieren",
    save: "Speichern",
    preset: "Voreinstellung",
  },
  toggle: {
    status: "{TITLE} - {STATE}",
  },
  section: {
    prefix_label: "Festes Präfix",
    suffix_label: "Festes Suffix",
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
    load_failed: "Aufgabe fehlgeschlagen …",
    save_failed: "Aufgabe fehlgeschlagen …",
    import_failed: "Aufgabe fehlgeschlagen …",
    import_success: "Daten importiert …",
    export_failed: "Aufgabe fehlgeschlagen …",
    export_success: "Daten exportiert …",
    preset_failed: "Aufgabe fehlgeschlagen …",
    preset_saved: "Voreinstellung gespeichert …",
    preset_renamed: "Aufgabe erfolgreich …",
    preset_deleted: "Aufgabe erfolgreich …",
    preset_name_required: "Name der Voreinstellung ist erforderlich.",
    preset_exists: "Datei existiert bereits …",
    default_preset_set: "Standard-Voreinstellung gesetzt …",
    default_preset_cleared: "Standard-Voreinstellung aufgehoben …",
    reset_success: "Zurückgesetzt …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
