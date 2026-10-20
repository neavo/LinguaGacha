import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_toolbox_page = {
  title: "Toolbox",
  entries: {
    game_font: {
      description:
        "Supported engines:\n<emphasis>WOLFRPG 3</emphasis>\n<emphasis>RPG Maker MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
