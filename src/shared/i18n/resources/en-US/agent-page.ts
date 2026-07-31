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
  context_usage: "Context {percent} · {used} / {total}",
  action: { send: "Send", stop: "Stop", new_task: "New task" },
  confirm: { new_task: "Confirm starting a new conversation task …?" },
  status: { running: "Processing", success: "Completed", error: "Failed" },
  round: { running: "Processing for {duration}", ended: "Processed in {duration}" },
  error: "Request failed. Try again.",
} as const;
