import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const en_us_batch_translation = {
  menu: {
    progress: "Progress",
    tooltip: "Translate source text into the target language",
  },
  summary: {
    translation: { running: "Batch translating", stopping: "Stopping batch translation" },
    request: { running: "Running batch requests", stopping: "Stopping batch requests" },
    mixed: { running: "Running batch tasks", stopping: "Stopping batch tasks" },
    empty: "Idle",
    stopping: "Stopping",
    detail_tooltip: "Click to view details",
  },
  detail: {
    waveform_title: "Real-time speed",
    provider: "Provider",
    custom_thinking: "Custom",
    elapsed_time: "Elapsed time",
    remaining_time: "Remaining time",
    average_speed: "Average speed",
    input_tokens: "Input tokens",
    reasoning_tokens: "Reasoning tokens",
    output_tokens: "Output tokens",
    active_requests: "Active tasks",
  },
  feedback: {
    stats_refresh_failed: "Failed to refresh project translation statistics …",
    done: "Translation completed …",
    stopped: "Translation stopped …",
    ended: "Translation ended …",
    retry_exhausted: "{count} items still failed after repeated retries and were skipped …",
    keys_retry_wait: "API error. Automatic retry in {seconds} seconds. Retried {count} times …",
    keys_retry_running: "API error. Retrying …",
    start_failed: "Failed to start the translation task …",
    stop_failed: "Failed to stop batch tasks …",
    reset_all_failed: "Failed to reset all translation progress …",
  },
  confirm: {
    reset_all_description: "Confirm resetting the translation progress for the entire project …?",
    stop_description: "Stop the current batch tasks …?",
  },
  action: { stop: "Stop" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
