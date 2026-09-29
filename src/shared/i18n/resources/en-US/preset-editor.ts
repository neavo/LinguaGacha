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
    exists: "File already exists",
    name_required: "Preset name is required",
    load_failed: "Failed to load presets",
    save_failed: "Failed to save the preset",
    rename_failed: "Failed to rename the preset",
    delete_failed: "Failed to delete the preset",
    default_update_failed: "Failed to save the default preset setting",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_preset_editor>;
