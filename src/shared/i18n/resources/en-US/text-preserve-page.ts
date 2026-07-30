import { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_text_preserve_page = {
  title: "Text Preserve",

  mode: {
    label: "Text Preserve Mode",

    loading_toast: "Refreshing proofreading cache …",
    content_html:
      "Preserve text segments like code snippets, control characters, and style characters that shouldn't be translated, preventing incorrect translation" +
      "<br>" +
      "• Off - Does not use any protection rules, leaving judgment and processing entirely to the AI" +
      "<br>" +
      "• Smart - Automatically determines the text format and game engine to select appropriate protection rules" +
      "<br>" +
      "• Custom - Protects corresponding text matched based on the <font color='darkgoldenrod'><b>Regex Rules</b></font> configured on this page",
    options: {
      off: "Off",
      smart: "Smart",
      custom: "Custom",
    },
  },
  fields: {
    note: "Remarks (For reference only, no actual effect)",
    statistics: "Status",
  },
  filter: {
    scope: {
      rule: "Rule",
      note: "Remarks",
    },
  },

  preset: {
    dialog: {
      name_placeholder: "Please enter preset name …",
    },
  },
  statistics: {
    hit_count: "Matched Item Count: {COUNT}",

    action: {
      search_relation: "Search Contains Relation",
    },
  },

  feedback: {
    preset_name_required: "Preset name cannot be empty",

    default_preset_cleared: "Default preset cleared …",
    unknown_error: "The operation failed. Please try again later.",

    reset_success: "Reset completed …",
    mode_refresh_pending:
      "The text preserve mode was updated, and the proofreading cache is still refreshing. Please check again shortly.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;
