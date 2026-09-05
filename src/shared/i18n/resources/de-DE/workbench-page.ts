import { zh_cn_workbench_page } from "../zh-CN/workbench-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_workbench_page = {
  title: "Werkbank",
  unit: {
    line: "Zeile",
  },
  table: {
    file_name: "Dateiname",
    line_count: "Zeilen",
    actions: "Aktionen",
  },
  sort: {
    ascending: "Aufsteigend sortieren",
    descending: "Absteigend sortieren",
    clear: "Sortierung löschen",
  },
  feedback: {
    refresh_failed: "Fehler beim Aktualisieren der Werkbank.",
    add_file_loading_toast: "Datei wird hinzugefügt und Cache aktualisiert …",
    no_valid_file: "Keine gültigen Dateien können hinzugefügt werden.",
    file_action_failed: "Dateioperation fehlgeschlagen. Bitte versuchen Sie es später erneut.",
    generate_translation_failed:
      "Fehler beim Erstellen verfügbarer Übersetzungsdateien. Bitte versuchen Sie es später erneut.",
    close_project_failed:
      "Fehler beim Schließen des Projekts. Bitte versuchen Sie es später erneut.",
  },
  action: {
    add_file: "Hinzufügen",
    generate_translation: "Übersetzung erstellen",
    close_project: "Schließen",
    reset: "Übersetzung zurücksetzen",
    translation_task: "Übersetzung",
    start_translation: "Übersetzung starten",
    reset_task_all: "Alle Daten zurücksetzen",
    reset_task_failed: "Fehlgeschlagene Daten zurücksetzen",
    stop_task: "Stopp",
  },
  task: {
    menu: {
      progress: "Fortschritt",
    },
    summary: {
      empty: "Inaktiv",
      stopping: "Wird gestoppt",
      detail_tooltip: "Zum Anzeigen der Details klicken",
    },
    detail: {
      elapsed_time: "Verstrichene Zeit",
      remaining_time: "Verbleibende Zeit",
      average_speed: "Durchschnittsgeschwindigkeit",
      input_tokens: "Eingabe-Token",
      reasoning_tokens: "Denk-Token",
      output_tokens: "Ausgabe-Token",
    },
    feedback: {
      done: "Abgeschlossen …",
      stopped: "Gestoppt …",
    },
  },

  translation_task: {
    menu: {
      tooltip: "Quelltext in die Zielsprache übersetzen",
    },
    summary: {
      running: "Wird übersetzt",
    },
    detail: {
      title: "Übersetzungsdetails",
      description: "Aktuelle Übersetzungsstatistiken anzeigen.",
      waveform_title: "Echtzeit-Geschwindigkeit",
      metrics_title: "Statistiken",

      active_requests: "Echtzeit-Aufgaben",
    },
    confirm: {
      reset_all_description:
        "Übersetzungsfortschritt für das gesamte Projekt wirklich zurücksetzen …?",
      reset_failed_description: "Fehlgeschlagene Übersetzungseinträge wirklich zurücksetzen …?",
      generate_description: "Derzeit verfügbare Übersetzungsdateien wirklich erstellen …?",
      stop_description: "Aktuelle Übersetzungsaufgabe wirklich stoppen …?",
    },
    feedback: {
      refresh_failed: "Fehler beim Aktualisieren der Übersetzungsaufgabe.",
      start_failed: "Fehler beim Starten der Übersetzungsaufgabe.",
      stop_failed: "Fehler beim Stoppen der Übersetzungsaufgabe.",

      reset_all_failed: "Fehler beim Zurücksetzen des gesamten Übersetzungsfortschritts.",
      reset_failed_failed: "Fehler beim Zurücksetzen der fehlgeschlagenen Übersetzungseinträge.",
    },
  },
  translation_export: {
    checking: "Korrekturwarnungen werden geprüft …",
    check_failed:
      "Korrekturwarnungen konnten nicht geladen werden. Die aktuelle Übersetzung kann trotzdem erstellt werden.",
    warning_description:
      "Es wurden {COUNT} Korrekturwarnungen gefunden. Wir empfehlen, sie vor dem Erstellen der Übersetzung automatisch mit AGENT zu prüfen und zu beheben. Trotzdem fortfahren …?",
    warning_list: "Korrekturwarnungen",
    retry_check: "Erneut prüfen",
    continue_generate: "Trotzdem erstellen",
  },
  reorder: {
    failed: "Fehler beim Speichern der Dateireihenfolge. Bitte versuchen Sie es später erneut.",
  },
  dialog: {
    import_conflict: {
      description:
        "{COUNT} Dateien mit demselben Namen wurden erkannt. Wählen Sie, wie damit umgegangen werden soll …?",
    },
    inherit_import: {
      description:
        "Abgeschlossene Übersetzungen aus dem aktuellen Projekt verwenden, um die neuen Dateien zu füllen …?",
      fill: "Füllen",
      do_not_fill: "Nicht füllen",
    },
    reset: {
      description: "Übersetzungsstatus dieser Datei wirklich zurücksetzen …?",
    },
    delete: {
      description:
        "Ausgewählte Datei und alle zugehörigen Übersetzungseinträge wirklich löschen …?",
    },
    close_project: {
      description: "Aktuelles Projekt wirklich schließen …?",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_workbench_page>;
