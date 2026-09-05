import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const en_us_batch_translation = {
  setup: {
    title: "Run batch translation",
    description: "Choose a provider for the batch translation task",
    current: "Use the current Agent provider",
    other: "Choose another provider",
  },
  menu: {
    progress: "Progress",
    tooltip: "Translate source text into the target language",
  },
  summary: {
    empty: "Idle",
    stopping: "Stopping",
    detail_tooltip: "Click to view details",
    running: "Translating",
  },
  detail: {
    provider: "Provider",
    elapsed_time: "Elapsed Time",
    remaining_time: "Remaining Time",
    average_speed: "Average Speed",
    input_tokens: "Input Tokens",
    reasoning_tokens: "Reasoning Tokens",
    output_tokens: "Output Tokens",
    waveform_title: "Real-time Speed",
    metrics_title: "Statistics",

    active_requests: "Real Time Tasks",
  },
  feedback: {
    done: "Completed …",
    stopped: "Stopped …",
    refresh_failed: "Failed to refresh the translation task.",
    start_failed: "Failed to start the translation task.",
    stop_failed: "Failed to stop the translation task.",
    reset_all_failed: "Failed to reset all translation progress.",
    reset_failed_failed: "Failed to reset failed translation entries.",
  },
  confirm: {
    reset_all_description: "Confirm resetting the translation progress for the entire project …?",
    reset_failed_description: "Confirm resetting failed translation entries …?",
    generate_description: "Confirm generating currently available translation files …?",
    stop_description: "Confirm stopping the current translation task …?",
  },
  action: { stop: "Stop" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
