import { zh_cn_batch_translation } from "../zh-CN/batch-translation";
import type { LocaleMessageSchema } from "../../types";
export const en_us_batch_translation = {
  menu: {
    progress: "Progress",
    tooltip: "Translate source text into the target language",
  },
  summary: {
    done: "Finished",
    empty: "Idle",
    stopping: "Stopping",
    detail_tooltip: "Click to view details",
    running: "Processing",
  },
  detail: {
    provider: "Provider",
    elapsed_time: "Elapsed time",
    remaining_time: "Remaining time",
    average_speed: "Average speed",
    input_tokens: "Input tokens",
    reasoning_tokens: "Reasoning tokens",
    output_tokens: "Output tokens",
    waveform_title: "Real-time speed",
    metrics_title: "Statistics",
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
    refresh_failed: "Failed to refresh the translation task …",
    start_failed: "Failed to start the translation task …",
    stop_failed: "Failed to stop the translation task …",
    reset_all_failed: "Failed to reset all translation progress …",
  },
  confirm: {
    reset_all_description: "Confirm resetting the translation progress for the entire project …?",
    stop_description: "Confirm stopping the current task …?",
  },
  action: { stop: "Stop" },
} satisfies LocaleMessageSchema<typeof zh_cn_batch_translation>;
