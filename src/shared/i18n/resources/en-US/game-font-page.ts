import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_game_font_page = {
  title: "Modify game font",
  fields: {
    game: { title: "Game", description: "Click or drag game program or folder" },
    font_file: {
      title: "Font file",
      description: "Click or drag font file",
      hint: "Supports TTF",
    },
  },
  action: {
    pick_executable: "Select game program",
    pick_directory: "Select game folder",
    start: "Modify",
  },
  feedback: {
    inspect_failed: "Detection failed …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
