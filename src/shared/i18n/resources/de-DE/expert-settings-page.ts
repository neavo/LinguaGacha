import { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_expert_settings_page = {
  title: "Erweitert",
  fields: {
    preceding_lines_threshold: {
      title: "Schwellenwert für vorhergehende Zeilen",
      description:
        "Maximale Zahl vorheriger Kontextzeilen pro Übersetzungsaufgabe. Standardmäßig deaktiviert.",
    },
    deduplication_in_bilingual: {
      title:
        "Nur einmal ausgeben, wenn Quelle und Ziel in zweisprachigen Ausgabedateien identisch sind",
      description:
        "In Untertiteln und E-Books gleiche Quell- und Zieltexte nur einmal ausgeben. Standardmäßig aktiviert.",
    },
    write_translated_name_fields_to_file: {
      title: "Übersetzte Namensfelder in die Ausgabedatei schreiben",
      description:
        "Manche <emphasis>GalGame</emphasis>-Namen sind an Bild- und Sprachdateien gebunden. Bei Übersetzungsfehlern deaktivieren (standardmäßig an)." +
        "\n" +
        "Unterstützte Formate:" +
        "\n" +
        "• RenPy exportierter Spieltext (.rpy)" +
        "\n" +
        "• VNTextPatch oder SExtractor exportierter Spieltext mit Namensfeldern (.json)",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "Der Schwellenwert für vorhergehende Zeilen muss eine Zahl innerhalb des gültigen Bereichs sein …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
