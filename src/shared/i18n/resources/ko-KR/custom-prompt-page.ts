import type { zh_cn_custom_prompt_page } from "../zh-CN/custom-prompt-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_custom_prompt_page = {
  save: {
    discard: "저장하지 않은 변경 사항 되돌리기",
    waiting: "현재 작업이 실행 중입니다. 나중에 저장해 주세요.",
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
      description: "데이터를 초기화할까요?",
    },
  },
  feedback: {
    load_failed: "프롬프트를 불러오지 못했습니다. 다시 시도해 주세요.",
    save_failed: "프롬프트를 저장하지 못했습니다. 편집 내용은 보관되어 있습니다.",
    import_failed: "작업 실행에 실패했습니다 …",
    export_failed: "작업 실행에 실패했습니다 …",
    preset_failed: "작업 실행에 실패했습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_custom_prompt_page>;
