import type { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_text_replacement_page = {
  title: "텍스트 치환",
  fields: {
    replacement: "치환",
  },
  rule: {
    regex: "정규 표현식",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
