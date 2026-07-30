import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_text_replacement_page = {
  title: "Text Replacement",
  action: {
    create: "Add",
  },

  fields: {
    replacement: "Replacement",

    statistics: "Hits",
  },
  rule: {
    regex: "Regular Expression",
    case_sensitive: "Case Sensitive",
  },
  filter: {
    scope: {
      tooltip_label: "Search scope",

      replacement: "Replacement",
    },
  },

  statistics: {
    subset_relations: "Subset relations:",

    action: {
      search_relation: "Search relation",
    },
  },

  feedback: {
    save_failed: "Failed to save replacement page.",
    import_failed: "Failed to import replacement rules.",

    export_failed: "Failed to export replacement rules.",

    preset_failed: "Failed to load replacement presets.",

    query_failed: "Failed to query replacement rule.",

    reset_success: "Reset complete …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
