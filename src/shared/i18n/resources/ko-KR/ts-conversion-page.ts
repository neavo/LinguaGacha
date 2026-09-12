import type { zh_cn_ts_conversion_page } from "../zh-CN/ts-conversion-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_ts_conversion_page = {
  title: "번체·간체 변환",
  description: "프로젝트의 번역문을 중국어 간체와 번체 간에 변환합니다",
  direction: {
    t2s: "번체에서 간체로",
    s2t: "간체에서 번체로",
  },
  fields: {
    direction: {
      title: "변환 모드",
      description:
        "번체·간체 변환은 <emphasis>OpenCC</emphasis>를 사용합니다. 간체에서 번체로는 S2TW, 번체에서 간체로는 T2S 규칙을 사용합니다",
    },
    preserve_text: {
      title: "텍스트 보호 규칙 적용",
      description: "텍스트 보호 규칙을 적용하여 게임 텍스트의 코드가 손상되지 않도록 합니다",
    },
    target_name: {
      title: "이름 필드의 번역문 변환",
      description:
        "일부 <emphasis>GalGame</emphasis>의 이름 필드는 이미지·음성 파일과 연결됩니다. 이름 번역 시 오류가 나면 끄세요. 기본값은 사용입니다.",
    },
  },
  action: {
    start: "변환 시작",
    preparing: "번체·간체 변환 데이터 준비 중 …",
    progress: "번체·간체 변환 중: {CURRENT}/{TOTAL}개 …",
  },
  confirm: {
    description: "번체·간체 변환을 시작할까요?",
  },
  feedback: {
    prefer_native_traditional_chinese:
      "번체 직접 번역 기능을 권장합니다:\n기본 설정 - 번역문 언어 - 중국어(번체)",
    task_success: "작업을 완료했습니다 …",
    task_failed: "작업 실행에 실패했습니다 …",
    task_running: "작업이 실행 중입니다 …",
    project_required: "먼저 프로젝트 파일을 열어 주세요 …",
    no_data: "유효한 데이터가 없습니다 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_ts_conversion_page>;
