import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const pt_br_game_font_page = {
  title: "Alterar fonte do jogo",
  fields: {
    game: { title: "Jogo", description: "Clique ou arraste o executável ou a pasta do jogo" },
    font_file: {
      title: "Arquivo de fonte",
      description: "Clique ou arraste o arquivo de fonte",
      hint: "Compatível com TTF",
    },
  },
  action: {
    pick_executable: "Selecionar executável do jogo",
    pick_directory: "Selecionar pasta do jogo",
    start: "Alterar",
  },
  feedback: {
    inspect_failed: "Falha na detecção …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
