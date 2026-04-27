import type { LogEvent, LogLevel } from "@/app/desktop-api";

export type LogLevelFilter = "all" | LogLevel;
export const LOG_WINDOW_EVENT_LIMIT = 1000;

export function normalize_log_event_message(event: LogEvent): LogEvent {
  return {
    ...event,
    message: event.message.trim(),
  };
}

export function append_log_event(events: LogEvent[], event: LogEvent): LogEvent[] {
  const normalized_event = normalize_log_event_message(event);

  if (events.some((previous_event) => previous_event.id === normalized_event.id)) {
    return events;
  }

  const last_event = events.at(-1);
  if (normalized_event.message === "" && last_event?.message === "") {
    return [...events.slice(0, -1), normalized_event];
  }

  return [...events, normalized_event];
}

export function append_log_events(
  events: LogEvent[],
  next_events: readonly LogEvent[],
): LogEvent[] {
  let appended_events = events;

  for (const event of next_events) {
    appended_events = append_log_event(appended_events, event);
  }

  if (appended_events.length <= LOG_WINDOW_EVENT_LIMIT) {
    return appended_events;
  }

  return appended_events.slice(appended_events.length - LOG_WINDOW_EVENT_LIMIT);
}

export function sort_log_events_latest_first(events: LogEvent[]): LogEvent[] {
  return [...events].sort((left_event, right_event) => {
    return right_event.sequence - left_event.sequence;
  });
}

export function get_log_message_first_line(message: string): string {
  const first_line = message.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n")[0] ?? "";
  return first_line.trim() === "" ? "(blank)" : first_line;
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
