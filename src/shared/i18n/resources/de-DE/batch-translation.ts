import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const de_de_batch_translation = {
  menu: {
    progress: "Fortschritt",
    tooltip: "Ausgangstext in die Zielsprache übersetzen",
  },
  summary: {
    translation: {
      running: "Stapelübersetzung läuft",
      stopping: "Stapelübersetzung wird gestoppt",
    },
    request: { running: "Stapelanfragen laufen", stopping: "Stapelanfragen werden gestoppt" },
    mixed: { running: "Stapelaufgaben laufen", stopping: "Stapelaufgaben werden gestoppt" },
    empty: "Inaktiv",
    stopping: "Wird gestoppt",
    detail_tooltip: "Zum Anzeigen der Details klicken",
  },
  detail: {
    waveform_title: "Echtzeit-Geschwindigkeit",
    provider: "Anbieter",
    custom_thinking: "Benutzerdefiniert",
    elapsed_time: "Verstrichene Zeit",
    remaining_time: "Verbleibende Zeit",
    average_speed: "Durchschnittsgeschwindigkeit",
    input_tokens: "Eingabe-Token",
    reasoning_tokens: "Denk-Token",
    output_tokens: "Ausgabe-Token",
    active_requests: "Aktive Aufgaben",
  },
  feedback: {
    stats_refresh_failed:
      "Die Übersetzungsstatistik des Projekts konnte nicht aktualisiert werden …",
    done: "Übersetzung abgeschlossen …",
    stopped: "Übersetzung gestoppt …",
    ended: "Übersetzung beendet …",
    retry_exhausted:
      "{count} Einträge waren auch nach mehreren Versuchen nicht erfolgreich und wurden übersprungen …",
    keys_retry_wait:
      "API-Fehler. Automatischer Neuversuch in {seconds} Sekunden. Bisher {count} Neuversuche …",
    keys_retry_running: "API-Fehler. Erneuter Versuch läuft …",
    start_failed: "Fehler beim Starten der Übersetzungsaufgabe …",
    stop_failed: "Stapelaufgaben konnten nicht gestoppt werden …",
    reset_all_failed: "Fehler beim Zurücksetzen des gesamten Übersetzungsfortschritts …",
  },
  confirm: {
    reset_all_description:
      "Übersetzungsfortschritt für das gesamte Projekt wirklich zurücksetzen …?",
    stop_description: "Aktuelle Stapelaufgaben stoppen …?",
  },
  action: { stop: "Stoppen" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
