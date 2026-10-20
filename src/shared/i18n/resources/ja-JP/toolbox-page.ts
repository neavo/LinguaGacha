import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const ja_jp_toolbox_page = {
  title: "ツールボックス",
  entries: {
    game_font: {
      description:
        "<emphasis>Godot 4</emphasis>\n<emphasis>WOLFRPG 3</emphasis>\n<emphasis>RPG Maker MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
