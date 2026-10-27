import type { zh_cn_function_settings_page } from "../zh-CN/function-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_function_settings_page = {
  title: "기능 설정",
  fields: {
    source_language: {
      description: "입력 텍스트 언어를 설정합니다",
    },
    target_language: {
      description: "출력 텍스트 언어를 설정합니다",
    },
    preceding_lines_threshold: {
      title: "참고할 앞선 문맥의 항목 수",
      description:
        "각 작업에 참고용으로 포함할 앞선 문맥의 텍스트 항목 수를 설정합니다. 토큰 사용량이 증가합니다. 기본적으로 비활성화됩니다.",
    },
    following_lines_threshold: {
      title: "참고할 뒤따르는 문맥의 항목 수",
      description:
        "각 작업에 참고용으로 포함할 뒤따르는 문맥의 텍스트 항목 수를 설정합니다. 토큰 사용량이 증가합니다. 기본적으로 비활성화됩니다.",
    },
    request_timeout: {
      title: "요청 제한 시간",
      description:
        "모델 응답을 기다리는 최대 시간(초)입니다. 시간 내에 응답이 없으면 작업을 실패로 처리합니다",
    },
    project_save_mode: {
      title: "프로젝트 파일 저장 위치",
      description: "새 프로젝트를 만들 때 프로젝트 파일을 저장할 위치를 설정합니다",
      options: {
        manual: "매번 직접 선택",
        fixed: "지정 폴더",
        source: "원본 파일과 같은 폴더",
      },
    },
    translation_save_mode: {
      title: "번역 파일 저장 위치",
      description: "번역문을 생성할 때 번역 파일을 저장할 위치를 설정합니다",
      options: {
        manual: "매번 직접 선택",
        fixed: "지정 폴더",
        project: "프로젝트 파일과 같은 폴더",
      },
    },
    output_folder_open_on_finish: {
      title: "번역문 파일 생성 후 출력 폴더 열기",
      description: "번역문 파일이 생성되면 출력 폴더를 자동으로 엽니다",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "참고할 앞선 문맥의 항목 수는 0에서 9999999 사이의 정수여야 합니다 …",
    following_lines_threshold_invalid:
      "참고할 뒤따르는 문맥의 항목 수는 0에서 9999999 사이의 정수여야 합니다 …",
    request_timeout_invalid: "요청 제한 시간에 유효한 범위의 숫자를 입력해 주세요 …",
    pick_directory_failed: "폴더를 선택하지 못했습니다. 지정 저장 폴더를 다시 선택해 주세요 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_function_settings_page>;
