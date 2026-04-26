import { zh_cn_log_window_page } from "@/i18n/resources/zh-CN/log-window-page";
import type { LocaleMessageSchema } from "@/i18n/types";

export const en_us_log_window_page = {
  title: "Logs",
  window_title: "Logs",
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
    autoscroll: "Auto Scroll",
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
    maximize: "Maximize",
    minimize: "Minimize",
  },
  feedback: {
    stream_failed: "Log stream connection failed.",
  },
} satisfies LocaleMessageSchema<typeof zh_cn_log_window_page>;
