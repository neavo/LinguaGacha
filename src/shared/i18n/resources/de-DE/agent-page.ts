export const de_de_agent_page = {
  title: "Agent",
  thinking: "Denkprozess",
  diagram: {
    label: "Diagramm",
    render_failed: "Diagramm konnte nicht gerendert werden. Der Mermaid-Quelltext wird angezeigt.",
  },
  image: { omitted: "Bild ausgelassen" },
  loading: "Sitzung wird wiederhergestellt …",
  empty: {
    message: "「Aibō」, was machen wir als Nächstes  ( •̀ ᗜ •́ )つ▱",
  },
  input: {
    placeholder: "Aufgabe beschreiben oder mit @ eine Fähigkeit wählen …",
    hint: "Enter zum Senden · Shift + Enter für eine neue Zeile",
  },
  action: { send: "Senden", stop: "Stoppen", new_task: "Neue Aufgabe" },
  confirm: { new_task: "Wirklich eine neue Unterhaltung starten …?" },
  status: { running: "Wird verarbeitet", success: "Abgeschlossen", error: "Fehlgeschlagen" },
  round: { running: "Wird seit {duration} verarbeitet", ended: "Verarbeitet in {duration}" },
  error: "Anfrage fehlgeschlagen. Bitte erneut versuchen.",
} as const;
