import { zh_cn_model_page } from "../zh-CN/model-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_model_page = {
  title: "Modellverwaltung",
  category: {
    preset: {
      title: "Voreingestellte Modelle",
      description: "Integrierte voreingestellte Modelle der Anwendung",
    },
    custom_google: {
      title: "Benutzerdefinierte Google-Modelle",
      description: "Benutzerdefinierte Modelle, kompatibel mit dem Google Gemini API-Format",
    },
    custom_openai: {
      title: "Benutzerdefinierte OpenAI-Modelle",
      description: "Benutzerdefinierte Modelle, kompatibel mit dem OpenAI API-Format",
    },
    custom_anthropic: {
      title: "Benutzerdefinierte Anthropic-Modelle",
      description: "Benutzerdefinierte Modelle, kompatibel mit dem Anthropic Claude API-Format",
    },
  },
  action: {
    activate: "Aktivieren",
    basic_settings: "Grundeinstellungen",
    task_settings: "Aufgabeneinstellungen",
    advanced_settings: "Erweiterte Einstellungen",
    delete: "Löschen",
    reset: "Zurücksetzen",
    add: "Hinzufügen",
    input: "Eingabe",
    fetch: "Abrufen",
    test: "Testen",
  },
  dialog: {
    selector: {
      loading: "Modellliste wird geladen …",
      search_placeholder: "Modelle filtern …",
      empty: "Keine gültigen Daten …",
    },
    model_id_input: {
      confirm: "Bestätigen",
    },
  },
  confirm: {
    delete: {
      description: "Modell wirklich löschen …?",
    },
    reset: {
      description: "Modell wirklich zurücksetzen …?",
    },
  },
  feedback: {
    refresh_failed:
      "Fehler beim Aktualisieren der Modellübersicht. Bitte versuchen Sie es später erneut",
    add_failed: "Fehler beim Hinzufügen des Modells. Bitte versuchen Sie es später erneut",
    update_failed:
      "Fehler beim Speichern der Modellkonfiguration. Bitte versuchen Sie es später erneut",
    reorder_failed:
      "Fehler beim Speichern der Modellreihenfolge. Bitte versuchen Sie es später erneut",
    delete_last_one: "In jeder Kategorie muss mindestens ein Modell verbleiben",
    reset_success: "Modell erfolgreich zurückgesetzt",
    json_format_error: "JSON-Formatfehler. Bitte geben Sie ein gültiges JSON-Objekt ein",
    selector_load_failed:
      "Fehler beim Laden der Modellliste. Bitte überprüfen Sie die API-Konfiguration",
    test_failed: "Fehler beim Testen des Modells. Bitte versuchen Sie es später erneut",
  },
  fields: {
    name: {
      title: "Modellname",
      description:
        "Geben Sie einen Modellnamen ein, der nur zur Anzeige innerhalb der Anwendung verwendet wird",
      placeholder: "Bitte Modellnamen eingeben …",
    },
    api_url: {
      title: "API-URL",
      description: "Geben Sie die API-URL ein und prüfen Sie, ob /v1 am Ende enthalten sein soll",
      placeholder: "Bitte API-URL eingeben …",
    },
    api_key: {
      title: "API-Schlüssel",
      description:
        "Geben Sie den API-Schlüssel ein, z.B. sk-d0daba12345678fd8eb7b8d31c123456, mehrere Schlüssel können für Polling eingegeben werden, ein Schlüssel pro Zeile",
      placeholder: "Bitte API-Schlüssel eingeben …",
    },
    model_id: {
      title: "Modellkennung",
      description: "Aktuelle Modellkennung: {MODEL}",
      placeholder: "Bitte Modellkennung eingeben …",
    },
    thinking: {
      title: "Denkstufe",
      description:
        "Konfigurieren Sie die Denkstufe, die Zeit und Kosten beeinflusst, klicken Sie auf das Fragezeichen für unterstützte Modelle",
      help_label: "Dokumentation zur Denkstufen-Unterstützung öffnen",
    },
    input_token_limit: {
      title: "Eingabe-Token-Limit",
      description: "Maximale Anzahl von Token, die für jede Aufgabeneingabe erlaubt sind",
    },
    output_token_limit: {
      title: "Ausgabe-Token-Limit",
      description:
        "Maximale Anzahl von Token, die für jede Aufgabenausgabe erlaubt sind, 0 = Automatisch",
    },
    rpm_limit: {
      title: "Anfragen pro Minute (RPM)",
      description:
        "Begrenzt, wie viele Anfragen dieses Modell pro Minute senden kann, 0 = Automatisch",
    },
    concurrency_limit: {
      title: "Gleichzeitigkeitslimit",
      description:
        "Begrenzt, wie viele Aufgaben dieses Modell gleichzeitig ausführen kann, 0 = Automatisch",
    },
    top_p: {
      title: "top_p",
      description: "Bitte seien Sie vorsichtig, ungültige Werte können Fehler verursachen",
    },
    temperature: {
      title: "temperature",
      description: "Bitte seien Sie vorsichtig, ungültige Werte können Fehler verursachen",
    },
    presence_penalty: {
      title: "presence_penalty",
      description: "Bitte seien Sie vorsichtig, ungültige Werte können Fehler verursachen",
    },
    frequency_penalty: {
      title: "frequency_penalty",
      description: "Bitte seien Sie vorsichtig, ungültige Werte können Fehler verursachen",
    },
    extra_headers: {
      title: "Benutzerdefinierte Anfrage-Header",
      description:
        "Bitte mit Vorsicht setzen, falsche Werte können zu ungewöhnlichen Ergebnissen oder Anfragefehlern führen",
      placeholder: 'Beispiel: {"Authorization": "Bearer xxx"}',
    },
    extra_body: {
      title: "Benutzerdefinierter Anfrage-Body",
      description:
        "Bitte mit Vorsicht setzen, falsche Werte können zu ungewöhnlichen Ergebnissen oder Anfragefehlern führen",
      placeholder: 'Beispiel: {"seed": 42}',
    },
  },
  thinking_level: {
    off: "Aus",
    low: "Niedrig",
    medium: "Mittel",
    high: "Hoch",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_model_page>;
