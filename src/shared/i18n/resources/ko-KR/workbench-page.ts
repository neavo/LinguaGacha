import type { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_workbench_page = {
  title: "작업대",
  unit: {
    line: "Line",
  },
  table: {
    file_name: "파일 이름",
    progress: "진행률",
    agent: "AGENT",
    agent_only: "AGENT로만 번역할 수 있습니다",
    agent_recommended: "AGENT로 번역하는 것을 권장합니다",
  },
  feedback: {
    add_file_loading_toast: "파일 추가 중 …",
    no_valid_file: "추가할 수 있는 유효한 파일이 없습니다",
    close_project_failed: "프로젝트를 닫지 못했습니다. 잠시 후 다시 시도해 주세요 …",
  },
  action: {
    add_file: "추가",
    close_project: "프로젝트 닫기",
    reset: "파일 데이터 초기화",
    translation_task: "번역",
    start_translation: "번역 시작",
    reset_task_all: "모든 데이터 초기화",
    reset_task_failed: "실패 데이터 초기화",
  },
  dialog: {
    import_conflict: {
      description: "이름이 같은 파일 {COUNT}개를 발견했습니다. 처리 방법을 선택해 주세요 …",
    },
    inherit_import: {
      description: "완료된 번역문으로 가져온 파일을 채울까요 …?",
      fill: "채우기",
      do_not_fill: "채우지 않기",
    },
    reset: {
      description: "선택한 파일과 해당 파일의 모든 번역 항목을 초기화할까요 …?",
    },
    delete: {
      description: "선택한 파일과 해당 파일의 모든 번역 항목을 삭제할까요 …?",
    },
    close_project: {
      description: "현재 프로젝트를 닫을까요 …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
