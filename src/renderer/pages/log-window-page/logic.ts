import type { LogEvent, LogLevel } from "@/app/desktop/desktop-api";
import { LOG_WINDOW_EVENT_CAPACITY } from "@shared/log";

export type LogLevelFilter = "all" | LogLevel;

function normalize_log_event_message(event: LogEvent): LogEvent {
  return {
    ...event,
    message: event.message.trim(),
  };
}

/**
 * 批量合并日志窗口事件，保持 trim、去重、连续空日志折叠和容量裁剪在同一条线性路径内完成
 */
export function append_log_events(
  events: LogEvent[],
  next_events: readonly LogEvent[],
): LogEvent[] {
  const appended_events = events.slice();
  const existing_ids = new Set(appended_events.map((event) => event.id));

  for (const event of next_events) {
    const normalized_event = normalize_log_event_message(event);
    if (existing_ids.has(normalized_event.id)) {
      continue;
    }

    const last_event = appended_events.at(-1);
    if (normalized_event.message === "" && last_event?.message === "") {
      appended_events[appended_events.length - 1] = normalized_event;
      existing_ids.delete(last_event.id);
    } else {
      appended_events.push(normalized_event);
    }
    existing_ids.add(normalized_event.id);
  }

  if (appended_events.length <= LOG_WINDOW_EVENT_CAPACITY) {
    return appended_events;
  }

  return appended_events.slice(appended_events.length - LOG_WINDOW_EVENT_CAPACITY);
}

export function sort_log_events_latest_first(events: LogEvent[]): LogEvent[] {
  return [...events].sort((left_event, right_event) => {
    return right_event.sequence - left_event.sequence;
  });
}

export function compress_log_message_text(message: string): string {
  if (message.trim() === "") {
    return "(blank)";
  }

  const compressed_message = message.replace(/\r\n|\r|\n/gu, " ↵ ");
  return compressed_message;
}

export function filter_log_events(args: {
  events: LogEvent[];
  level_filter: LogLevelFilter;
  keyword: string;
  is_regex?: boolean;
}): LogEvent[] {
  const normalized_keyword = args.keyword.trim();
  const regex =
    args.is_regex === true && normalized_keyword !== ""
      ? build_log_filter_regex(normalized_keyword)
      : null;

  return args.events.filter((event) => {
    if (args.level_filter !== "all" && event.level !== args.level_filter) {
      return false;
    }

    if (normalized_keyword === "") {
      return true;
    }

    const search_text = [
      event.level,
      event.message,
      event.sequence.toString(),
      event.created_at,
    ].join("\n");

    if (args.is_regex === true) {
      return regex === null ? true : regex.test(search_text);
    }

    return search_text.toLowerCase().includes(normalized_keyword.toLowerCase());
  });
}

function build_log_filter_regex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "iu");
  } catch {
    return null;
  }
}

export function format_log_timestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  const second = date.getSeconds().toString().padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
