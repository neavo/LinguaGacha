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
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
