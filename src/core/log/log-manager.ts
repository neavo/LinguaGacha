import path from "node:path";
import process from "node:process";

import { format_console_log } from "./log-console-formatter";
import {
  LOG_WINDOW_EVENT_CAPACITY,
  type LogAppendPayload,
  type LogEvent,
  type LogLevel,
  type LogSubscriber,
  type LogTargets,
} from "../../shared/log";
import { t_main_log } from "./log-text";
import { NativeFs, default_native_fs } from "../../native/native-fs";

const MAX_LOG_FILE_COUNT = 3;
const LOG_FILE_PREFIX = "app";
const LOG_FILE_EXTENSION = ".log";
const LOG_FILE_NAME_PATTERN = /^app\.(\d{8})\.log$/;
const DEFAULT_LOG_TARGETS: LogTargets = {
  file: true,
  console: true,
  window: true,
};

type ConsoleWriter = (text: string, level: LogLevel) => void;
type NowProvider = () => Date;

export interface FileLogWriter {
  write(text: string): void;
  flush?(): void;
  flushSync?(): void;
  end?(callback?: () => void): void;
}

export interface LogManagerOptions {
  logDir: string;
  targets?: Partial<LogTargets>;
  ringBufferSize?: number;
  now?: NowProvider;
  consoleWriter?: ConsoleWriter;
  fileWriter?: FileLogWriter;
  nativeFs?: NativeFs;
}

interface FileLogRecord {
  level: number;
  level_label: LogLevel;
  time: string;
  source: string;
  message: string;
  error_message?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Core 日志权威，统一管理文件、控制台和日志窗口三类输出
 */
export class LogManager {
  private readonly log_dir: string;
  private readonly default_targets: LogTargets;
  private readonly ring_buffer_size: number;
  private readonly now: NowProvider;
  private readonly console_writer: ConsoleWriter;
  private readonly file_writer: FileLogWriter;
  private readonly native_fs: NativeFs; // native_fs 统一日志目录创建、追加和旧日志清理
  private readonly events: LogEvent[] = [];
  private readonly subscribers = new Set<LogSubscriber>();
  private next_sequence = 1;
  private shutdown_complete = false;

  /**
   * 日志目标在构造时收口，调用方只选择目标开关，不直接创建输出器
   */
  public constructor(options: LogManagerOptions) {
    this.log_dir = options.logDir;
    this.default_targets = { ...DEFAULT_LOG_TARGETS, ...options.targets };
    this.ring_buffer_size = options.ringBufferSize ?? LOG_WINDOW_EVENT_CAPACITY;
    this.now = options.now ?? (() => new Date());
    this.console_writer = options.consoleWriter ?? default_console_writer;
    this.native_fs = options.nativeFs ?? default_native_fs;
    this.native_fs.make_dir(this.log_dir);
    this.file_writer = options.fileWriter ?? this.create_file_writer();
  }

