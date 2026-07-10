import { zh_cn_ts_conversion_page } from "../zh-CN/ts-conversion-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_ts_conversion_page = {
  title: "Traditionell-Vereinfacht-Konvertierung",
  description:
    "Konvertieren Sie übersetzten Text im Projekt zwischen vereinfachtem und traditionellem Chinesisch",
  direction: {
    t2s: "Traditionell zu Vereinfacht",
    s2t: "Vereinfacht zu Traditionell",
  },
  fields: {
    direction: {
      title: "Konvertierungsmodus",
      description:
        "Die Konvertierung wird durch <emphasis>OpenCC</emphasis> implementiert" +
        "\n" +
        "Vereinfacht zu Traditionell verwendet S2TW-Regeln, Traditionell zu Vereinfacht verwendet T2S-Regeln",
    },
    preserve_text: {
      title: "Textschutzregeln befolgen",
      description:
        "Textschutzregeln befolgen, um zu vermeiden, dass Code-Segmente im Spieltext während des Konvertierungsprozesses beschädigt werden",
    },
    target_name: {
      title: "Namensfeld-Übersetzungen konvertieren",
      description:
        "In einigen <emphasis>GalGame</emphasis> ist das Namensfeld an Ressourcen gebunden, was nach der Übersetzung zu Fehlern führen kann" +
        "\n" +
        "Sie können diese Funktion in diesem Fall deaktivieren, standardmäßig aktiviert",
    },
  },
  action: {
    start: "Konvertierung starten",
    preparing: "Konvertierungsdaten werden vorbereitet …",
    progress: "Konvertiere Traditionell-Vereinfacht, Eintrag {CURRENT} von {TOTAL} …",
  },
  confirm: {
    description: "Konvertierung der chinesischen Schrift wirklich starten …?",
  },
  feedback: {
    prefer_native_traditional_chinese:
      "Empfohlen: Verwenden Sie die native Übersetzungsfunktion für traditionelles Chinesisch:\nGrundeinstellungen - Zielsprache - Traditionelles Chinesisch",
    task_success: "Aufgabe erfolgreich …",
    task_failed: "Aufgabe fehlgeschlagen …",
    task_running: "Aufgabe wird ausgeführt …",
    project_required: "Bitte laden Sie zuerst ein Projekt …",
    no_data: "Keine gültigen Daten …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_ts_conversion_page>;
