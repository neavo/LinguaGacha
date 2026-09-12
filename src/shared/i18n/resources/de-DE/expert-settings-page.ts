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
    clean_ruby: {
      title: "Ruby-Text bereinigen",
      description:
        "Ruby-Lesungen entfernen, Grundtext behalten (standardmäßig aus). Modelle verstehen Ruby oft nicht; Entfernen kann die Übersetzung verbessern. Formatbeispiele:" +
        "\n" +
        "• <ruby>漢字<rt>かんじ</rt></ruby>" +
        "\n" +
        "• (漢字/かんじ) [漢字/かんじ] |漢字[かんじ]" +
        "\n" +
        "• \\r[漢字,かんじ] \\rb[漢字,かんじ] [r_かんじ][ch_漢字] [ch_漢字]" +
        "\n" +
        '• [ruby text=かんじ] [ruby text = かんじ] [ruby text="かんじ"] [ruby text = "かんじ"]',
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
    auto_process_prefix_suffix_preserved_text: {
      title: "Präfix/Suffix-geschützten Text automatisch verarbeiten",
      description:
        "Geschützte Textanfänge/-enden automatisch verarbeiten (standardmäßig an)." +
        "\n" +
        "• An: Geschützte Segmente vor der Übersetzung entfernen und danach wieder einfügen." +
        "\n" +
        "• Aus: Den vollständigen Eintrag übersetzen; mehr Kontext, aber schwächerer Textschutz.",
    },
  },
  feedback: {
    refresh_failed:
      "Experteneinstellungen können derzeit nicht aktualisiert werden. Bitte versuchen Sie es später erneut.",
    update_failed: "Fehler beim Speichern der Einstellung. Bitte versuchen Sie es später erneut.",
    preceding_lines_threshold_invalid:
      "Der Schwellenwert für vorhergehende Zeilen muss eine Zahl innerhalb des gültigen Bereichs sein.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_expert_settings_page>;
