import { zh_cn_function_settings_page } from "../zh-CN/function-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_function_settings_page = {
  title: "Funktionseinstellungen",
  fields: {
    source_language: {
      description: "Legt die Sprache des Eingabetexts fest",
    },
    target_language: {
      description: "Legt die Sprache des Ausgabetexts fest",
    },
    preceding_lines_threshold: {
      title: "Anzahl vorhergehender Kontexteinträge",
      description:
        "Legt fest, wie viele vorhergehende Texteinträge jede Aufgabe als Kontext enthält. Dies erhöht den Tokenverbrauch. Standardmäßig deaktiviert.",
    },
    following_lines_threshold: {
      title: "Anzahl nachfolgender Kontexteinträge",
      description:
        "Legt fest, wie viele nachfolgende Texteinträge jede Aufgabe als Kontext enthält. Dies erhöht den Tokenverbrauch. Standardmäßig deaktiviert.",
    },
    request_timeout: {
      title: "Anfrage-Timeout",
      description:
        "Maximale Antwortzeit in Sekunden. Ohne Antwort innerhalb dieser Frist gilt die Aufgabe als fehlgeschlagen.",
    },
    project_save_mode: {
      title: "Projekt-Speicherort",
      description:
        "Legt den Speicherort für Projektdateien beim Erstellen eines neuen Projekts fest",
      options: {
        manual: "Jedes Mal auswählen",
        fixed: "Fester Ordner",
        source: "Neben den Quelldateien",
      },
    },
    translation_save_mode: {
      title: "Speicherort der Übersetzung",
      description:
        "Legt den Speicherort für Übersetzungsdateien beim Erstellen der Übersetzung fest",
      options: {
        manual: "Jedes Mal auswählen",
        fixed: "Fester Ordner",
        project: "Neben der Projektdatei",
      },
    },
    output_folder_open_on_finish: {
      title: "Ausgabeordner öffnen, wenn die Übersetzungsdatei erstellt wurde",
      description:
        "Wenn aktiviert, wird der Ausgabeordner geöffnet, nachdem die übersetzte Datei erfolgreich erstellt wurde",
    },
  },
  feedback: {
    preceding_lines_threshold_invalid:
      "Die Anzahl vorhergehender Kontexteinträge muss eine ganze Zahl von 0 bis 9999999 sein …",
    following_lines_threshold_invalid:
      "Die Anzahl nachfolgender Kontexteinträge muss eine ganze Zahl von 0 bis 9999999 sein …",
    request_timeout_invalid:
      "Das Anfrage-Timeout muss eine Zahl innerhalb des gültigen Bereichs sein …",
    pick_directory_failed:
      "Ordnerauswahl fehlgeschlagen. Bitte wählen Sie das feste Speicherverzeichnis erneut aus …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_function_settings_page>;
