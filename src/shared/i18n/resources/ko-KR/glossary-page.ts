import type { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_glossary_page = {
  title: "용어집",
  toggle: {
    tooltip: "프롬프트에 용어집을 포함하여 번역 용어 통일, 인물 속성 교정 등을 유도합니다",
  },
  fields: {
    translation: "번역문",
    description: "설명",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
