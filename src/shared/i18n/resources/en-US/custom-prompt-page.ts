import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_custom_prompt_page = {
  title: "Custom Prompts",

  section: {
    prefix_label: "Fixed Prefix",
    suffix_label: "Fixed Suffix",
  },

  confirm: {
    enable_after_import: {
      description: "Enable custom prompts …?",
    },
  },
  feedback: {
    load_failed: "Task failed …",
    save_failed: "Task failed …",
    import_failed: "Task failed …",

    export_failed: "Task failed …",

    preset_failed: "Task failed …",

    preset_renamed: "Task succeeded …",
    preset_deleted: "Task succeeded …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
