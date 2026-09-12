import type { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";
export const ko_kr_toolbox_page = {
  title: "도구함",
  entries: {
    ts_conversion: {
      title: "번체·간체 변환",
      description: "프로젝트 번역문·캐릭터 이름을 일괄 번체↔간체 변환. 텍스트 보호 지원.",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
