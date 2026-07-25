import { zh_cn_analysis_prompt_page } from "../zh-CN/analysis-prompt-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_analysis_prompt_page = {
  title: "Analysis Prompts",
  header: {
    title: "Custom Analysis Prompts",
    description_html:
      "Adjust glossary analysis scope and output requirements through custom prompts",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_analysis_prompt_page>;
