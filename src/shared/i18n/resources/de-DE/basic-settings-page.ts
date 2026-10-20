import { zh_cn_basic_settings_page } from "../zh-CN/basic-settings-page";
import type { LocaleMessageSchema } from "../../types";

export const de_de_basic_settings_page = {
  title: "Grundeinstellungen",
  fields: {
    source_language: {
      description: "Legt die Sprache des Eingabetexts fest",
    },
    target_language: {
      description: "Legt die Sprache des Ausgabetexts fest",
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
        "Maximale Antwortzeit in Sekunden. Ohne Antwort innerhalb dieser Frist gilt die Aufgabe als fehlgeschlagen.",
    },
    proxy: {
      title: "Ausgehender Proxy",
      description: "Gilt für Anfragen aus Übersetzung, Agent und App-Updates",
      protocol_label: "Protokoll",
      server_label: "Proxy-Server",
      address_label: "Adresse",
      port_label: "Port",
      host_placeholder: "proxy.example.com",
      server_description:
        "Nur Hostname oder IP eingeben, ohne http:// und Port; IPv6 in Klammern, z. B. [::1]",
      port_placeholder: "Port",
      auth_label: "Authentifizierung (optional)",
      username_placeholder: "Benutzername",
      auth_description:
        "Benutzername und Passwort werden im Klartext auf diesem Rechner gespeichert und gelten nur für diesen Proxy",
      password_placeholder: "Passwort",
      save: "Proxy-Einstellungen speichern",
      test: "Verbindung testen",
    },
  },
  status: {
    apply_failed:
      "Proxy-Einstellungen konnten nicht angewendet werden; Anfragen nutzen den Systemproxy: {REASON}",
    manual_incomplete:
      "Der manuelle Proxy ist unvollständig oder ungültig; Anfragen nutzen den Systemproxy",
    socks5_auth:
      "SOCKS5-Authentifizierung ist für App-Updates nicht verfügbar; Updates verwenden den Systemproxy",
  },
  probe: {
    running: "Wird getestet …",
    succeeded: "Erfolgreich · {ELAPSED} ms",
    failed: "Fehlgeschlagen · {ELAPSED} ms: {REASON}",
    route: "· Verwendete Route {ROUTE}",
    route_failed: "· Routenauflösung fehlgeschlagen",
  },
  feedback: {
    proxy_host_invalid:
      "Die Adresse ist erforderlich und darf kein http://, keinen Port und keine Leerzeichen enthalten; IPv6 in Klammern",
    proxy_port_invalid: "Der Port muss eine ganze Zahl zwischen 1 und 65535 sein",
    proxy_username_required: "Benutzername ist erforderlich, wenn ein Passwort gesetzt ist",
    proxy_saved: "Proxy-Einstellungen gespeichert",
    proxy_test_failed: "Verbindungstest fehlgeschlagen",
    proxy_test_unsaved: "Änderungen vor dem Testen speichern",
    request_timeout_invalid:
      "Das Anfrage-Timeout muss eine Zahl innerhalb des gültigen Bereichs sein …",
    pick_directory_failed:
      "Ordnerauswahl fehlgeschlagen. Bitte wählen Sie das feste Speicherverzeichnis erneut aus …",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_basic_settings_page>;
