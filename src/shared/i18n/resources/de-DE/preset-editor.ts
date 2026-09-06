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
    exists: "Datei existiert bereits …",
    name_required: "Name der Voreinstellung ist erforderlich.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
