import { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_glossary_page = {
  title: "Glossary",
  action: {
    preset: "Presets",
  },
  toggle: {
    tooltip:
      "Build a glossary into prompts to guide translation, keep terminology consistent, and correct character attributes.",
  },
  fields: {
    translation: "Translation",
    description: "Description",

    hit: "Hits",
  },
  hit: {
    action: {
      query_source: "Query source",
      search_relation: "Query subset relations",
    },
  },
  rule: {
    case_sensitive: "Case-sensitive",
  },
  filter: {
    scope: {
      translation: "Translation",
      description: "Notes",
    },
  },

  feedback: {
    load_failed: "Failed to load the glossary. Please try again later.",
    save_failed: "Failed to save the glossary.",
    import_failed: "Failed to import the glossary.",

    export_failed: "Failed to export the glossary.",

    preset_failed: "Failed to load glossary presets.",

    query_failed: "Failed to query proofreading.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
