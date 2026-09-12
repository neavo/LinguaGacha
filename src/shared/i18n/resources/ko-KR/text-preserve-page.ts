import type { zh_cn_text_preserve_page } from "../zh-CN/text-preserve-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_text_preserve_page = {
  title: "텍스트 보호",

  mode: {
    label: "텍스트 보호 모드",

    loading_toast: "교정 캐시 새로 고치는 중 …",
    content_html:
      "번역할 필요가 없는 코드, 제어 문자, 스타일 문자 등을 보호하여 잘못 번역되는 것을 방지합니다" +
      "<br>" +
      "• 끄기 - 보호 규칙을 사용하지 않고 판단과 처리를 AI에 맡깁니다" +
      "<br>" +
      "• 자동 - 텍스트 형식과 게임 엔진을 판단하여 적합한 보호 규칙을 선택합니다" +
      "<br>" +
      "• 사용자 지정 - 이 페이지에서 설정한 <font color='darkgoldenrod'><b>정규식 규칙</b></font>에 일치하는 텍스트를 보호합니다",
    options: {
      off: "끄기",
      smart: "자동",
      custom: "사용자 지정",
    },
  },
  fields: {
    note: "비고(메모용이며 실제 동작에 영향 없음)",
    hit: "일치",
  },
  filter: {
    scope: {
      rule: "규칙",
      note: "비고",
    },
  },

  preset: {
    dialog: {
      name_placeholder: "프리셋 이름 입력 …",
    },
  },
  hit: {
    hit_count: "일치 항목 수: {COUNT}",
  },

  feedback: {
    load_failed: "텍스트 보호 규칙을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    preset_name_required: "프리셋 이름은 비워 둘 수 없습니다",

    unknown_error: "작업에 실패했습니다. 잠시 후 다시 시도해 주세요.",

    mode_refresh_pending:
      "텍스트 보호 모드를 변경했습니다. 교정 캐시가 아직 새로 고쳐지고 있으니 잠시 후 결과를 확인해 주세요.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_text_preserve_page>;
