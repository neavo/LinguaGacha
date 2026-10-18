import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_toolbox_page = {
  title: "Werkzeugkasten",
  entries: {
    game_font: {
      description:
        "Unterstützte Engines:\n<emphasis>WOLF RPG 3</emphasis>\n<emphasis>RPG Maker MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
