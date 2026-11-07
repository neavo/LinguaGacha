import { zh_cn_preset_editor } from "../zh-CN/preset-editor";
import type { LocaleMessageSchema } from "../../types";

export const en_us_preset_editor = {
  action: {
    apply: "Import",
    cancel_default: "Cancel default preset",
    delete: "Delete preset",
    rename: "Rename",
    save: "Save preset",
    set_default: "Set as default preset",
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
    exists: "File already exists",
    name_required: "Preset name is required",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
