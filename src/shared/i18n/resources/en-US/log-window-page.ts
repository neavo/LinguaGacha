import { zh_cn_log_window_page } from "../zh-CN/log-window-page";
import type { LocaleMessageSchema } from "../../types";

export const en_us_log_window_page = {
  title: "Logs",
  history: {
    date: "Log date",
    expired: "Logs for this date have been removed",
  },
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
    placeholder: "Search loaded logs…",
    clear: "Clear",
    regex: "Regex",
    regex_tooltip_label: "Regex Mode",
    regex_invalid: "Invalid regular expression",
    scope: {
      label: "Scope",
      tooltip_label: "Log Scope",
    },
  },
  detail: {
    title: "Detail",
    previous: "Previous Entry",
    next: "Next Entry",
    maximize: "Maximize",
    minimize: "Minimize",
    empty: "Select a log entry to view details …",
    loading: "Loading log detail …",
    unavailable:
      "Log detail has been released from current process memory. Please check the log file …",
    content: {
      source_text: "Source",
      translated_text: "Translation",
      error: "Error Details",
    },
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
