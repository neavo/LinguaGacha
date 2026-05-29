import path from "node:path";
import process from "node:process";

import { format_console_log } from "./log-console-formatter";
import {
  LOG_WINDOW_EVENT_CAPACITY,
  LOG_WINDOW_MESSAGE_PREVIEW_LENGTH,
  type LogAppendPayload,
  type LogDetail,
  type LogEvent,
  type LogLevel,
  type LogSubscriber,
  type LogTargets,
} from "../../shared/log";
import {
  sanitize_log_error_context,
  to_log_error,
  type LogError,
  type LogErrorContext,
} from "../../shared/error";
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
  /**
   * createdAt 由 LogManager 统一传入，确保文件、控制台、窗口事件共享同一创建时间
   */
  write(text: string, createdAt?: Date): void;
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
  error?: LogError;
  context?: LogErrorContext;
}

interface NormalizedLogAppendPayload {
  level: LogLevel;
  message: string;
  source: string;
  error?: LogError;
  context?: LogErrorContext;
}

/**
 * Backend 日志权威，统一管理文件、控制台和日志窗口三类输出
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
  private readonly details = new Map<string, LogDetail>(); // 详情池只保留当前进程最近窗口容量内的完整正文
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

  /**
   * debug 入口只标记等级，真实写入统一交给 append 分流
   */
  public debug(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "debug", message });
  }

  /**
   * info 入口只标记等级，真实写入统一交给 append 分流
   */
  public info(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "info", message });
  }

  /**
   * warning 入口只标记等级，真实写入统一交给 append 分流
   */
  public warning(message: string, payload: Omit<LogAppendPayload, "level" | "message"> = {}): void {
    this.append({ ...payload, level: "warning", message });
  }

  /**
   * error 入口只标记等级，真实写入统一交给 append 分流
   */
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
    const created_at = this.now();
    const normalized_payload = this.normalize_payload(payload);

    if (targets.file) {
      this.write_file_record(normalized_payload, created_at);
    }
    if (targets.console) {
      this.write_console_record(normalized_payload, created_at);
    }
    if (targets.window) {
      return this.publish_event(normalized_payload, created_at);
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
   * 读取当前进程内完整日志详情；历史日志不扫描文件，淘汰后由调用方展示不可用状态
   */
  public read_detail(id: string): LogDetail | null {
    const detail = this.details.get(id);
    if (detail === undefined) {
      return null;
    }

    return {
      ...detail,
      error: detail.error === undefined ? undefined : { ...detail.error },
      context: detail.context === undefined ? undefined : { ...detail.context },
    };
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

  /**
   * 单次 targets 只覆盖调用点明确指定的通道，未指定项沿用构造期默认值
   */
  private resolve_targets(targets?: Partial<LogTargets>): LogTargets {
    return { ...this.default_targets, ...targets };
  }

  /**
   * 文件记录保存完整正文和诊断上下文，是当前 app.yyyymmdd.log 的唯一落盘格式
   */
  private write_file_record(payload: NormalizedLogAppendPayload, created_at: Date): void {
    const record: FileLogRecord = {
      level: resolve_file_log_level(payload.level),
      level_label: payload.level,
      time: created_at.toISOString(),
      source: payload.source,
      message: payload.message,
    };
    if (payload.error !== undefined) {
      record.error = payload.error;
    }
    if (payload.context !== undefined) {
      record.context = payload.context;
    }

    this.file_writer.write(`${JSON.stringify(record)}\n`, created_at);
  }

  /**
   * 控制台输出保留完整正文，便于启动期和开发调试直接观察
   */
  private write_console_record(payload: NormalizedLogAppendPayload, created_at: Date): void {
    this.console_writer(format_console_log(payload, created_at), payload.level);
  }

  /**
   * 窗口事件只发布轻量预览，同时把完整正文写入同 ID 的详情池
   */
  private publish_event(payload: NormalizedLogAppendPayload, created_at: Date): LogEvent {
    const sequence = this.next_sequence;
    this.next_sequence += 1;
    const id = `log-${sequence.toString()}`;
    const source = payload.source;
    const created_at_text = created_at.toISOString();
    const event: LogEvent = {
      id,
      sequence,
      created_at: created_at_text,
      level: payload.level,
      source,
      message_preview: build_log_message_preview(payload.message),
      message_length: payload.message.length,
    };
    const detail: LogDetail = {
      id,
      sequence,
      created_at: created_at_text,
      level: payload.level,
      source,
      message: payload.message,
    };
    if (payload.error !== undefined) {
      detail.error = payload.error;
    }
    if (payload.context !== undefined) {
      detail.context = { ...payload.context };
    }

    this.events.push(event);
    this.details.set(id, detail);
    this.trim_window_buffers();
    for (const subscriber of Array.from(this.subscribers)) {
      subscriber(event);
    }
    return event;
  }

  /**
   * 写入口统一把原始错误和上下文收窄成可序列化日志事实。
   */
  private normalize_payload(payload: LogAppendPayload): NormalizedLogAppendPayload {
    const message = normalize_log_message(payload.message);
    const source = payload.source ?? "electron-main";
    if (payload.error !== undefined) {
      return {
        level: payload.level,
        message,
        source,
        error: to_log_error(payload.error, payload.context ?? {}),
      };
    }
    const context =
      payload.context === undefined ? undefined : sanitize_log_error_context(payload.context);
    return {
      level: payload.level,
      message,
      source,
      ...(context === undefined || Object.keys(context).length === 0 ? {} : { context }),
    };
  }

  /**
   * 事件和详情共用 ring buffer 上限，避免出现列表可见但详情永不释放
   */
  private trim_window_buffers(): void {
    if (this.events.length <= this.ring_buffer_size) {
      return;
    }

    const evicted_events = this.events.splice(0, this.events.length - this.ring_buffer_size);
    for (const evicted_event of evicted_events) {
      this.details.delete(evicted_event.id);
    }
  }
}

export function normalize_log_message(message: string): string {
  return String(message).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * 日志列表预览先归一换行并裁剪，完整正文只能通过 LogDetail 读取
 */
export function build_log_message_preview(message: string): string {
  const normalized_message = normalize_log_message(message).trim();
  if (normalized_message.length <= LOG_WINDOW_MESSAGE_PREVIEW_LENGTH) {
    return normalized_message;
  }

  return normalized_message.slice(0, LOG_WINDOW_MESSAGE_PREVIEW_LENGTH);
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
  private last_cleanup_date_key: string | null = null; // 同一天只清理一次旧日志，减少目录扫描

  public constructor(options: DailyLogFileWriterOptions) {
    this.log_dir = options.logDir;
    this.now = options.now;
    this.native_fs = options.nativeFs;
  }

  /**
   * 普通日志立即追加到当天文件，保持 app.yyyymmdd.log 与当前实现一样近实时可读
   */
  public write(message: string, createdAt: Date = this.now()): void {
    const date_key = format_log_date_key(createdAt);
    this.append_to_date_file(date_key, message);
    this.cleanup_old_log_files(date_key);
  }

  /**
   * 当前 writer 没有内部缓冲，flush 只保留 FileLogWriter 统一契约
   */
  public flush(): void {
    return;
  }

  /**
   * 同步 flush 由 fatal 和 shutdown 调用，当前 writer 本身已经同步追加
   */
  public flushSync(): void {
    return;
  }

  /**
   * end 保持 FileLogWriter 生命周期契约完整，调用方仍可等待关闭完成
   */
  public end(callback?: () => void): void {
    callback?.();
  }

  /**
   * 真实文件名仍固定为 app.yyyymmdd.log，不额外产生索引或详情文件
   */
  private append_to_date_file(date_key: string, message: string): void {
    const log_file_path = path.join(
      this.log_dir,
      `${LOG_FILE_PREFIX}.${date_key}${LOG_FILE_EXTENSION}`,
    );
    this.native_fs.append_text_file(log_file_path, message);
  }

  /**
   * 旧日志清理只围绕 app.yyyymmdd.log，其他诊断文件不由这里碰触
   */
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
