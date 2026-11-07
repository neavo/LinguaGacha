import { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_custom_prompt_page = {
  save: {
    discard: "Discard unsaved changes",
    waiting: "Wait for the current task to finish before saving …",
  },
  title: "Custom prompts",
  header: {
    description_html:
      "Add extra translation requirements such as story settings and writing styles via custom prompts",
  },
  section: {
    prefix_label: "Fixed prefix",
    suffix_label: "Fixed suffix",
  },
  confirm: {
    reset: {
      description: "Confirm resetting data …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
