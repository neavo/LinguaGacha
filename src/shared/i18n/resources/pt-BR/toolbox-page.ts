import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_toolbox_page = {
  title: "Caixa de ferramentas",
  entries: {
    game_font: {
      description: "Godot · RenPy · Tyrano · WOLFRPG · RPGMAKER MV/MZ",
    },
    translation_transfer: {
      description:
        "Transfere traduções concluídas para outro projeto, comumente usado para atualizar conteúdos como novels ou jogos",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
