import type { zh_cn_text_replacement_page } from "../zh-CN/text-replacement-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_text_replacement_page = {
  title: "텍스트 치환",
  fields: {
    replacement: "치환",

    hit: "일치",
  },
  rule: {
    regex: "정규 표현식",
    case_sensitive: "대소문자 구분",
  },
  filter: {
    scope: {
      tooltip_label: "검색 범위",
    },
  },

  hit: {
    subset_relations: "포함 관계:",

    action: {
      search_relation: "포함 관계 조회",
    },
  },

  feedback: {
    load_failed: "치환 규칙을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    save_failed: "치환 페이지 저장 실패",
    import_failed: "치환 페이지 가져오기 실패",

    export_failed: "치환 페이지 내보내기 실패",

    preset_failed: "치환 페이지 프리셋 불러오기 실패",

    query_failed: "치환 페이지 조회 실패",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_replacement_page>;
