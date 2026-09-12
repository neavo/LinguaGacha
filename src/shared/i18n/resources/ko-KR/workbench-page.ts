import type { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_workbench_page = {
  title: "작업대",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "파일 이름",
    line_count: "줄 수",
    actions: "작업",
  },
  sort: {
    ascending: "오름차순 정렬",
    descending: "내림차순 정렬",
    clear: "정렬 해제",
  },
  feedback: {
    refresh_failed: "작업대를 새로 고치지 못했습니다",
    add_file_loading_toast: "파일 추가 및 캐시 새로 고치는 중 …",
    no_valid_file: "추가할 수 있는 유효한 파일이 없습니다.",
    file_action_failed: "파일 작업에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    generate_translation_failed: "현재 번역문을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    close_project_failed: "프로젝트를 닫지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  action: {
    add_file: "추가",
    generate_translation: "번역문 생성",
    close_project: "프로젝트 닫기",
    reset: "번역 상태 초기화",
    translation_task: "번역",
    start_translation: "번역 시작",
    reset_task_all: "모든 데이터 초기화",
    reset_task_failed: "실패 데이터 초기화",
  },
  translation_export: {
    checking: "교정 경고 확인 중 …",
    check_failed: "교정 경고를 읽지 못했습니다. 현재 번역문 생성은 계속할 수 있습니다.",
    warning_description:
      "교정 경고가 {COUNT}개 있습니다. AGENT로 자동 교정한 후 번역문을 생성하는 것을 권장합니다. 계속할까요?",
    warning_list: "교정 경고",
    retry_check: "다시 확인",
    continue_generate: "생성 계속",
  },
  reorder: {
    failed: "파일 순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  dialog: {
    import_conflict: {
      description: "이름이 같은 파일 {COUNT}개를 발견했습니다. 처리 방법을 선택해 주세요.",
    },
    inherit_import: {
      description: "현재 프로젝트에서 번역이 완료된 텍스트로 새 파일을 채울까요?",
      fill: "채우기",
      do_not_fill: "채우지 않기",
    },
    reset: {
      description: "이 파일의 번역 상태를 초기화할까요?",
    },
    delete: {
      description: "선택한 파일과 해당 파일의 모든 번역 항목을 삭제할까요?",
    },
    close_project: {
      description: "현재 프로젝트를 닫을까요?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
