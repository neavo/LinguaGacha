import { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_basic_settings_page = {
  title: "Grundeinstellungen",
  fields: {
    source_language: {
      title: "Quellsprache",
      description: "Legt die Sprache des Eingabetexts im aktuellen Projekt fest",
    },
    target_language: {
      title: "Zielsprache",
      description: "Legt die Sprache des Ausgabetexts im aktuellen Projekt fest",
    },
    project_save_mode: {
      title: "Projekt-Speicherort",
      description:
        "Legt den Speicherort für Projektdateien beim Erstellen eines neuen Projekts fest",
      description_fixed:
        "Legt den Speicherort für Projektdateien beim Erstellen eines neuen Projekts fest" +
        "\n" +
        "aktuell {PATH}",
      options: {
        manual: "Jedes Mal auswählen",
        fixed: "Fester Ordner",
        source: "Neben den Quelldateien",
      },
    },
    output_folder_open_on_finish: {
      title: "Ausgabeordner öffnen, wenn die Übersetzungsdatei erstellt wurde",
      description:
        "Wenn aktiviert, wird der Ausgabeordner geöffnet, nachdem die übersetzte Datei erfolgreich erstellt wurde",
    },
    request_timeout: {
      title: "Anfrage-Timeout",
      description:
        "Die maximale Wartezeit (Sekunden) für eine Antwort bei einer Anfrage" +
        "\n" +
        "Wenn nach dem Timeout keine Antwort eingeht, wird die Aufgabe als fehlgeschlagen betrachtet",
    },
  },
  feedback: {
    refresh_failed:
      "Grundeinstellungen können derzeit nicht aktualisiert werden. Bitte versuchen Sie es später erneut.",
    update_failed: "Fehler beim Speichern der Einstellung. Bitte versuchen Sie es später erneut.",
    request_timeout_invalid:
      "Das Anfrage-Timeout muss eine Zahl innerhalb des gültigen Bereichs sein.",
    pick_directory_failed:
      "Ordnerauswahl fehlgeschlagen. Bitte wählen Sie das feste Speicherverzeichnis erneut aus.",
    source_language_loading_toast: "Projekt-Cache wird aktualisiert …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
