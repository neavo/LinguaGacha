import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_game_font_page = {
  title: "Modificar Fonte do Jogo",
  fields: {
    game: { title: "Jogo", description: "Clique ou arraste o executável ou a pasta do jogo" },
    font_file: {
      title: "Arquivo de Fonte",
      description: "Clique ou arraste o arquivo de fonte",
      hint: "Suporta TTF",
    },
  },
  action: {
    pick_executable: "Selecionar Executável do Jogo",
    pick_directory: "Selecionar Pasta do Jogo",
    start: "Modificar",
  },
  feedback: {
    inspect_failed: "Falha na detecção …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
