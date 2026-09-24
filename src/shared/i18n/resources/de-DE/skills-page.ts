export const de_de_skills_page = {
  title: "Skills",
  builtin: "Integrierte Skills",
  user: "Benutzer-Skills",
  empty: "Keine Skills",
  editor: {
    back: "Zurück zu Skills",
    files: "Dateien",
    create_file: "Neue Datei",
    create_directory: "Neuer Ordner",
    rename: "Umbenennen",
    move: "Verschieben nach…",
    delete: "Löschen",
    actions: "Dateiaktionen",
    destination: "Zielordner",
    delete_confirm:
      "„{PATH}“ samt Inhalt löschen? Ungespeicherte Änderungen werden ebenfalls verworfen.",
    modified: "Geändert",
    saving: "Wird gespeichert",
    saved: "Gespeichert",
    failed: "Speichern fehlgeschlagen",
    invalid: "Eingabe erforderlich",
    discard: "Änderungen verwerfen und neu laden",
    overwrite: "Datei überschreiben",
    conflict: "Die Datei wurde extern geändert. Neu laden oder ausdrücklich überschreiben.",
    invalid_name:
      "Maximal 64 Kleinbuchstaben, Ziffern und einzelne Bindestriche. Anfang und Ende müssen alphanumerisch sein.",
    invalid_description: "Eine einzeilige Beschreibung mit maximal 1024 Zeichen eingeben.",
    unsupported:
      "Diese Datei ist kein UTF-8-Text oder größer als 2 MB und kann hier nicht bearbeitet werden.",
  },
  feedback: {
    load_failed: "Skills konnten nicht geladen werden …",
    save_failed: "Skill-Einstellungen konnten nicht gespeichert werden …",
  },
} as const;
