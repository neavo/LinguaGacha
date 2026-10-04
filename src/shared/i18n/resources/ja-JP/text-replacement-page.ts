import type { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";
export const ja_jp_text_replacement_page = {
  title: "テキスト置換",
  fields: {
    replacement: "置換",
  },
  rule: {
    regex: "正規表現",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
