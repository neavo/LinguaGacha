import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_text_replacement_page = {
  title: "Text Replacement",
  fields: {
    replacement: "Replacement",
  },
  rule: {
    regex: "Regular Expression",
  },
  feedback: {
    load_failed: "Failed to load replacement rules. Please try again later …",
    query_failed: "Failed to query replacement rule",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
