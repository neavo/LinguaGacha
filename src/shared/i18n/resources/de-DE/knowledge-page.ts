export const de_de_knowledge_page = {
  title: "Wissen",
  builtin: "Integrierte Skills",
  user: "Benutzer-Skills",
  knowledge: "Projektwissen",
  empty: {
    user: "Keine Benutzer-Skills",
  },
  readonly: "Schreibgeschützt",
  personality_description: "Persönlichkeitseinstellungen des intelligenten Assistenten",
  knowledge_description:
    "Mit dem Projekt gespeicherte Einstellungen, Konventionen und Fortschritte",
  install: {
    title: "Installationsanleitung",
    description: "Skill-Link an AGENT senden und um die Installation des Skills bitten",
    placeholder: "[Skill-Link hier eingeben]",
    request: "Bitte installiere diesen Skill für mich: {PLACEHOLDER}",
  },
  knowledge_create: {
    title: "Erfassungsanleitung",
    description:
      "AGENT die festzuhaltenden Einstellungen, Vereinbarungen oder Erkenntnisse mitteilen, daraus wird Projektwissen angelegt",
    placeholder: "[Hier beschreiben, was festgehalten werden soll]",
    request: "Bitte halte dies als Projektwissen fest: {PLACEHOLDER}",
  },
  editor: {
    save_failed: "Speichern fehlgeschlagen",
    reset: "Zurücksetzen",
    delete_skill_confirm: "Skill wirklich löschen …?",
    reset_skill_confirm: "Skill wirklich zurücksetzen …?",
    back: "Zurück zur Liste",
    files: "Dateien",
    create_file: "Neue Datei",
    create_directory: "Neuer Ordner",
    rename: "Umbenennen",
    delete: "Löschen",
    delete_file_confirm: "Datei wirklich löschen …?",
    delete_directory_confirm: "Ordner wirklich löschen …?",
    modified: "Geändert",
    saved: "Gespeichert",
    discard: "Änderungen verwerfen und neu laden",
    overwrite: "Datei überschreiben",
    conflict: "Versionskonflikt",
    invalid_name: "Einen Skill-Namen mit 1–64 Zeichen eingeben",
    invalid_description: "Eine Skill-Beschreibung eingeben",
    unsupported:
      "Diese Datei ist kein UTF-8-Text oder größer als 2 MB und kann hier nicht bearbeitet werden …",
  },
} as const;
