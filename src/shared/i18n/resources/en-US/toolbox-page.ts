import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_toolbox_page = {
  title: "Toolbox",
  entries: {
    game_font: {
      description: "Godot · RenPy · Tyrano · WOLFRPG · RPGMAKER MV/MZ",
    },
    translation_transfer: {
      description:
        "Transfer completed translations into another project, commonly used for updating content such as novels or games",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
