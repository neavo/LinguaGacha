import type { zh_cn_glossary_page } from "../zh-CN/glossary-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_glossary_page = {
  title: "용어집",
  action: {
    preset: "프리셋",
  },
  toggle: {
    tooltip: "프롬프트에 용어집을 포함하여 번역 용어 통일, 인물 속성 교정 등을 유도합니다",
  },
  fields: {
    translation: "번역문",
    description: "설명",

    hit: "일치",
  },
  hit: {
    action: {
      query_source: "출처 조회",
      search_relation: "포함 관계 조회",
    },
  },
  rule: {
    case_sensitive: "대소문자 구분",
  },
  filter: {
    scope: {
      description: "비고",
    },
  },

  feedback: {
    load_failed: "용어집을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    save_failed: "용어집을 저장하지 못했습니다",
    import_failed: "용어집을 가져오지 못했습니다",

    export_failed: "용어집을 내보내지 못했습니다",

    preset_failed: "용어집 프리셋을 불러오지 못했습니다",

    query_failed: "용어집을 조회하지 못했습니다",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_glossary_page>;
