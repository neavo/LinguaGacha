import type { LogEntry, LogLevel } from "@frontend/app/desktop/desktop-api";

export type LogLevelFilter = "all" | LogLevel;

// 展示顺序依赖所选日期内的物理行号，重启和索引重建均不改变顺序
export function sort_log_entries_latest_first(events: LogEntry[]): LogEntry[] {
  return [...events].sort((left_event, right_event) => {
    return right_event.line - left_event.line;
  });
}

// 表格列保持单行预览，完整正文由详情接口按需读取
export function compress_log_message_text(message: string): string {
  if (message.trim() === "") {
    return "(blank)";
  }

  return message.replace(/\r\n|\r|\n/gu, " ↵ ");
}

// 筛选只搜索轻量事件字段，避免完整日志正文进入 React 列表热路径
export function filter_log_entries(args: {
  events: LogEntry[];
  level_filter: LogLevelFilter;
  keyword: string;
  is_regex?: boolean;
}): LogEntry[] {
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
      event.source,
      event.message_preview,
      event.id,
      event.created_at,
    ].join("\n");

    if (args.is_regex === true) {
      return regex === null ? true : regex.test(search_text);
    }

    return search_text.toLowerCase().includes(normalized_keyword.toLowerCase());
  });
}

// 正则输入错误时回退为不过滤，错误提示由页面层根据同一输入独立展示
function build_log_filter_regex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "iu");
  } catch {
    return null;
  }
}

// 日志窗口使用本地可读时间，无法解析时保留原始时间戳用于诊断
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
