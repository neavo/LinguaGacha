import { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_expert_settings_page = {
  title: "Expert Settings",
  fields: {
    preceding_lines_threshold: {
      title: "Preceding Lines Threshold",
      description:
        "Maximum number of preceding lines to include as context for each translation task, disabled by default",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "Preceding lines threshold must be a number within the valid range …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
