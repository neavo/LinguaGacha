export const de_de_agent_page = {
  title: "Agent",
  conversation_label: "Agent-Unterhaltung",
  loading: "Sitzung wird wiederhergestellt …",
  empty: {
    title: "Mit einer klaren Aufgabe beginnen",
    description:
      "Mit @ die Glossarprüfung wählen. Der Agent prüft alle Kontexte und fragt vor dem Schreiben nach.",
  },
  role: { agent: "Agent", user: "Du" },
  input: {
    label: "Nachricht an den Agent",
    placeholder: "Aufgabe beschreiben oder mit @ eine Fähigkeit wählen …",
    hint: "Enter zum Senden · Shift + Enter für eine neue Zeile",
  },
  action: { send: "Senden", stop: "Stoppen", reset: "Neuer Chat" },
  state: {
    idle: "Bereit",
    running: "In Arbeit",
    complete: "Abgeschlossen",
  },
  skill: {
    label: "Fähigkeiten",
    prompt: "Führe die von der ausgewählten Fähigkeit beschriebene Aufgabe aus.",
    clear: "Fähigkeit entfernen",
  },
  tool: { label: "Werkzeugstatus", running: "Läuft", success: "Fertig", error: "Fehlgeschlagen" },
  error: "Anfrage fehlgeschlagen. Bitte erneut versuchen.",
} as const;
