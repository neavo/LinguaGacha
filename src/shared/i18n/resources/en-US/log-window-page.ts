import { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_log_window_page = {
  title: "Logs",
  level: {
    all: "All",
    debug: "Debug",
    info: "Info",
    warning: "Warning",
    error: "Error",
    fatal: "Fatal",
  },
  fields: {
    time: "Time",
    message: "Message",
  },
  action: {
    return_to_top: "Back to Top",
  },
  search: {
    placeholder: "Query …",
    clear: "Clear",
    regex: "Regex",
    regex_tooltip: "Regex Mode - {STATE}",
    regex_invalid: "Invalid regular expression.",
    scope: {
      label: "Scope",
      tooltip: "Log Scope - {STATE}",
    },
  },
  detail: {
    title: "Detail",
    previous: "Previous Entry",
    next: "Next Entry",
    maximize: "Maximize",
    minimize: "Minimize",
    empty: "Select a log entry to view details.",
    loading: "Loading log detail …",
    unavailable:
      "Log detail has been released from current process memory. Please check the log file.",
    failed: "Failed to load log detail.",
    content: {
      source_text: "Source",
      translated_text: "Translation",
      source_term: "Source Term",
      translated_term: "Translated Term",
      term_info: "Note",
      error: "Error Details",
    },
  },
  feedback: {
    stream_failed: "Log stream connection failed.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
