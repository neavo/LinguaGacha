import type { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_basic_settings_page = {
  title: "기본 설정",
  fields: {
    source_language: {
      title: "원문 언어",
      description: "현재 프로젝트의 입력 텍스트 언어를 설정합니다",
    },
    target_language: {
      title: "번역문 언어",
      description: "현재 프로젝트의 출력 텍스트 언어를 설정합니다",
    },
    project_save_mode: {
      title: "프로젝트 파일 저장 위치",
      description: "새 프로젝트를 만들 때 프로젝트 파일을 저장할 위치를 설정합니다",
      description_fixed:
        "새 프로젝트를 만들 때 프로젝트 파일을 저장할 위치를 설정합니다" + "\n" + "현재: {PATH}",
      options: {
        manual: "매번 직접 선택",
        fixed: "지정 폴더",
        source: "원본 파일과 같은 폴더",
      },
    },
    output_folder_open_on_finish: {
      title: "번역문 파일 생성 후 출력 폴더 열기",
      description: "번역문 파일이 생성되면 출력 폴더를 자동으로 엽니다",
    },
    request_timeout: {
      title: "요청 제한 시간",
      description:
        "모델 응답을 기다리는 최대 시간(초)입니다. 시간 내에 응답이 없으면 작업을 실패로 처리합니다",
    },
  },
  feedback: {
    refresh_failed: "기본 설정을 새로 고칠 수 없습니다. 잠시 후 다시 시도해 주세요.",
    update_failed: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    request_timeout_invalid: "요청 제한 시간에 유효한 범위의 숫자를 입력해 주세요.",
    pick_directory_failed: "폴더를 선택하지 못했습니다. 지정 저장 폴더를 다시 선택해 주세요.",
    source_language_loading_toast: "프로젝트 캐시 새로 고치는 중 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
