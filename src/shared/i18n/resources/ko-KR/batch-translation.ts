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
    stats_refresh_failed: "프로젝트 번역 통계를 새로 고치지 못했습니다 …",
    done: "번역이 완료되었습니다 …",
    stopped: "번역이 중지되었습니다 …",
    ended: "번역이 종료되었습니다 …",
    retry_exhausted: "{count}개 항목은 여러 번 재시도해도 성공하지 못해 건너뛰었습니다 …",
    keys_retry_wait: "API 오류. {seconds}초 후 자동으로 재시도합니다. 지금까지 {count}회 재시도 …",
    keys_retry_running: "API 오류. 재시도 중 …",
    refresh_failed: "번역 작업 상태를 새로 고치지 못했습니다 …",
    start_failed: "번역 작업을 시작하지 못했습니다 …",
    stop_failed: "번역 작업을 중지하지 못했습니다 …",
    reset_all_failed: "전체 번역을 초기화하지 못했습니다 …",
  },
  confirm: {
    reset_all_description: "프로젝트 전체의 번역 진행 상황을 초기화할까요 …?",
    stop_description: "현재 번역 작업을 중지할까요 …?",
  },
  action: { stop: "중지" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
