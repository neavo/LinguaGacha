import { zh_cn_toolbox_page } from "../zh-CN/toolbox-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_toolbox_page = {
  title: "Werkzeugkasten",
  entries: {
    game_font: {
      description: "Godot · RenPy · Tyrano · WOLFRPG · RPGMAKER MV/MZ",
    },
    translation_transfer: {
      description:
        "Abgeschlossene Übersetzungen in ein anderes Projekt übertragen, häufig für Aktualisierungen von Inhalten wie Romanen oder Spielen",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_toolbox_page>;
