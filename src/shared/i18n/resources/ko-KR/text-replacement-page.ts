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
  feedback: {
    load_failed: "치환 규칙을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요 …",
    query_failed: "치환 페이지 조회 실패",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
