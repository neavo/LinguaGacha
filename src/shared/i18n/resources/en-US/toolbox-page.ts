import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_toolbox_page = {
  title: "Toolbox",
  entries: {
    game_font: {
      description:
        "<emphasis>Godot</emphasis> · <emphasis>RenPy</emphasis> · <emphasis>Tyrano</emphasis> · <emphasis>WOLFRPG</emphasis> · <emphasis>RPGMAKER MV/MZ</emphasis>",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
