import type { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_custom_prompt_page = {
  save: {
    discard: "저장하지 않은 변경 사항 되돌리기",
    waiting: "현재 작업이 실행 중입니다. 나중에 저장해 주세요 …",
  },
  title: "사용자 지정 프롬프트",
  header: {
    description_html:
      "사용자 지정 프롬프트로 이야기 설정, 문체 등 추가 번역 요구 사항을 지정합니다",
  },
  section: {
    prefix_label: "고정 머리말",
    suffix_label: "고정 꼬리말",
  },
  confirm: {
    reset: {
      description: "데이터를 초기화할까요 …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
