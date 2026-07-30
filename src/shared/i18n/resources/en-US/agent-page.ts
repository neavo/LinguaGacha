export const en_us_agent_page = {
  title: "Agent",
  thinking: "Thinking",
  diagram: {
    label: "Diagram",
    render_failed: "Diagram rendering failed. Mermaid source is shown.",
  },
  image: { omitted: "Image omitted" },
  loading: "Restoring session …",
  empty: {
    message: "「Aibō」，what shall we do next  ( •̀ ᗜ •́ )つ▱",
  },
  input: {
    placeholder: "Describe a task, or type @ to select a capability …",
    hint: "Enter to send · Shift + Enter for a new line",
  },
  action: { send: "Send", stop: "Stop" },
  round: { running: "Processing for {duration}", ended: "Processed in {duration}" },
  error: "Request failed. Try again.",
} as const;
