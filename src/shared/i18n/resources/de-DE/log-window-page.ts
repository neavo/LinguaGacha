import { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_log_window_page = {
  title: "Protokolle",
  window_title: "Protokolle",
  level: {
    all: "Alle",
    debug: "Debug",
    info: "Info",
    warning: "Warnung",
    error: "Fehler",
    fatal: "Fatal",
  },
  fields: {
    time: "Zeit",
    message: "Nachricht",
  },
  action: {
    autoscroll: "Auto-Scroll",
  },
  search: {
    placeholder: "Abfrage …",
    clear: "Löschen",
    regex: "Regex",
    regex_tooltip: "Regex-Modus - {STATE}",
    regex_invalid: "Ungültiger regulärer Ausdruck.",
    scope: {
      label: "Bereich",
      tooltip: "Protokollbereich - {STATE}",
    },
  },
  detail: {
    title: "Detail",
    maximize: "Maximieren",
    minimize: "Minimieren",
    empty: "Wählen Sie einen Protokolleintrag aus, um Details anzuzeigen.",
    loading: "Protokolldetail wird geladen …",
    unavailable:
      "Das Protokolldetail wurde aus dem aktuellen Prozessspeicher entfernt. Bitte überprüfen Sie die Protokolldatei.",
    failed: "Fehler beim Laden des Protokolldetails.",
  },
  feedback: {
    stream_failed: "Verbindung zum Protokollstream fehlgeschlagen.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
