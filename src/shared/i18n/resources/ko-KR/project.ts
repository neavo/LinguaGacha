import { en_us_project } from "../en-US/project";
import type { zh_cn_project } from "../zh-CN/project";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_project = {
  language: {
    short: en_us_project.language.short,
    title: "프로젝트 언어",
    source_description: "입력 텍스트 언어를 설정합니다",
    target_description: "출력 텍스트 언어를 설정합니다",
  },
  create: {
    title: "프로젝트 만들기",
    loading_toast: "프로젝트 생성 중 …",
    success: "프로젝트를 만들었습니다 …",
    default_preset_loaded: "기본 프리셋을 자동으로 불러왔습니다: {NAMES} …",
    default_presets: {
      glossary: "용어집",
      text_preserve: "텍스트 보호",
      pre_translation_replacement: "번역 전 치환",
      post_translation_replacement: "번역 후 치환",
      translation_prompt: "번역 프롬프트",
    },
  },
  open: {
    title: "프로젝트 열기",
    drop_title: "클릭하거나 .lg 파일 놓기",
    loading_toast: "프로젝트 불러오는 중 …",
    remove_unavailable: "최근 사용 기록을 제거할 수 없습니다. 잠시 후 다시 시도해 주세요 …",
    newer_app_version_description:
      "이 파일의 대상 앱 버전은 <emphasis>v{VERSION}</emphasis>입니다. 이전 버전의 앱으로 열면 데이터가 손상될 수 있습니다. 계속 여시겠습니까 …?",
    missing_file_description: "프로젝트 파일을 사용할 수 없습니다. 목록에서 제거할까요 …?",
  },
  rename: "프로젝트 이름 변경",
  close: {
    action: "프로젝트 닫기",
    confirm: "현재 프로젝트를 닫을까요 …?",
    failed: "프로젝트를 닫지 못했습니다. 잠시 후 다시 시도해 주세요 …",
  },
  preview: {
    file_count: "파일 수",
    files: "파일 {COUNT}개",
    created_at: "생성 시간",
    updated_at: "마지막 수정",
    progress: "번역 진행률",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_project>;
