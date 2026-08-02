export const de_de_agent_page = {
  title: "AGENT",
  thinking: "Denkprozess",
  thinking_active: "Denkt nach",
  diagram: {
    label: "Diagramm",
    render_failed: "Diagramm konnte nicht gerendert werden. Der Mermaid-Quelltext wird angezeigt.",
  },
  image: { omitted: "Bild ausgelassen" },
  loading: "Sitzung wird wiederhergestellt …",
  empty: {
    message: "「Aibō」, was machen wir als Nächstes  ( •̀ ᗜ •́ )つ▱",
    suggestions: {
      capabilities: "Stell mir deine Fähigkeiten vor",
      glossary_audit: "Bitte prüfe mein Glossar",
    },
  },
  input: {
    placeholder: "Aufgabe beschreiben oder mit @ eine Fähigkeit wählen …",
    hint: "Enter zum Senden · Shift + Enter für eine neue Zeile",
  },
  context_usage: "Kontext {percent} · {used} / {total}",
  context_usage_warning:
    "Das Kontextlimit wird erreicht; der Verlauf wird am Schwellenwert automatisch komprimiert",
  action: {
    send: "Senden",
    sending: "Wird gesendet",
    stop: "Stoppen",
    stopping: "Wird gestoppt",
    new_task: "Neue Aufgabe",
    retry: "Erneut versuchen",
    return_latest: "Zum neuesten Stand",
  },
  confirm: { new_task: "Wirklich eine neue Unterhaltung starten …?" },
  status: {
    running: "Wird verarbeitet",
    success: "Abgeschlossen",
    error: "Fehlgeschlagen",
    stopped: "Gestoppt",
  },
  round: {
    running: "Wird seit {duration} verarbeitet",
    success: "Abgeschlossen · {duration}",
    error: "Fehlgeschlagen · {duration}",
    stopped: "Gestoppt · {duration}",
  },
  error: {
    restore: "Die Sitzung konnte nicht wiederhergestellt werden. Bitte erneut versuchen.",
    connection: "Verbindung unterbrochen. Wiederverbindung wird abgewartet.",
    send: "Die Nachricht konnte nicht gesendet werden. Der Entwurf wurde beibehalten.",
    stop: "Die Aufgabe konnte nicht gestoppt werden. Bitte erneut versuchen.",
    reset: "Eine neue Aufgabe konnte nicht erstellt werden. Bitte erneut versuchen.",
  },
  unavailable: {
    restoring: "Sitzung wird wiederhergestellt",
    runtime_busy: "Eine andere Aufgabe wird ausgeführt",
    settling: "Aktuelle Aufgabe wird beendet",
  },
} as const;
