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
    done: "Abgeschlossen …",
    stopped: "Gestoppt …",
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
