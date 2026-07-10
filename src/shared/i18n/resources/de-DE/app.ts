import { zh_cn_app } from "../zh-CN/app";
import { LANGUAGE_DISPLAY_NAMES } from "../../../../domain/language";
import type { LocaleMessageSchema } from "../../types";

export const de_de_app = {
  aria: {
    toggle_navigation: "Navigation umschalten",
  },
  metadata: {
    app_name: "LinguaGacha",
  },
  action: {
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    close: "Schließen",
    reset: "Zurücksetzen",
    skip: "Überspringen",
    overwrite: "Überschreiben",
    replace: "Ersetzen",
    loading: "Wird geladen",
    select_file: "Datei auswählen",
    select_folder: "Ordner auswählen",
  },
  feedback: {
    save_success: "Gespeichert …",
    no_valid_data: "Keine gültigen Daten …",
    update_failed: "Aktualisierung fehlgeschlagen …",
    project_settings_aligned: "Projekteinstellungen von aktuellen Einstellungen übernommen …",
  },
  error_boundary: {
    eyebrow: "Renderer-Laufzeit",
    title: "Seiten-Laufzeitfehler",
    description:
      "Dieses Fenster wurde in die geschützte Ansicht gewechselt, und die Fehlerdetails wurden in die Protokolle geschrieben.",
  },
  project_settings_alignment: {
    field: {
      source_language: "Quellsprache",
      target_language: "Zielsprache",
      mtool_optimizer_enable: "MTool-Optimierer",
      skip_duplicate_source_text_enable: "Doppelten Quelltext überspringen",
    },
  },
  close_confirm: {
    description: "Anwendung wirklich beenden …?",
  },
  quality_rule_import: {
    duplicate_description:
      "{COUNT} doppelte Regeln wurden erkannt. Wählen Sie, wie damit umgegangen werden soll …?",
  },
  update: {
    confirm_description: "LinguaGacha v{VERSION} ist verfügbar. Update herunterladen …?",
    restart_confirm: "Neustarten und aktualisieren",
    launching: "Wird verarbeitet …",
  },
  system_proxy: {
    startup_notice: "System-Proxy-Einstellung erkannt - {PROXY}",
  },
  drop: {
    multiple_unavailable: "Es kann nur eine Datei gleichzeitig abgelegt werden",
    unavailable:
      "Der lokale Pfad der abgelegten Datei ist derzeit nicht verfügbar. Bitte verwenden Sie stattdessen die Dateiauswahl.",
    import_here: "Zum Importieren der Regeldatei loslassen",
  },
  toggle: {
    disabled: "AUS",
    enabled: "AN",
  },
  drag: {
    enabled: "Zum Neuanordnen ziehen",
    disabled: "Ziehen deaktiviert",
  },
  language: Object.fromEntries(
    Object.entries(LANGUAGE_DISPLAY_NAMES).map(([code, names]) => [code, names.de]),
  ) as Record<keyof typeof LANGUAGE_DISPLAY_NAMES, string>,
  navigation_action: {
    theme: "Design",
    switch_theme: "Design wechseln",
    toggle_lg_base_font: "Schriftart wechseln",
    language: "Sprache",
    logs: "Protokolle",
  },
  profile: {
    status: "Ciallo～(∠・ω< )⌒✮",
    status_tooltip: "GitHub-Repository öffnen",
    update_available: "Neue Version herunterladen …!",
    update_available_tooltip: "Update-Bestätigungsdialog öffnen",
  },
  prompt: {
    builder_control_character_samples: "Steuerzeichen-Beispiele:",
    builder_glossary_header:
      "Glossar <Originalbegriff> -> <Übersetzter Begriff> #<Begriffsinformation>:",
    builder_input: "Eingabe:",
    builder_preceding_context: "Vorhergehender Kontext:",
  },
  translation_export: {
    directory: {
      translated: "Übersetzung",
      bilingual: "Übersetzung_Zweisprachig",
    },
  },
  native_file_filter: {
    project: "LinguaGacha-Projekt",
    supported_json_xlsx_files: "Unterstützte Dateien (*.json *.xlsx)",
    json_files: "JSON-Dateien (*.json)",
    excel_files: "Excel-Dateien (*.xlsx)",
    supported_txt_files: "Unterstützte Dateien (*.txt)",
  },
  error: {
    request: {
      validation_failed: {
        message: "Die Anfrageparameter sind ungültig …",
      },
      invalid_json: {
        message: "Das Anfrage-JSON ist ungültig …",
      },
      route_not_found: {
        message: "Die API-Route existiert nicht …",
      },
    },
    project: {
      not_loaded: {
        message: "Kein Projekt geladen …",
        action: "Öffnen oder erstellen Sie zuerst ein Projekt …",
      },
      not_found: {
        message: "Die Projektdatei existiert nicht …",
        action:
          "Stellen Sie sicher, dass die Projektdatei sich noch an ihrem ursprünglichen Speicherort befindet …",
      },
    },
    file: {
      not_found: {
        message: "Die Datei existiert nicht …",
        action:
          "Stellen Sie sicher, dass die Datei sich noch an ihrem ursprünglichen Speicherort befindet …",
      },
      unsupported_format: {
        message: "Dieses Dateiformat wird nicht unterstützt …",
        action: "Wählen Sie eine von LinguaGacha unterstützte Quelldatei …",
      },
      parse_failed: {
        message: "Dateiinhalt-Analyse fehlgeschlagen …",
        action:
          "Stellen Sie sicher, dass die Datei vollständig ist, oder importieren Sie eine unbeschädigte Originaldatei …",
      },
      invalid_structure: {
        message: "Die Dateistruktur entspricht nicht dem erwarteten Format …",
        action:
          "Stellen Sie sicher, dass die Datei von der erwarteten Quelle stammt, oder exportieren Sie sie erneut …",
      },
      io_failed: {
        message: "Datei-Lese- oder Schreibvorgang fehlgeschlagen …",
      },
    },
    database: {
      conflict: {
        message:
          "Datenbank-Schreibkonflikt. Bitte aktualisieren Sie die Daten und versuchen Sie es erneut …",
        action: "Aktuelle Daten aktualisieren und erneut senden …",
      },
    },
    data: {
      revision_conflict: {
        message:
          "Die Datenversion hat sich geändert. Bitte aktualisieren Sie die Daten und versuchen Sie es erneut …",
        action: "Aktuelle Daten aktualisieren und erneut senden …",
      },
    },
    task: {
      busy: {
        message: "Eine Hintergrundaufgabe wird ausgeführt. Bitte versuchen Sie es später erneut …",
        action:
          "Warten Sie, bis die aktuelle Aufgabe abgeschlossen ist, oder stoppen Sie sie zuerst …",
      },
    },
    model: {
      not_found: {
        message: "Die Modellkonfiguration existiert nicht …",
        action: "Wählen Sie eine Modellkonfiguration erneut aus …",
      },
      provider_failed: {
        message:
          "Die Modellservice-Anfrage ist fehlgeschlagen. Bitte überprüfen Sie die API-Einstellungen …",
        action: "Überprüfen Sie die Modell-URL, den API-Schlüssel und den Anbieterstatus …",
      },
    },
    worker: {
      failed: {
        message: "Der Hintergrundausführungskanal ist fehlgeschlagen …",
      },
      execution_failed: {
        message: "Die Hintergrundaufgabe ist fehlgeschlagen …",
      },
    },
    runtime: {
      capability_missing: {
        message: "Der aktuellen Laufzeitumgebung fehlt eine erforderliche Fähigkeit …",
      },
      disposed: {
        message: "Die Laufzeitressource wurde freigegeben …",
      },
      cancelled: {
        message: "Der Vorgang wurde abgebrochen …",
      },
      internal_invariant: {
        message: "Interner Zustandsfehler …",
      },
    },
    language: {
      invalid_target_language: {
        message: "Die Zielsprache ist ungültig …",
      },
      unsupported_all_target_language: {
        message: "Die Zielsprache kann nicht Alle sein …",
      },
      unknown_source_language_code: {
        message: "Der Quellsprachcode ist ungültig …",
      },
    },
    quality: {
      unknown_rule_type: {
        message: "Der Qualitätsregeltyp ist ungültig …",
      },
      unsupported_rule_meta: {
        message: "Die Qualitätsregeleinstellung ist ungültig …",
      },
    },
    prompt: {
      unknown_prompt_type: {
        message: "Der Prompt-Typ ist ungültig …",
      },
    },
    desktop: {
      missing_backend_api_base_url: {
        message: "Backend-API-URL ist nicht konfiguriert …",
      },
      backend_api_unavailable: {
        message: "Backend-API ist nicht verfügbar …",
      },
      backend_metadata_unavailable: {
        message: "Backend-Metadaten sind nicht verfügbar …",
      },
      event_stream_failed: {
        message: "Ereignisstream-Verbindung fehlgeschlagen …",
      },
      http_error: {
        message: "Anfrage fehlgeschlagen: {PATH} …",
      },
      network_failed: {
        message: "Netzwerkanfrage fehlgeschlagen: {PATH} …",
      },
      timeout: {
        message: "Anfrage-Zeitüberschreitung: {PATH} …",
      },
    },
  },
  diagnostic: {
    api_gateway: {
      direct_route_failed: "API Gateway-Direkt-Routing fehlgeschlagen …",
    },
    default_preset: {
      config_normalize_failed:
        "Fehler beim Normalisieren der Standard-Voreinstellungskonfiguration: {CONFIG_PATH} …",
      prompt_load_failed: "Fehler beim Laden der Standard-Prompt-Voreinstellung …",
      quality_rule_load_failed: "Fehler beim Laden der Standard-Qualitätsregel-Voreinstellung …",
      value_normalize_failed:
        "Fehler beim Normalisieren des Standard-Voreinstellungswerts: {PRESET_DIRECTORY} -> {VALUE} …",
    },
    file_export: {
      open_output_folder_failed: "Fehler beim Öffnen des Ausgabeordners …",
      translation_failed: "Fehler beim Erstellen der Übersetzungsdateien …",
      write_file_failed: "Dateischreiben fehlgeschlagen …",
    },
    lifecycle: {
      app_start_failed: "LinguaGacha konnte nicht gestartet werden …",
      backend_gateway_start_failed: "Backend-/Gateway-Start fehlgeschlagen …",
      main_fatal_uncaught:
        "Electron-Hauptprozess hat eine unbehandelte schwerwiegende Ausnahme abgefangen …",
    },
    migration: {
      path_failed: "Fehler beim Migrieren des Pfads: {SOURCE_PATH} -> {DESTINATION_PATH} …",
    },
    renderer: {
      main_frame_load_failed: "Renderer-Hauptframe konnte nicht geladen werden …",
      process_exited: "Renderer-Prozess beendet …",
      reported_error: "Renderer hat einen Frontend-Zustandsfehler erfasst …",
      subframe_load_failed: "Renderer-Unterframe konnte nicht geladen werden …",
      window_unresponsive: "Fenster reagiert nicht mehr …",
    },
  },
  log: {
    analysis_task_no_terms: "Keine Begriffe extrahiert",
    analysis_task_result: "Analyseergebnis:",
    analysis_task_source_texts: "Analyse-Eingabe:",
    api_gateway_started: "API Gateway gestartet - {BASE_URL}",
    api_test_fail: "API-Test fehlgeschlagen …",
    api_test_key: "Teste Schlüssel:",
    api_test_messages: "Aufgaben-Prompts:",
    api_test_result:
      "Insgesamt {COUNT} APIs getestet, {SUCCESS} erfolgreich, {FAILURE} fehlgeschlagen …",
    api_test_result_failure: "Fehlgeschlagene Schlüssel:",
    api_test_response_result: "Modellantwort:",
    api_test_timeout: "Anfrage-Zeitüberschreitung ({SECONDS}s)",
    api_test_token_info: "Aufgabenzeit {TIME} Sekunden, Eingabe-Token {PT}, Ausgabe-Token {CT}",
    app_version: "LinguaGacha v{VERSION} …",
    system_proxy_startup_detected: "System-Proxy-Einstellung erkannt - {PROXY}",
    default_preset_loaded: "Standard-Voreinstellungen automatisch geladen: {NAMES} …",
    engine_api_model: "API-Modell",
    engine_api_name: "API-Name",
    engine_api_url: "API-URL",
    engine_task_done: "Aufgabe abgeschlossen …",
    engine_task_exception: "Aufgabe fehlgeschlagen …",
    engine_task_fail:
      "Aufgabe konnte nicht abgeschlossen werden, einige Daten bleiben unbearbeitet. Bitte überprüfen Sie die Ergebnisse …",
    engine_task_rule_analysis: "Regelanalyse:",
    engine_task_thinking_process: "Denkprozess:",
    engine_task_stop: "Aufgabe gestoppt …",
    engine_task_success:
      "Aufgabenzeit {TIME} Sekunden, {LINES} Textzeilen, Eingabe-Token {PT}, Ausgabe-Token {CT}",
    generate_translation_done: "Übersetzungsdateien gespeichert unter {PATH} …",
    generate_translation_start: "Übersetzungsdateien werden erstellt …",
    response_checker_fail_data: "Datenstrukturfehler",
    response_checker_fail_degradation: "Verschlechterung aufgetreten",
    response_checker_fail_line_count: "Zeilenanzahl stimmt nicht überein",
    response_checker_fail_request: "Modellanfrage fehlgeschlagen",
    request_failed_retry: "Modellanfrage fehlgeschlagen, wird automatisch wiederholt …",
    response_checker_fail_timeout: "Netzwerkanfrage-Zeitüberschreitung",
    response_checker_line_error_empty_line: "Leere Zeile",
    system_closed_dropped:
      "Protokollsystem ist heruntergefahren; neues Protokoll wird verworfen: {MESSAGE}",
    translation_response_check_fail: "Datenfehler, wird automatisch wiederholt, Grund: {REASON}",
    translation_response_check_fail_all:
      "Alle übersetzten Textqualitätsprüfungen fehlgeschlagen, wird automatisch aufgeteilt und wiederholt, Grund: {REASON}",
    translation_response_check_fail_part:
      "Teilweise übersetzte Textqualitätsprüfung fehlgeschlagen, wird automatisch aufgeteilt und wiederholt, Grund: {REASON}",
    translation_task_result: "Übersetzungsergebnis:",
    translation_task_status_info:
      "Aufteilung: {SPLIT} | Wiederholung: {RETRY} | Aufgabenlängen-Schwellenwert: {THRESHOLD}",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_app>;