  public debug(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "debug", message });
  }

  public info(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "info", message });
  }

  public warning(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "warning", message });
  }

  public error(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "error", message });
  }

  /**
   * 崩溃日志入口会尽力同步刷盘，减少退出前丢尾部诊断的概率
   */
  public fatal(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "fatal", message });
    this.flush();
  }

  /**
   * 单一写入口，三类输出目标都从这里分流
   */
  public append(payload: LogAppendPayload): LogEvent | null {
    if (this.shutdown_complete) {
      default_console_writer(
        t_main_log("app.log.system_closed_dropped", { MESSAGE: payload.message }),
        payload.level === "fatal" ? "fatal" : "error",
      );
      return null;
    }

    const targets = this.resolve_targets(payload.targets);
    const normalized_message = normalize_log_message(payload.message);
    const normalized_payload: LogAppendPayload = {
      ...payload,
      message: normalized_message,
      source: payload.source ?? "electron-main",
    };

    if (targets.file) {
      this.write_file_record(normalized_payload);
    }
    if (targets.console) {
      this.write_console_record(normalized_payload);
    }
    if (targets.window) {
      return this.publish_event(normalized_payload.level, normalized_message);
    }
    return null;
  }

  /**
   * 订阅日志窗口事件；replay 为 true 时先回放当前进程内 ring buffer
   */
  public subscribe(subscriber: LogSubscriber, options: { replay?: boolean } = {}): () => void {
    if (options.replay ?? true) {
      for (const event of this.snapshot_events()) {
        subscriber(event);
      }
    }
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * 返回不可变快照，避免调用方拿到内部数组引用
   */
  public snapshot_events(): readonly LogEvent[] {
    return [...this.events];
  }

  /**
   * 尽力 flush 文件输出，供 fatal 和退出阶段复用
   */
  public flush(): void {
    try {
      const flush_sync = this.file_writer.flushSync;
      if (typeof flush_sync === "function") {
        flush_sync.call(this.file_writer);
        return;
      }

      const flush = this.file_writer.flush;
      if (typeof flush === "function") {
        flush.call(this.file_writer);
      }
    } catch {
      // 日志 flush 是退出阶段的尽力动作，writer 未 ready 时不应反过来阻断应用关闭
    }
  }

  /**
   * 退出阶段先关闭文件写入和窗口订阅，避免收尾后还有持久化副作用
   */
  public async shutdown(): Promise<void> {
    if (this.shutdown_complete) {
      return;
    }
    this.shutdown_complete = true;
    this.flush();
    await new Promise<void>((resolve) => {
      const end = this.file_writer.end;
      if (typeof end === "function") {
        end.call(this.file_writer, resolve);
      } else {
        resolve();
      }
    });
    this.subscribers.clear();
  }

  private create_file_writer(): FileLogWriter {
    return new DailyLogFileWriter({
      logDir: this.log_dir,
      now: this.now,
      nativeFs: this.native_fs,
    });
  }

  private resolve_targets(targets?: Partial<LogTargets>): LogTargets {
    return { ...this.default_targets, ...targets };
  }

  private write_file_record(payload: LogAppendPayload): void {
    const record: FileLogRecord = {
      level: resolve_file_log_level(payload.level),
      level_label: payload.level,
      time: this.now().toISOString(),
      source: payload.source ?? "electron-main",
      message: payload.message,
    };
    if (payload.error_message !== undefined) {
      record.error_message = payload.error_message;
    }
    if (payload.stack !== undefined) {
      record.stack = payload.stack;
    }
    if (payload.context !== undefined) {
      record.context = payload.context;
    }

    this.file_writer.write(`${JSON.stringify(record)}\n`);
  }

  private write_console_record(payload: LogAppendPayload): void {
    this.console_writer(format_console_log(payload, this.now()), payload.level);
  }

  private publish_event(level: LogLevel, message: string): LogEvent {
    const sequence = this.next_sequence;
    this.next_sequence += 1;
    const event: LogEvent = {
      id: `log-${sequence.toString()}`,
      sequence,
      created_at: this.now().toISOString(),
      level,
      message,
    };
    this.events.push(event);
    if (this.events.length > this.ring_buffer_size) {
      this.events.splice(0, this.events.length - this.ring_buffer_size);
    }
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(event);
    }
    return event;
  }
}

export function normalize_log_message(message: string): string {
  return String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function default_console_writer(text: string, level: LogLevel): void {
  if (level === "error" || level === "fatal") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
}

interface DailyLogFileWriterOptions {
  logDir: string;
  now: NowProvider;
  nativeFs: NativeFs;
}

class DailyLogFileWriter implements FileLogWriter {
  private readonly log_dir: string;
  private readonly now: NowProvider;
  private readonly native_fs: NativeFs; // native_fs 负责当前日志写入和保留策略清理
  private last_cleanup_date_key: string | null = null;

  public constructor(options: DailyLogFileWriterOptions) {
    this.log_dir = options.logDir;
    this.now = options.now;
    this.native_fs = options.nativeFs;
  }

  public write(message: string): void {
    const date_key = format_log_date_key(this.now());
    const log_file_path = path.join(
      this.log_dir,
      `${LOG_FILE_PREFIX}.${date_key}${LOG_FILE_EXTENSION}`,
    );
    this.native_fs.append_text_file(log_file_path, message);
    this.cleanup_old_log_files(date_key);
  }

  public flush(): void {
    // append_text_file 已完成同步写入；保留 flush 方法用于统一退出阶段调用
  }

  public flushSync(): void {
    this.flush();
  }

  public end(callback?: () => void): void {
    callback?.();
  }

  private cleanup_old_log_files(current_date_key: string): void {
    if (this.last_cleanup_date_key === current_date_key) {
      return;
    }
    this.last_cleanup_date_key = current_date_key;

    const log_files = this.native_fs
      .read_dir_names(this.log_dir)
      .map((file_name) => {
        const match = LOG_FILE_NAME_PATTERN.exec(file_name);
        if (match === null) {
          return null;
        }
        const date_key = match[1];
        if (date_key === undefined) {
          return null;
        }
        return { fileName: file_name, dateKey: date_key };
      })
      .filter((item): item is { fileName: string; dateKey: string } => item !== null)
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey));

    for (const stale_file of log_files.slice(MAX_LOG_FILE_COUNT)) {
      try {
        this.native_fs.unlink(path.join(this.log_dir, stale_file.fileName));
      } catch {
        // 旧日志清理是尽力动作，失败不能影响当前日志写入
      }
    }
  }
}

function resolve_file_log_level(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 20;
    case "info":
      return 30;
    case "warning":
      return 40;
    case "error":
      return 50;
    case "fatal":
      return 60;
  }
}

export function format_log_date_key(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
