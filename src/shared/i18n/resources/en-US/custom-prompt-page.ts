import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_custom_prompt_page = {
  save: {
    saved: "Saved",
    pending: "Unsaved",
    saving: "Saving",
    error: "Save failed",
    discard: "Discard unsaved changes",
    waiting: "Wait for the current task to finish before saving.",
  },
  title: "Custom Prompts",

  section: {
    prefix_label: "Fixed Prefix",
    suffix_label: "Fixed Suffix",
  },

  confirm: {
    reset: {
      description: "Confirm resetting data …?",
    },
  },
  feedback: {
    load_failed: "Could not load the prompt. Please try again.",
    save_failed: "Could not save the prompt. Your edits have been kept.",
    import_failed: "Task failed …",
    export_failed: "Task failed …",
    preset_failed: "Task failed …",
    preset_succeeded: "Task succeeded …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
