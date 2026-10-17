import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_game_font_page = {
  title: "Game Font Replacement",
  fields: {
    font_file: { title: "Font File", description: "Select a TTF or OTF font file" },
    game_path: { title: "Game Program", description: "Select the program that starts the game" },
  },
  action: { pick_file: "Select File", pick_executable: "Select EXE", start: "Replace" },
  confirm: {
    description: "Confirm replacement …?",
  },
  feedback: {
    inspect_failed: "Detection failed …",
    apply_failed: "Replacement failed …",
    applying: "Replacing game fonts …",
    apply_success: "Font replacement complete …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
