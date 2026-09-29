import { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";

export const de_de_preset_editor = {
  action: {
    apply: "Importieren",
    cancel_default: "Standard-Voreinstellung aufheben",
    delete: "Voreinstellung löschen",
    rename: "Umbenennen",
    save: "Voreinstellung speichern",
    set_default: "Als Standard-Voreinstellung festlegen",
  },
  confirm: {
    delete: {
      description: "Voreinstellung wirklich löschen …?",
    },
    overwrite: {
      description: "Voreinstellung wirklich überschreiben …?",
    },
  },
  dialog: {
    name_placeholder: "Namen der Voreinstellung eingeben …",
  },
  feedback: {
    exists: "Datei existiert bereits",
    name_required: "Name der Voreinstellung ist erforderlich",
    load_failed: "Voreinstellungen konnten nicht geladen werden",
    save_failed: "Die Voreinstellung konnte nicht gespeichert werden",
    rename_failed: "Die Voreinstellung konnte nicht umbenannt werden",
    delete_failed: "Die Voreinstellung konnte nicht gelöscht werden",
    default_update_failed: "Die Standardvoreinstellung konnte nicht gespeichert werden",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
