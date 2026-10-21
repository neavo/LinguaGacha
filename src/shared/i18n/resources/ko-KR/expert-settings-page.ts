import type { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_expert_settings_page = {
  title: "전문가 설정",
  fields: {
    preceding_lines_threshold: {
      title: "참고할 앞선 문맥의 최대 줄 수",
      description:
        "각 번역 작업에 포함할 수 있는 앞선 문맥의 최대 줄 수입니다. 기본적으로 사용하지 않습니다",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "앞선 문맥의 최대 줄 수에 유효한 범위의 숫자를 입력해 주세요 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
