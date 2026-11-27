import process from "node:process";
import { format_console_log } from "./log-console-formatter";
import { LogFileStore } from "./log-file-store";
import {
  format_log_content_text,
  normalize_log_scope,
  type LogAppendPayload,
  type LogFileRecord,
  type LogLevel,
  type LogContent,
  type LogScope,
  type LogTargets,
} from "../../shared/log";
import { sanitize_log_error_context, to_log_error } from "../../shared/error";
import { t_main_log } from "./log-text";
import { NativeFs, default_native_fs } from "../../native/native-fs";

// 创建时间与输出可见性在唯一写入口补齐。
type NormalizedLogAppendPayload = Omit<LogFileRecord, "created_at" | "window">;
type LogMessagePayload = Omit<LogAppendPayload, "level" | "content">;

export interface LogManagerOptions {
  logDir: string;
  targets?: Partial<LogTargets>;
  now?: () => Date;
  consoleWriter?: (text: string, level: LogLevel) => void;
  nativeFs?: NativeFs;
}

/** 绑定日志归属，并把记录交给同一个写入方。 */
export class LogWriter {
  /** 写入方拥有输出资源，归属随当前写入器实例固定。 */
  public constructor(
    private readonly write: (payload: LogAppendPayload) => void,
    private readonly bound_scope?: LogScope,
  ) {}

  /** 每次绑定都复用根写入方，归属层级不会形成调用链。 */
  public scope(patch: LogScope): LogWriter {
    return new LogWriter(this.write, this.merge_scope(patch));
  }

  /** 单条日志可覆盖已有归属，空值沿用继承的标识。 */
  public append({ scope: patch, ...payload }: LogAppendPayload): void {
    const scope = this.merge_scope(patch);
    this.write(scope === undefined ? payload : { ...payload, scope });
  }

  public debug(message: string, payload: LogMessagePayload = {}): void {
    this.append({ ...payload, level: "debug", content: message });
  }

  public info(message: string, payload: LogMessagePayload = {}): void {
    this.append({ ...payload, level: "info", content: message });
  }

  public warning(message: string, payload: LogMessagePayload = {}): void {
    this.append({ ...payload, level: "warning", content: message });
  }

  public error(message: LogContent, payload: LogMessagePayload = {}): void {
    this.append({ ...payload, level: "error", content: message });
  }

  public fatal(message: string, payload: LogMessagePayload = {}): void {
    this.append({ ...payload, level: "fatal", content: message });
  }

  /** 绑定和单次写入共用覆盖规则。 */
  private merge_scope(patch: LogScope | undefined): LogScope | undefined {
    const scope = normalize_log_scope(patch);
    return scope === undefined ? this.bound_scope : { ...this.bound_scope, ...scope };
  }
}

/** 业务唯一写入口；完整正文及查询归文件存储，控制台只是即时文本输出。 */
export class LogManager extends LogWriter {
  public readonly files: LogFileStore;
  private readonly targets: LogTargets;
  private readonly now: () => Date;
  private readonly console_writer: (text: string, level: LogLevel) => void;
  private closed = false; // 关闭后只保留 stderr 诊断，禁止继续持久化

  /** 组装日志目录与输出依赖，资源生命周期由调用方管理。 */
  public constructor(options: LogManagerOptions) {
    super((payload) => this.write_record(payload));
    this.files = new LogFileStore(options.logDir, options.nativeFs ?? default_native_fs);
    this.targets = { console: true, window: true, ...options.targets };
    this.now = options.now ?? (() => new Date());
    this.console_writer = options.consoleWriter ?? default_console_writer;
  }

  /** 正文同步追加完成才写索引；控制台与窗口均从同一正文消费。 */
  private write_record(payload: LogAppendPayload): void {
    if (this.closed) {
      default_console_writer(
        t_main_log("app.log.system_closed_dropped", {
          MESSAGE: format_log_content_text(payload.content),
        }),
        "error",
      );
      return;
    }
    const targets = { ...this.targets, ...payload.targets };
    const normalized = this.normalize_payload(payload);
    const created_at = this.now();
    this.files.append(format_log_date_key(created_at), {
      ...normalized,
      created_at: created_at.toISOString(),
      ...(targets.window ? {} : { window: false as const }),
    });
    if (targets.console)
      this.console_writer(
        format_console_log(normalized, created_at, {
          group_end: payload.console_group_end ?? true,
        }),
        payload.level,
      );
  }

  /** 先停止接收日志，再等待文件任务结束。 */
  public async shutdown(): Promise<void> {
    this.closed = true;
    await this.files.close();
  }

  /** 在持久化前收窄原始异常和上下文。 */
  private normalize_payload(payload: LogAppendPayload): NormalizedLogAppendPayload {
    // 同步序列化完成后才返回，正文引用不存入状态，也不跨异步边界。
    const { scope } = payload;
    const record = {
      level: payload.level,
      source: payload.source ?? "electron-main",
      ...(scope === undefined ? {} : { scope }),
      content: payload.content,
    };
    if (payload.error !== undefined) {
      return {
        ...record,
        error: to_log_error(payload.error, payload.context ?? {}),
      };
    }
    const context =
      payload.context === undefined ? undefined : sanitize_log_error_context(payload.context);
    return {
      ...record,
      ...(context === undefined || Object.keys(context).length === 0 ? {} : { context }),
    };
  }
}

/** 错误与致命日志走 stderr，其余日志走 stdout。 */
function default_console_writer(text: string, level: LogLevel): void {
  (level === "error" || level === "fatal" ? process.stderr : process.stdout).write(text);
}

/** 按本地日期生成每日文件标识。 */
function format_log_date_key(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
