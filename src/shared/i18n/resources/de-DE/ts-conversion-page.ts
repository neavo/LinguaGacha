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
        "<emphasis>OpenCC</emphasis>: S2TW für vereinfacht → traditionell, T2S für traditionell → vereinfacht.",
    },
    preserve_text: {
      title: "Textschutzregeln befolgen",
      description: "Textschutzregeln bewahren Codeabschnitte in Spieltexten bei der Konvertierung.",
    },
    target_name: {
      title: "Namensfeld-Übersetzungen konvertieren",
      description:
        "Manche <emphasis>GalGame</emphasis>-Namen sind an Bild- und Sprachdateien gebunden. Bei Übersetzungsfehlern deaktivieren (standardmäßig an).",
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
