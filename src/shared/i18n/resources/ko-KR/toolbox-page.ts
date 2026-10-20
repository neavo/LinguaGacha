import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const ko_kr_toolbox_page = {
  title: "도구 상자",
  entries: {
    game_font: {
      description:
        "지원 엔진:\n<emphasis>WOLFRPG 3</emphasis>\n<emphasis>RPG Maker MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
