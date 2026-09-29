import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_glossary_page = {
  title: "Glossary",
  toggle: {
    tooltip:
      "Build a glossary into prompts to guide translation, keep terminology consistent, and correct character attributes",
  },
  fields: {
    translation: "Translation",
    description: "Description",
  },
  feedback: {
    load_failed: "Failed to load the glossary. Please try again later …",
    query_failed: "Failed to query proofreading",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
