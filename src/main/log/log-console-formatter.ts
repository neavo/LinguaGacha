import type { LogAppendPayload, LogLevel } from "../../shared/log";

const CONSOLE_LEVEL_COLUMN_WIDTH = 7;
const ANSI_RESET = "\x1b[0m";
const CONSOLE_TIME_COLOR = "\x1b[2;36m";
const CONSOLE_MESSAGE_KEYWORD_COLOR = "\x1b[36m";
const CONSOLE_MESSAGE_URL_COLOR = "\x1b[94m";
const CONSOLE_MESSAGE_STRING_COLOR = "\x1b[32m";
const CONSOLE_MESSAGE_NUMBER_COLOR = "\x1b[94m";
const CONSOLE_MESSAGE_BOOLEAN_TRUE_COLOR = "\x1b[32;3m";
const CONSOLE_MESSAGE_BOOLEAN_FALSE_COLOR = "\x1b[31;3m";
const CONSOLE_MESSAGE_NULL_COLOR = "\x1b[35;3m";
const CONSOLE_MESSAGE_OPERATOR_COLOR = "\x1b[35m";
const ANSI_SEQUENCE_PREFIX = "\x1b[";
const CONSOLE_MESSAGE_TOKEN_PATTERN =
  /\b(?:https?|wss?):\/\/[^\s"'<>]+|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b(?:true|false|True|False|null|None|undefined|def|class|return|yield|try|except|for|while|if|else|elif|in|from|import|async|await|const|let|var|function)\b|\b\d+(?:\.\d+)?\b|->|=>|[=:]/g;
const CONSOLE_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[1;31m",
};

/**
 * 控制台输出是给人看的诊断视图，独立于文件日志的结构化 JSON
 */
export function format_console_log(payload: LogAppendPayload, created_at: Date): string {
  const error_text = payload.error_message === undefined ? "" : `\n${payload.error_message}`;
  const stack_text = payload.stack === undefined ? "" : `\n${payload.stack}`;
  const color = CONSOLE_LEVEL_COLORS[payload.level];
  const time_text = format_console_time_key(created_at);
  const level_text = payload.level.toUpperCase().padEnd(CONSOLE_LEVEL_COLUMN_WIDTH, " ");
  const message_text = highlight_console_message(`${payload.message}${error_text}${stack_text}`);
  return `${CONSOLE_TIME_COLOR}[${time_text}]${ANSI_RESET}  ${color}${level_text}${ANSI_RESET}  ${message_text}\n`;
}

function format_console_time_key(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function highlight_console_message(message: string): string {
  if (message.includes(ANSI_SEQUENCE_PREFIX)) {
    return message;
  }
  return message.replace(CONSOLE_MESSAGE_TOKEN_PATTERN, (token) => {
    return `${resolve_console_message_token_color(token)}${token}${ANSI_RESET}`;
  });
}

function resolve_console_message_token_color(token: string): string {
  if (/^(?:https?|wss?):\/\//.test(token)) {
    return CONSOLE_MESSAGE_URL_COLOR;
  }
  if (token === "true" || token === "True") {
    return CONSOLE_MESSAGE_BOOLEAN_TRUE_COLOR;
  }
  if (token === "false" || token === "False") {
    return CONSOLE_MESSAGE_BOOLEAN_FALSE_COLOR;
  }
  if (token === "null" || token === "None" || token === "undefined") {
    return CONSOLE_MESSAGE_NULL_COLOR;
  }
  if (token === "->" || token === "=>" || token === "=" || token === ":") {
    return CONSOLE_MESSAGE_OPERATOR_COLOR;
  }
  if (token.startsWith('"') || token.startsWith("'")) {
    return CONSOLE_MESSAGE_STRING_COLOR;
  }
  if (/^\d/.test(token)) {
    return CONSOLE_MESSAGE_NUMBER_COLOR;
  }
  return CONSOLE_MESSAGE_KEYWORD_COLOR;
}
