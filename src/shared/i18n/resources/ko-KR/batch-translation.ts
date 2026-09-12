import type { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_batch_translation = {
  menu: {
    progress: "진행률",
    tooltip: "원문을 대상 언어로 번역합니다",
  },
  summary: {
    empty: "작업 없음",
    stopping: "중지 중",
    detail_tooltip: "클릭하여 상세 정보 보기",
    running: "번역 중",
  },
  detail: {
    provider: "접속 지점",
    elapsed_time: "경과 시간",
    remaining_time: "남은 시간",
    average_speed: "평균 속도",
    input_tokens: "입력 Token",
    reasoning_tokens: "생각 Token",
    output_tokens: "출력 Token",
    waveform_title: "현재 속도",
    metrics_title: "통계",

    active_requests: "실행 중인 작업 수",
  },
  feedback: {
    done: "완료 …",
    stopped: "중지됨 …",
    refresh_failed: "번역 작업 상태를 새로 고치지 못했습니다",
    start_failed: "번역 작업을 시작하지 못했습니다",
    stop_failed: "번역 작업을 중지하지 못했습니다",
    reset_all_failed: "전체 번역을 초기화하지 못했습니다",
    reset_failed_failed: "실패 항목을 초기화하지 못했습니다",
  },
  confirm: {
    reset_all_description: "프로젝트 전체의 번역 진행 상황을 초기화할까요?",
    reset_failed_description: "번역에 실패한 항목을 초기화할까요?",
    generate_description: "현재 사용 가능한 번역문을 생성할까요?",
    stop_description: "현재 번역 작업을 중지할까요?",
  },
  action: { stop: "중지" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
