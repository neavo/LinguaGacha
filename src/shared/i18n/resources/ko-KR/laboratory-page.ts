import type { zh_cn_laboratory_page } from "../zh-CN/laboratory-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_laboratory_page = {
  title: "실험실",
  fields: {
    agent_batch_translation_thinking_adaptive_enable: {
      title: "사고 수준 자동 조정",
      description:
        "번역 작업에서 깊은 사고를 사용하면 Token 소비량이 <emphasis>3~5배가 됩니다</emphasis>" +
        "\n" +
        "이 기능을 활성화하면 번역 작업의 사고 수준을 지능적으로 조정하여 Token 효율을 높이고 시간과 비용을 절약합니다. 기본적으로 활성화됩니다",
    },
    prompt_enhancement_enable: {
      title: "프롬프트 강화",
      description:
        "사고의 연쇄를 모방하여 AI의 지시 준수 능력을 높입니다" +
        "\n" +
        "이 기능을 끄면 Token 사용량은 조금 줄지만 AI의 작업 수행 능력이 크게 저하됩니다. 기본적으로 사용합니다",
    },
    mtool_optimizer_enable: {
      title: "MTool 최적화",
      description:
        "MTool 텍스트 번역 시 <emphasis>번역 시간과 Token 사용량을 최대 40% 줄일 수 있습니다</emphasis>. 기본적으로 사용합니다",
    },
    skip_duplicate_source_text_enable: {
      title: "중복 원문 건너뛰기",
      description:
        "같은 파일 내의 원문이 같은 항목은 한 번만 번역하고 <emphasis>번역문을 재사용</emphasis>합니다. 기본값은 사용입니다.",
    },
  },
  feedback: {
    refresh_failed: "실험실 설정을 새로 고칠 수 없습니다. 잠시 후 다시 시도해 주세요 …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_laboratory_page>;
