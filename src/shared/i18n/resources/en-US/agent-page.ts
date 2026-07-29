export const en_us_agent_page = {
  title: "Agent",
  conversation_label: "Agent conversation",
  loading: "Restoring session …",
  empty: {
    title: "Start with a clear task",
    description:
      "Type @ to select Glossary Audit. The Agent verifies every context and asks before writing.",
  },
  role: { agent: "Agent", user: "You" },
  input: {
    label: "Message to Agent",
    placeholder: "Describe a task, or type @ to select a capability …",
    hint: "Enter to send · Shift + Enter for a new line",
  },
  action: { send: "Send", stop: "Stop", reset: "New chat" },
  state: {
    idle: "Idle",
    running: "Working",
    complete: "Complete",
  },
  skill: {
    label: "Capabilities",
    prompt: "Perform the task described by the selected capability.",
    clear: "Remove capability",
  },
  tool: { label: "Tool status", running: "Running", success: "Complete", error: "Failed" },
  error: "Request failed. Try again.",
} as const;
