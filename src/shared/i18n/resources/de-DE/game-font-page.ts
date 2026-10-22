import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_game_font_page = {
  title: "Spielschrift ändern",
  fields: {
    game: { title: "Spiel", description: "Klicken oder Spielprogramm bzw. -ordner hierher ziehen" },
    font_file: {
      title: "Schriftdatei",
      description: "Klicken oder Schriftdatei hierher ziehen",
      hint: "Unterstützt TTF",
    },
  },
  action: {
    pick_executable: "Spielprogramm wählen",
    pick_directory: "Spielordner wählen",
    start: "Ändern",
  },
  confirm: { description: "Spielschrift ändern …?" },
  feedback: {
    inspect_failed: "Erkennung fehlgeschlagen …",
    apply_failed: "Ändern fehlgeschlagen …",
    applying: "Spielschrift wird geändert …",
    apply_success: "Spielschrift geändert …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
