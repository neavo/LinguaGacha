import { zh_cn_translation_prompt_page } from "../zh-CN/translation-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_translation_prompt_page = {
  title: "Translation Prompts",
  header: {
    title: "Custom Translation Prompts",
    description_html:
      "Add extra translation requirements such as story settings and writing styles via custom prompts",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_prompt_page>;
