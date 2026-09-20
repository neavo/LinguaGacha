import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const de_de_batch_translation = {
  menu: {
    progress: "Fortschritt",
    tooltip: "Quelltext in die Zielsprache übersetzen",
  },
  summary: {
    empty: "Inaktiv",
    stopping: "Wird gestoppt",
    detail_tooltip: "Zum Anzeigen der Details klicken",
    running: "Wird übersetzt",
  },
  detail: {
    provider: "Anbieter",
    elapsed_time: "Verstrichene Zeit",
    remaining_time: "Verbleibende Zeit",
    average_speed: "Durchschnittsgeschwindigkeit",
    input_tokens: "Eingabe-Token",
    reasoning_tokens: "Denk-Token",
    output_tokens: "Ausgabe-Token",
    waveform_title: "Echtzeit-Geschwindigkeit",
    metrics_title: "Statistiken",
    active_requests: "Echtzeit-Aufgaben",
  },
  feedback: {
    stats_refresh_failed: "Die Übersetzungsstatistik des Projekts konnte nicht aktualisiert werden",
    done: "Übersetzung abgeschlossen …",
    stopped: "Übersetzung gestoppt …",
    done_with_errors: "Übersetzung abgeschlossen, einige Einträge sind fehlgeschlagen …",
    keys_retry_wait:
      "Keine Schlüssel verfügbar. {count} Wiederholungen, nächster Versuch in {seconds} Sekunden …",
    keys_retry_running:
      "Keine Schlüssel verfügbar. {count} Wiederholungen, erneuter Versuch läuft …",
    refresh_failed: "Fehler beim Aktualisieren der Übersetzungsaufgabe.",
    start_failed: "Fehler beim Starten der Übersetzungsaufgabe.",
    stop_failed: "Fehler beim Stoppen der Übersetzungsaufgabe.",
    reset_all_failed: "Fehler beim Zurücksetzen des gesamten Übersetzungsfortschritts.",
    reset_failed_failed: "Fehler beim Zurücksetzen der fehlgeschlagenen Übersetzungseinträge.",
  },
  confirm: {
    reset_all_description:
      "Übersetzungsfortschritt für das gesamte Projekt wirklich zurücksetzen …?",
    reset_failed_description: "Fehlgeschlagene Übersetzungseinträge wirklich zurücksetzen …?",
    generate_description: "Derzeit verfügbare Übersetzungsdateien wirklich erstellen …?",
    stop_description: "Aktuelle Übersetzungsaufgabe wirklich stoppen …?",
  },
  action: { stop: "Stoppen" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
