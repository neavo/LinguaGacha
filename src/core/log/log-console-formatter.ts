import process from "node:process";
import { execFileSync } from "node:child_process";

import { Ansis } from "ansis";
import wrapAnsi from "wrap-ansi";

import type { LogAppendPayload, LogLevel } from "../../shared/log";

const CONSOLE_LEVEL_COLUMN_WIDTH = 7;
const CONSOLE_TIME_COLUMN_WIDTH = 10;
const CONSOLE_COLUMN_GAP_WIDTH = 2;
const DEFAULT_CONSOLE_COLUMNS = 100;
const CONSOLE_COLUMNS_CACHE_TTL_MS = 1000;
const ANSI_SEQUENCE_PREFIX = "\x1b[";
const CONSOLE_MESSAGE_TOKEN_PATTERN =
  /\b(?:https?|wss?):\/\/[^\s"'<>]+|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\bv\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?\b|\b(?:true|false|True|False|null|None|undefined|def|class|return|yield|try|except|for|while|if|else|elif|in|from|import|async|await|const|let|var|function)\b|\b\d+(?:\.\d+)?\b|->|=>|[=:]/g;
const console_style = new Ansis(3);
const CONSOLE_LEVEL_FORMATTERS: Record<LogLevel, (text: string) => string> = {
  debug: console_style.gray,
  info: console_style.cyan,
  warning: console_style.yellow,
  error: console_style.red,
  fatal: console_style.red.bold,
};

interface ConsoleLogFormatOptions {
  columns?: number;
}

interface ConsoleColumnsCache {
  expires_at: number;
  value: number | null;
}

let console_columns_cache: ConsoleColumnsCache | null = null;

/**
 * 控制台输出是给人看的诊断视图，独立于文件日志的结构化 JSON
 */
export function format_console_log(
  payload: LogAppendPayload,
  created_at: Date,
  options: ConsoleLogFormatOptions = {},
): string {
  const error_text = payload.error_message === undefined ? "" : `\n${payload.error_message}`;
  const stack_text = payload.stack === undefined ? "" : `\n${payload.stack}`;
  const time_text = format_console_time_key(created_at);
  const level_text = payload.level.toUpperCase().padEnd(CONSOLE_LEVEL_COLUMN_WIDTH, " ");
  const prefix = build_console_prefix(time_text, payload.level, level_text);
  const message = `${payload.message}${error_text}${stack_text}`;
  const message_text = format_console_message_lines(message, resolve_console_columns(options));
  return `${prefix}${message_text}\n`;
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
    return resolve_console_message_token_formatter(token)(token);
  });
}

function format_console_message_lines(message: string, columns: number | null): string {
  const indent_width = resolve_console_message_indent_width();
  const indent = " ".repeat(indent_width);
  const resolved_columns = columns ?? DEFAULT_CONSOLE_COLUMNS;
  const needs_highlight = !message.includes(ANSI_SEQUENCE_PREFIX);
  let formatted_message: string;
  if (resolved_columns <= indent_width + 8) {
    formatted_message = indent_console_message_lines(message, indent);
  } else {
    formatted_message = indent_console_message_lines(
      wrapAnsi(message, resolved_columns - indent_width, {
        hard: true,
        trim: false,
        wordWrap: true,
      }),
      indent,
    );
  }
  return needs_highlight ? highlight_console_message(formatted_message) : formatted_message;
}

function indent_console_message_lines(message: string, indent: string): string {
  return message.replaceAll("\n", `\n${indent}`);
}

function resolve_console_message_indent_width(): number {
  return (
    CONSOLE_TIME_COLUMN_WIDTH +
    CONSOLE_COLUMN_GAP_WIDTH +
    CONSOLE_LEVEL_COLUMN_WIDTH +
    CONSOLE_COLUMN_GAP_WIDTH
  );
}

function resolve_console_columns(options: ConsoleLogFormatOptions): number | null {
  const columns =
    options.columns ?? process.stdout.columns ?? read_env_columns() ?? read_host_console_columns();
  if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) {
    return null;
  }
  return Math.floor(columns);
}

function read_env_columns(): number | undefined {
  const columns = Number(process.env["LINGUAGACHA_CONSOLE_COLUMNS"] ?? process.env["COLUMNS"]);
  return Number.isFinite(columns) && columns > 0 ? columns : undefined;
}

function read_host_console_columns(): number | null {
  const now = Date.now();
  if (console_columns_cache !== null && console_columns_cache.expires_at > now) {
    return console_columns_cache.value;
  }

  const value =
    process.platform === "win32" ? read_windows_console_columns() : read_posix_console_columns();
  console_columns_cache = {
    expires_at: now + CONSOLE_COLUMNS_CACHE_TTL_MS,
    value,
  };
  return value;
}

function read_windows_console_columns(): number | null {
  try {
    const output = execFileSync("cmd.exe", ["/d", "/c", "mode con"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
    const match = output.match(/Columns:\s*(\d+)/iu);
    return match === null ? null : Number(match[1]);
  } catch {
    return null;
  }
}

function read_posix_console_columns(): number | null {
  try {
    const output = execFileSync("tput", ["cols"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
    const columns = Number(output.trim());
    return Number.isFinite(columns) && columns > 0 ? columns : null;
  } catch {
    return null;
  }
}

function build_console_prefix(time_text: string, level: LogLevel, level_text: string): string {
  return `${console_style.dim.cyan(`[${time_text}]`)}  ${CONSOLE_LEVEL_FORMATTERS[level](level_text)}  `;
}

function resolve_console_message_token_formatter(token: string): (text: string) => string {
  if (/^(?:https?|wss?):\/\//.test(token)) {
    return console_style.blueBright;
  }
  if (token === "true" || token === "True") {
    return console_style.green.italic;
  }
  if (token === "false" || token === "False") {
    return console_style.red.italic;
  }
  if (token === "null" || token === "None" || token === "undefined") {
    return console_style.magenta.italic;
  }
  if (token === "->" || token === "=>" || token === "=" || token === ":") {
    return console_style.magenta;
  }
  if (token.startsWith('"') || token.startsWith("'")) {
    return console_style.green;
  }
  if (/^(?:\d|v\d)/.test(token)) {
    return console_style.blueBright;
  }
  return console_style.cyan;
}
