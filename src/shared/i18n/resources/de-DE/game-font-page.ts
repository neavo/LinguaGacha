import { zh_cn_game_font_page } from "../zh-CN/game-font-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_game_font_page = {
  title: "Spielschrift ersetzen",
  fields: {
    font_file: { title: "Schriftdatei", description: "Wählen Sie eine TTF- oder OTF-Schriftdatei" },
    game_path: {
      title: "Spielprogramm",
      description: "Wählen Sie das Programm, das das Spiel startet",
    },
  },
  action: { pick_file: "Datei wählen", pick_executable: "EXE wählen", start: "Ersetzen" },
  confirm: {
    description: "Ersetzen bestätigen …?",
  },
  feedback: {
    inspect_failed: "Erkennung fehlgeschlagen …",
    apply_failed: "Ersetzen fehlgeschlagen …",
    applying: "Spielschriften werden ersetzt …",
    apply_success: "Schriften ersetzt …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_game_font_page>;
