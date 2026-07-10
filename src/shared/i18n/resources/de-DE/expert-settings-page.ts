import { zh_cn_expert_settings_page } from "../zh-CN/expert-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_expert_settings_page = {
  title: "Erweitert",
  fields: {
    preceding_lines_threshold: {
      title: "Schwellenwert für vorhergehende Zeilen",
      description:
        "Maximale Anzahl vorhergehender Zeilen, die als Kontext für jede Übersetzungsaufgabe einbezogen werden, standardmäßig deaktiviert",
    },
    clean_ruby: {
      title: "Ruby-Text bereinigen",
      description:
        "Entfernt die phonetischen Ruby-Zeichen aus Anmerkungen und behält nur den Haupttext bei, standardmäßig deaktiviert" +
        "\n" +
        "Phonetische Ruby-Zeichen werden vom Modell oft nicht verstanden, ihre Bereinigung kann die Übersetzungsqualität verbessern" +
        "\n" +
        "Unterstützte Ruby-Formate umfassen, sind aber nicht beschränkt auf:" +
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
        "In Untertiteln oder E-Books, ob Text nur einmal ausgegeben werden soll, wenn Quell- und Zieltext identisch sind, standardmäßig aktiviert",
    },
    write_translated_name_fields_to_file: {
      title: "Übersetzte Namensfelder in die Ausgabedatei schreiben",
      description:
        "In einigen <emphasis>GalGame</emphasis> sind Namensfelddaten an Ressourcendateien wie Bild- oder Sprachdateien gebunden" +
        "\n" +
        "Das Übersetzen dieser Namensfelder kann Fehler verursachen. In solchen Fällen kann diese Funktion deaktiviert werden, standardmäßig aktiviert" +
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
        "Ob Textsegmente am Anfang/Ende, die Schutzregeln entsprechen, automatisch verarbeitet werden sollen, standardmäßig aktiviert" +
        "\n" +
        "• Aktiviert: Entfernt Segmente, die Schutzregeln entsprechen, und stellt sie nach der Übersetzung wieder her" +
        "\n" +
        "• Deaktiviert: Sendet den vollständigen Text für besseren Kontext, kann aber die Schutzwirksamkeit verringern",
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
