import { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";

export const en_us_preset_editor = {
  action: {
    apply: "Import",
    cancel_default: "Cancel Default Preset",
    delete: "Delete Preset",
    rename: "Rename",
    save: "Save Preset",
    set_default: "Set as Default Preset",
  },
  confirm: {
    delete: {
      description: "Confirm deleting preset …?",
    },
    overwrite: {
      description: "Confirm overwriting preset …?",
    },
  },
  dialog: {
    name_placeholder: "Enter a preset name …",
  },
  feedback: {
    default_cleared: "Default preset cancelled …",
    default_set: "Default preset set …",
    deleted: "Preset deleted …",
    exists: "File already exists …",
    name_required: "Preset name is required.",
    renamed: "Preset renamed …",
    saved: "Preset saved …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
