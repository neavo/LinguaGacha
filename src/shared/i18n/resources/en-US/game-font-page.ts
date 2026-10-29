import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_game_font_page = {
  title: "Modify Game Font",
  fields: {
    game: { title: "Game", description: "Click or Drag Game Program or Folder" },
    font_file: {
      title: "Font File",
      description: "Click or Drag Font File",
      hint: "Supports TTF",
    },
  },
  action: {
    pick_executable: "Select Game Program",
    pick_directory: "Select Game Folder",
    start: "Modify",
  },
  feedback: {
    inspect_failed: "Detection failed …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
