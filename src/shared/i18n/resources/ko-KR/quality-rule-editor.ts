import type { zh_cn_quality_rule_editor } from "../zh-CN/quality-rule-editor";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_quality_rule_editor = {
  confirm: {
    delete_selection: {
      description: "기록 {COUNT}개를 삭제할까요 …?",
    },
    reset: {
      description: "데이터를 초기화할까요 …?",
    },
  },
  feedback: {
    regex_invalid: "정규식이 잘못되었습니다",
    source_required: "원문은 비워 둘 수 없습니다",
    save_failed: "규칙을 저장하지 못했습니다",
    update_failed: "규칙 설정을 저장하지 못했습니다",
    import_failed: "규칙을 가져오지 못했습니다",
    export_failed: "규칙을 내보내지 못했습니다",
  },
  fields: {
    rule: "규칙",
    source: "원문",
    hit: "일치",
  },
  filter: {
    clear: "비우기",
    placeholder: "검색 …",
    regex: "정규식",
    regex_tooltip_label: "정규식 모드",
    scope: {
      all: "전체",
      label: "범위",
      tooltip_label: "검색 범위",
    },
  },
  hit: {
    hit_count: "일치 항목 수: {COUNT}",
    relation_line: "{CHILD} -> {PARENT}",
    subset_relations: "포함 관계:",
    query_source: "출처 조회",
    search_relation: "포함 관계 조회",
  },
  rule: { case_sensitive: "대소문자 구분" },
} satisfies LocaleMessageSchema<typeof zh_cn_quality_rule_editor>;
