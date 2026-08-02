export const en_us_agent_page = {
  title: "AGENT",
  thinking: "Thinking",
  thinking_active: "Thinking",
  diagram: {
    label: "Diagram",
    render_failed: "Diagram rendering failed. Mermaid source is shown.",
  },
  image: { omitted: "Image omitted" },
  loading: "Restoring session …",
  empty: {
    message: "「Aibō」，what shall we do next  ( •̀ ᗜ •́ )つ▱",
    suggestions: {
      capabilities: "Tell me about your capabilities",
      glossary_audit: "Please audit my glossary",
    },
  },
  input: {
    placeholder: "Describe a task, or type @ to select a capability …",
    hint: "Enter to send · Shift + Enter for a new line",
  },
  context_usage: "Context {percent} · {used} / {total}",
  context_usage_warning:
    "Approaching the context limit; history will be compacted automatically at the threshold",
  action: {
    send: "Send",
    sending: "Sending",
    stop: "Stop",
    stopping: "Stopping",
    new_task: "New Task",
    retry: "Retry",
    return_latest: "Return to latest",
  },
  confirm: { new_task: "Confirm starting a new conversation task …?" },
  status: { running: "Processing", success: "Completed", error: "Failed", stopped: "Stopped" },
  round: {
    running: "Processing for {duration}",
    success: "Completed · {duration}",
    error: "Failed · {duration}",
    stopped: "Stopped · {duration}",
  },
  error: {
    restore: "The session could not be restored. Try again.",
    connection: "Connection interrupted. Waiting to reconnect.",
    send: "Message could not be sent. Your draft was preserved.",
    stop: "The task could not be stopped. Try again.",
    reset: "A new task could not be created. Try again.",
  },
  unavailable: {
    restoring: "Restoring the session",
    runtime_busy: "Another task is running",
    settling: "Finishing the current task",
  },
} as const;
