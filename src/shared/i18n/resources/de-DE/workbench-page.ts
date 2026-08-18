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
    analysis_task: "Analyse",
    start_analysis: "Analyse starten",
    import_analysis_glossary: "Kandidatenbegriffe importieren",
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
      output_tokens: "Ausgabe-Token",
    },
    feedback: {
      done: "Abgeschlossen …",
      stopped: "Gestoppt …",
    },
  },
  analysis_task: {
    menu: {
      tooltip: "Begriffe aus dem Quelltext extrahieren",
    },
    migration: {
      description:
        "Der klassische Analyse-Workflow wird demnächst entfernt …\nNutze AGENT, um das Glossar vollautomatisch, schneller und intelligenter zu erstellen …!",
      jump: "Zu AGENT",
      continue: "Aufgabe fortsetzen",
    },
    summary: {
      running: "Wird analysiert",
    },
    detail: {
      title: "Analysedetails",
      description: "Live-Statistiken für die aktuelle Analyse anzeigen.",
      waveform_title: "Live-Geschwindigkeit",
      metrics_title: "Metriken",

      active_requests: "Aktive Anfragen",
      candidate_count: "Kandidatenbegriffe",
    },
    confirm: {
      reset_all_description: "Analysefortschritt für das gesamte Projekt wirklich zurücksetzen …?",
      reset_failed_description: "Fehlgeschlagenen Analysefortschritt wirklich zurücksetzen …?",
      import_glossary_description: "Kandidatenbegriffe wirklich ins Glossar importieren …?",
      stop_description: "Aktuelle Analyseaufgabe wirklich stoppen …?",
    },
    feedback: {
      refresh_failed: "Fehler beim Aktualisieren des Analyseaufgabenstatus",
      start_failed: "Fehler beim Starten der Analyseaufgabe",
      stop_failed: "Fehler beim Stoppen der Analyseaufgabe",

      reset_all_failed: "Fehler beim Zurücksetzen des gesamten Analysefortschritts",
      reset_failed_failed: "Fehler beim Zurücksetzen des fehlgeschlagenen Analysefortschritts",
      import_loading_toast:
        "Kandidatenbegriffe werden importiert und Korrektur-Cache aktualisiert …",
      import_failed: "Fehler beim Importieren der Kandidatenbegriffe",
      import_success: "{COUNT} Kandidatenbegriffe importiert",
      agent_draft_preserved: "Der vorhandene AGENT-Entwurf wurde beibehalten.",
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
      generate_failed: "Fehler beim Erstellen verfügbarer Übersetzungsdateien.",
    },
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
