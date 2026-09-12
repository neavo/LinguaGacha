import type { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_log_window_page = {
  title: "로그",
  history: {
    date: "로그 날짜",
    loading: "로그 읽는 중…",
    empty: "로그 없음",
    failed: "로그를 읽지 못했습니다",
    expired: "이 날짜의 로그가 삭제되었습니다",
  },
  level: {
    all: "전체",
    debug: "디버그",
    info: "정보",
    warning: "경고",
    error: "오류",
    fatal: "치명적",
  },
  fields: {
    time: "시간",
    message: "메시지",
  },
  action: {
    return_to_top: "맨 위로",
  },
  search: {
    placeholder: "불러온 로그 검색…",
    clear: "비우기",
    regex: "정규식",
    regex_tooltip_label: "정규식 모드",
    regex_invalid: "정규식이 잘못되었습니다.",
    scope: {
      label: "범위",
      tooltip_label: "로그 범위",
    },
  },
  detail: {
    title: "상세 정보",
    previous: "이전 항목",
    next: "다음 항목",
    maximize: "최대화",
    minimize: "최소화",
    empty: "로그를 선택하면 상세 정보를 볼 수 있습니다.",
    loading: "로그 상세 정보 읽는 중 …",
    unavailable:
      "로그 상세 정보가 현재 프로세스 메모리에서 해제되었습니다. 로그 파일을 확인해 주세요.",
    failed: "로그 상세 정보를 읽지 못했습니다.",
    content: {
      source_text: "원문",
      translated_text: "번역문",
      source_term: "원문 용어",
      translated_term: "번역 용어",
      term_info: "비고",
      error: "오류 상세 정보",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
