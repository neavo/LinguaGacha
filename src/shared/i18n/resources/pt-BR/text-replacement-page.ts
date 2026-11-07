import { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_text_replacement_page = {
  fields: {
    replacement: "Substituição",
  },
  rule: {
    regex: "Expressão Regular",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
