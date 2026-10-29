import { zh_cn_translation_transfer_page } from "../zh-CN/translation-transfer-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_translation_transfer_page = {
  title: "번역문 이전",
  fields: {
    source: { title: "원본 프로젝트" },
    base: { title: "대상 프로젝트" },
    mode: {
      title: "이전 모드",
      fill: "채우기",
      overwrite: "덮어쓰기",
      fill_description: "충돌 시 대상 프로젝트의 번역문을 우선 유지합니다",
      overwrite_description: "충돌 시 원본 프로젝트의 번역문을 우선 사용합니다",
    },
  },
  action: { start: "새 프로젝트 생성" },
  feedback: {
    result: "채움 {FILLED}개 · 교체 {REPLACED}개 · 미일치 {UNMATCHED}개",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_translation_transfer_page>;
