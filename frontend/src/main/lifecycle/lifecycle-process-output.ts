import type { ChildProcess } from "node:child_process";

import { get_electron_main_log_manager } from "../log/log-bridge";
import type { LogLevel } from "../log/log-types";

const ESCAPE_CHARACTER = String.fromCharCode(0x1b);
const BELL_CHARACTER = String.fromCharCode(0x07);
const TERMINAL_STYLE_RESET = `${ESCAPE_CHARACTER}[0m`;
const SGR_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*m`, "g");
const PYTHON_FALLBACK_LOG_PATTERN =
  /^\[(DEBUG|INFO|WARNING|ERROR|FATAL)\]\s+\[python-core\]\s*(.*)$/;

type OutputWriter = (text: string) => void;

interface LineForwarder {
  push: (chunk: Buffer) => void;
  flush: () => void;
}

export function sanitize_core_process_output(raw_text: string): string {
  let sanitized_text = "";
  let index = 0;

  while (index < raw_text.length) {
    const current_character = raw_text[index];
    if (current_character !== ESCAPE_CHARACTER) {
      sanitized_text += current_character === "\r" ? "\n" : current_character;
      index += 1;
      continue;
    }

    const next_character = raw_text[index + 1];
    if (next_character === "[") {
      const command_index = find_csi_command_index(raw_text, index + 2);
      if (command_index === -1) {
        break;
      }

      const command = raw_text[command_index];
      if (command === "m") {
        sanitized_text += raw_text.slice(index, command_index + 1);
      }
      index = command_index + 1;
      continue;
    }

    if (next_character === "]") {
      index = find_osc_end_index(raw_text, index + 2);
      continue;
    }

    index += next_character === undefined ? 1 : 2;
  }

  return sanitized_text;
}

function find_csi_command_index(raw_text: string, start_index: number): number {
  for (let index = start_index; index < raw_text.length; index += 1) {
    const char_code = raw_text.charCodeAt(index);
    if (char_code >= 0x40 && char_code <= 0x7e) {
      return index;
    }
  }

  return -1;
}

function find_osc_end_index(raw_text: string, start_index: number): number {
  for (let index = start_index; index < raw_text.length; index += 1) {
    if (raw_text[index] === BELL_CHARACTER) {
      return index + 1;
    }
    if (raw_text[index] === ESCAPE_CHARACTER && raw_text[index + 1] === "\\") {
      return index + 2;
    }
  }

  return raw_text.length;
}

export function format_core_process_output_line(line: string): string | null {
  const trimmed_line = line.trimEnd();
  if (trimmed_line === "") {
    return null;
  }

  return `${trimmed_line}${TERMINAL_STYLE_RESET}\n`;
}

export function normalize_core_process_log_message(line: string): string | null {
  return normalize_core_process_log_record(line, "info")?.message ?? null;
}

export function normalize_core_process_log_record(
  line: string,
  fallback_level: LogLevel,
): { level: LogLevel; message: string; source: string } | null {
  const trimmed_line = line.trimEnd();
  if (trimmed_line === "") {
    return null;
  }
  const plain_text = trimmed_line.replace(SGR_SEQUENCE_PATTERN, "");
  const fallback_match = PYTHON_FALLBACK_LOG_PATTERN.exec(plain_text);
  if (fallback_match !== null) {
    const message = fallback_match[2]?.trimEnd() ?? "";
    return {
      level: normalize_core_fallback_level(fallback_match[1]),
      message,
      source: "python-core",
    };
  }
  if (plain_text.trimEnd() === "") {
    return null;
  }
  return {
    level: fallback_level,
    message: plain_text,
    source: fallback_level === "error" ? "python-stderr" : "python-stdout",
  };
}

function create_line_forwarder(writer: OutputWriter): LineForwarder {
  let buffered_text = "";

  function write_line(line: string): void {
    const formatted_line = format_core_process_output_line(line);
    if (formatted_line === null) {
      return;
    }

    writer(formatted_line);
  }

  return {
    push(chunk: Buffer): void {
      buffered_text += sanitize_core_process_output(chunk.toString("utf8"));
      const lines = buffered_text.split("\n");
      buffered_text = lines.pop() ?? "";

      for (const line of lines) {
        write_line(line);
      }
    },
    flush(): void {
      write_line(buffered_text);
      buffered_text = "";
    },
  };
}

export function attach_core_process_output(core_process: ChildProcess): void {
  const stdout_forwarder = create_line_forwarder((text) => {
    const log_manager = get_electron_main_log_manager();
    const record = normalize_core_process_log_record(text, "info");
    if (log_manager === null || record === null) {
      process.stdout.write(text);
      return;
    }
    log_manager.append(record);
  });
  const stderr_forwarder = create_line_forwarder((text) => {
    const log_manager = get_electron_main_log_manager();
    const record = normalize_core_process_log_record(text, "error");
    if (log_manager === null || record === null) {
      process.stderr.write(text);
      return;
    }
    log_manager.append(record);
  });

  core_process.stdout?.on("data", (chunk: Buffer) => {
    stdout_forwarder.push(chunk);
  });
  core_process.stderr?.on("data", (chunk: Buffer) => {
    stderr_forwarder.push(chunk);
  });
  core_process.once("close", () => {
    stdout_forwarder.flush();
    stderr_forwarder.flush();
  });
}

function normalize_core_fallback_level(level: string | undefined): LogLevel {
  switch (level) {
    case "DEBUG":
      return "debug";
    case "WARNING":
      return "warning";
    case "ERROR":
      return "error";
    case "FATAL":
      return "fatal";
    case "INFO":
    default:
      return "info";
  }
}
