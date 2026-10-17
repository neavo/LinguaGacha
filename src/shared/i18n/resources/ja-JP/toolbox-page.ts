import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_toolbox_page = {
  title: "ツールボックス",
  entries: {
    game_font: {
      title: "ゲームフォント置換",
      description:
        "対応エンジン：\n<emphasis>WOLF RPG 3</emphasis>\n<emphasis>RPG Maker MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
