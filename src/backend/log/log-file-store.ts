import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { NativeFs } from "../../native/native-fs";
import { AppError, normalize_log_error } from "../../shared/error";
import {
  format_log_content_text,
  normalize_log_level,
  read_log_content,
  LOG_PAGE_SIZE,
  LOG_WINDOW_MESSAGE_PREVIEW_LENGTH,
  type LogDetail,
  type LogEntry,
  type LogFileRecord,
  type LogPage,
  type LogPageRequest,
} from "../../shared/log";

const LOG_DATES_TO_KEEP = 3;
const READ_CHUNK_BYTES = 64 * 1024;
const PAGE_SCAN_BYTES = 1024 * 1024;
const DATE_PATTERN = /^\d{8}$/;
const LOG_PATTERN = /^app\.(\d{8})\.(?:log|jsonl|idx\.jsonl)$/;
const BODY_PATTERN = /^app\.(\d{8})\.jsonl$/;
const LF = 10;

type IndexEntry = Omit<LogEntry, "id" | "date" | "line" | "revision"> & { offset: number };
type IndexRecord = {
  line: number; // 隐藏及损坏正文也占一行
  end: number; // 此行末尾 LF 之后的正文字节位置
  entry?: IndexEntry; // 只有窗口可见正文才保存摘要
};
type Line = { start: number; end: number; bytes: Buffer };
type IndexState = {
  line: number; // 已索引的完整正文行数
  end: number; // 最后一条完整正文的末尾位置
  scanned: number; // 已扫描大小可能包含未结束尾行，避免反复重建
  size: number; // 当前索引文件的字节数
  revision: string; // 索引建立时的内容代次，读取期间保持快照身份
};
type SourceState = {
  stamp: string | null; // 最近观察或自身写入后的文件状态，null 表示缺失
  revision: string; // 正文编辑或索引失效后更换的内容代次
  append_ready: boolean; // 本次文件状态已完成追加前的尾行检查
};

/** 每日正文及其可重建索引的唯一拥有者；不缓存正文或完整摘要集合。 */
export class LogFileStore {
  private readonly states = new Map<string, IndexState>(); // 可随时重建的索引进度
  private readonly repairs = new Map<string, Promise<void>>(); // 同日期的查询共享恢复任务
  private readonly sources = new Map<string, SourceState>(); // 正文状态与代次共同失效
  private cleanup_date: string | null = null; // 每个写入日期只触发一次目录清理

  /** 组装日志目录与输出依赖，资源生命周期由调用方管理。 */
  public constructor(
    private readonly directory: string,
    private readonly fs: NativeFs,
  ) {
    fs.make_dir(directory);
  }

  /** 仅从受限日期构造路径，避免查询参数成为任意文件路径。 */
  private file(date: string, index = false): string {
    if (!DATE_PATTERN.test(date)) throw new AppError("request.validation_failed");
    return path.join(this.directory, `app.${date}${index ? ".idx" : ""}.jsonl`);
  }

  /** 缺失文件按零长度参与初始化与清理判断。 */
  private size(file: string): number {
    return this.fs.exists(file) ? this.fs.stat(file).size : 0;
  }

  /** 只枚举新格式正文，索引与旧日志不成为可选日期。 */
  public list_dates(): string[] {
    return this.fs
      .read_dir_names(this.directory)
      .flatMap((name) => BODY_PATTERN.exec(name)?.[1] ?? [])
      .sort()
      .reverse();
  }

  /** 同时识别文件替换和等字节长度的编辑。 */
  private stamp(date: string): string | null {
    const file = this.file(date);
    if (!this.fs.exists(file)) return null;
    const stat = this.fs.stat(file);
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  }

  /** 自身追加更新已知状态；未知变化一律视为编辑，不能根据长度增长猜测为追加。 */
  private check_source(date: string): string {
    const stamp = this.stamp(date);
    let source = this.sources.get(date);
    if (source === undefined || source.stamp !== stamp) {
      source = { stamp, revision: randomUUID(), append_ready: false };
      this.sources.set(date, source);
      this.states.delete(date);
    }
    return source.revision;
  }

  /** 已由 check_source 建立日期状态；索引失效也使在途游标过期。 */
  private invalidate(date: string): void {
    this.states.delete(date);
    this.sources.get(date)!.revision = randomUUID();
  }

  /** 正文同步追加后记录自身文件状态，外部保存不会被随后的追加掩盖。 */
  public append(date: string, record: LogFileRecord): void {
    const file = this.file(date);
    this.check_source(date);
    const source = this.sources.get(date)!;
    try {
      if (!source.append_ready) {
        if (this.fs.exists(file)) {
          const last = this.fs.read_last_byte(file);
          if (last !== null && last !== LF) this.fs.append_text_file(file, "\n");
        } else {
          this.fs.write_file_sync(this.file(date, true), "");
          this.states.set(date, {
            line: 0,
            end: 0,
            scanned: 0,
            size: 0,
            revision: this.sources.get(date)!.revision,
          });
        }
        source.append_ready = true;
      }
      const offset = this.size(file);
      const text = `${JSON.stringify(record)}\n`;
      this.fs.append_text_file(file, text);
      source.stamp = this.stamp(date);
      const state = this.states.get(date);
      if (state !== undefined && !this.repairs.has(date) && state.end === offset) {
        try {
          this.write_index(
            date,
            this.index_record(record, state.line + 1, offset, offset + Buffer.byteLength(text)),
          );
        } catch (error) {
          this.invalidate(date);
          this.report(error);
        }
      }
    } catch (error) {
      this.invalidate(date);
      this.report(error);
    }
    if (!this.states.has(date) && !this.repairs.has(date) && this.fs.exists(file)) {
      // 恢复任务已报告 IO 故障，后台失败不会丢失正文；查询时可以重试。
      void this.ensure_index(date).catch(() => undefined);
    }
    if (this.cleanup_date !== date) {
      this.cleanup_date = date;
      this.cleanup();
    }
  }

  /** 摘要与进度同条提交，隐藏和损坏行仍计入物理行数。 */
  private index_record(
    record: LogFileRecord | null,
    line: number,
    offset: number,
    end: number,
  ): IndexRecord {
    if (record === null || record.window === false) return { line, end };
    const message = format_log_content_text(record.content).replace(/\r\n?/g, "\n");
    return {
      line,
      end,
      entry: {
        offset,
        created_at: record.created_at,
        level: record.level,
        source: record.source,
        message_preview: message.trim().slice(0, LOG_WINDOW_MESSAGE_PREVIEW_LENGTH),
        message_length: message.length,
      },
    };
  }

  /** 追加成功后更新内存进度，失败由正文重建恢复。 */
  private write_index(date: string, record: IndexRecord): void {
    const text = `${JSON.stringify(record)}\n`;
    this.fs.append_text_file(this.file(date, true), text);
    const state = this.states.get(date);
    this.states.set(date, {
      line: record.line,
      end: record.end,
      scanned: record.end,
      size: (state?.size ?? 0) + Buffer.byteLength(text),
      revision: this.sources.get(date)!.revision,
    });
  }

  /** 分块读取完整 LF 记录；大正文的分块只在整条完成时合并一次。 */
  private async *lines(
    file: string,
    start: number,
    end: number,
    reverse = false,
  ): AsyncGenerator<Line> {
    if (!reverse) {
      let line_start = start;
      let parts: Buffer[] = [];
      for (let position = start; position < end; position += READ_CHUNK_BYTES) {
        const length = Math.min(READ_CHUNK_BYTES, end - position);
        const chunk = await this.fs.read_range(file, position, length);
        if (chunk.length !== length) throw new Error("Log file changed during range read");
        let begin = 0;
        let newline = chunk.indexOf(LF);
        while (newline >= 0) {
          parts.push(chunk.subarray(begin, newline + 1));
          yield {
            start: line_start,
            end: position + newline + 1,
            bytes: parts.length === 1 ? parts[0]! : Buffer.concat(parts),
          };
          parts = [];
          begin = newline + 1;
          line_start = position + begin;
          newline = chunk.indexOf(LF, begin);
        }
        if (begin < chunk.length) parts.push(chunk.subarray(begin));
      }
      return;
    }
    // 逆向只读取已提交的索引范围；pending 保留跨块的单行片段。
    let position = end;
    let pending = Buffer.alloc(0);
    while (position > start) {
      const next = Math.max(start, position - READ_CHUNK_BYTES);
      const chunk = await this.fs.read_range(file, next, position - next);
      if (chunk.length !== position - next) throw new Error("Log file changed during range read");
      position = next;
      pending = Buffer.concat([chunk, pending]);
      let stop = pending.length;
      while (stop > 0) {
        const previous = stop <= 1 ? -1 : pending.lastIndexOf(LF, stop - 2);
        if (previous < 0 && position !== start) break;
        const begin = previous + 1;
        yield {
          start: position + begin,
          end: position + stop,
          bytes: pending.subarray(begin, stop),
        };
        stop = begin;
      }
      pending = pending.subarray(0, stop);
    }
  }

  /** 同日期查询共享恢复任务，只复用与文件状态匹配的索引。 */
  private async ensure_index(date: string): Promise<void> {
    this.check_source(date);
    const pending = this.repairs.get(date);
    if (pending !== undefined) return pending;
    const state = this.states.get(date);
    if (
      state !== undefined &&
      state.size === this.size(this.file(date, true)) &&
      state.scanned === this.size(this.file(date))
    )
      return;
    if (state !== undefined) this.invalidate(date);
    const task = this.repair(date);
    this.repairs.set(date, task);
    try {
      await task;
    } finally {
      this.repairs.delete(date);
    }
  }

  /** 首次访问和外部编辑都重建，省去跨进程信任旧索引的元数据协议。 */
  private async repair(date: string): Promise<void> {
    try {
      // 外部编辑重建整个索引；自身追加只续扫本轮快照之后的尾部。
      while (true) {
        const revision = this.check_source(date);
        this.fs.write_file_sync(this.file(date, true), "");
        this.states.set(date, { line: 0, end: 0, scanned: 0, size: 0, revision });
        let restart = false;
        while (true) {
          const start = this.states.get(date)!.end;
          const end = this.size(this.file(date));
          for await (const line of this.lines(this.file(date), start, end)) {
            if (this.sources.get(date)?.revision !== revision) {
              restart = true;
              break;
            }
            const record = read_record(line.bytes);
            const number = this.states.get(date)!.line + 1;
            if (record === null)
              this.report(new Error(`Invalid log record at ${date}:${String(number)}`));
            this.write_index(date, this.index_record(record, number, line.start, line.end));
          }
          if (restart || this.check_source(date) !== revision) {
            restart = true;
            break;
          }
          if (this.size(this.file(date)) === end) {
            this.states.get(date)!.scanned = end;
            break;
          }
        }
        if (!restart) return;
      }
    } catch (error) {
      this.invalidate(date);
      this.report(error);
      throw error;
    }
  }

  /** 索引按物理行号递增，二分定位避免详情从头扫描所有摘要。 */
  private async find_line(
    date: string,
    number: number,
  ): Promise<{ record: IndexRecord; start: number; end: number } | null> {
    const size = this.states.get(date)!.size;
    let low = 0;
    let high = size;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      // 中点可能落在行内，恰好位于行首时必须保留该行。
      let skip_partial =
        middle > low && (await this.fs.read_range(this.file(date, true), middle - 1, 1))[0] !== LF;
      let found = false;
      for await (const line of this.lines(this.file(date, true), middle, size)) {
        if (skip_partial) {
          skip_partial = false;
          continue;
        }
        if (line.start >= high) break;
        const record = read_index(line.bytes);
        if (record === null) {
          this.invalidate(date);
          return null;
        }
        if (record.line === number) return { record, start: line.start, end: line.end };
        if (record.line < number) low = line.end;
        else high = middle;
        found = true;
        break;
      }
      if (!found) high = middle;
    }
    return null;
  }

  /** 将读取期间的清理和外部编辑归一成公开查询状态。 */
  public async read_page(request: LogPageRequest): Promise<LogPage> {
    validate_request(request);
    const date = request.date;
    if (!this.fs.exists(this.file(date))) return empty_page("expired");
    try {
      const page = await this.read_date_page(request);
      if (!this.fs.exists(this.file(date))) return empty_page("expired");
      if (page.after !== null && page.after.revision !== this.check_source(date))
        return empty_page("cursor_invalid");
      return page;
    } catch (error) {
      if (!this.fs.exists(this.file(date))) return empty_page("expired");
      throw error;
    }
  }

  /** 在一个日期文件内读取有界索引页，列表不加载完整正文。 */
  private async read_date_page(request: LogPageRequest): Promise<LogPage> {
    const date = request.date;
    await this.ensure_index(date);
    const state = this.states.get(date)!;
    const cursor = request.cursor;
    if (cursor !== undefined && (cursor.revision !== state.revision || cursor.line > state.line))
      return empty_page("cursor_invalid");
    if (request.direction === "check")
      return { ...empty_page("ready"), before: cursor!, after: cursor! };
    const reverse = request.direction !== "after";
    const initial_line = cursor?.line ?? (reverse ? state.line : 0);
    const at_end = initial_line === state.line;
    const boundary = initial_line === 0 || at_end ? null : await this.find_line(date, initial_line);
    if (initial_line > 0 && !at_end && boundary === null) return empty_page("cursor_invalid");
    const position = at_end ? state.size : (boundary?.end ?? 0);
    const initial = { date, line: initial_line, revision: state.revision };
    const result: LogPage = { ...empty_page("ready"), before: initial, after: initial };
    let scanned = 0;
    for await (const line of this.lines(
      this.file(date, true),
      reverse ? 0 : position,
      reverse ? position : state.size,
      reverse,
    )) {
      const record = read_index(line.bytes);
      if (record === null) {
        this.invalidate(date);
        return empty_page("cursor_invalid");
      }
      scanned += line.end - line.start;
      if (reverse) result.before = { ...initial, line: record.line - 1 };
      else result.after = { ...initial, line: record.line };
      if (record.entry !== undefined) {
        const { offset: _offset, ...entry } = record.entry;
        result.entries.push({
          ...entry,
          id: `${date}:${String(record.line)}`,
          date,
          line: record.line,
          revision: state.revision,
        });
      }
      if (result.entries.length >= (request.limit ?? LOG_PAGE_SIZE) || scanned >= PAGE_SCAN_BYTES) {
        result.has_more = reverse ? record.line > 1 : line.end < state.size;
        break;
      }
    }
    if (reverse) result.entries.reverse();
    return result;
  }

  /** 核对内容代次后定位正文，拒绝编辑前的过期行号请求。 */
  public async read_detail(id: string, revision: string): Promise<LogDetail | null> {
    const match = /^(\d{8}):([1-9]\d*)$/.exec(id);
    const date = match?.[1];
    const number = Number(match?.[2]);
    if (date === undefined || !is_offset(number) || typeof revision !== "string")
      throw new AppError("request.validation_failed");
    const file = this.file(date);
    if (!this.fs.exists(file)) return null;
    try {
      await this.ensure_index(date);
      if (this.sources.get(date)?.revision !== revision) return null;
      const indexed = await this.find_line(date, number);
      if (indexed?.record.entry === undefined) return null;
      const offset = indexed.record.entry.offset;
      const bytes = await this.fs.read_range(file, offset, indexed.record.end - offset);
      if (this.check_source(date) !== revision || bytes.indexOf(LF) !== bytes.length - 1)
        return null;
      const record = read_record(bytes);
      if (record === null || record.window === false) return null;
      const { window: _window, ...detail } = record;
      return { ...detail, id, date, line: number, revision };
    } catch (error) {
      if (!this.fs.exists(file)) return null;
      throw error;
    }
  }

  /** 按日期共同清理正文与附属文件，避开在途恢复任务。 */
  private cleanup(): void {
    const files = this.fs.read_dir_names(this.directory).flatMap((name) => {
      const date = LOG_PATTERN.exec(name)?.[1];
      return date === undefined ? [] : [{ name, date }];
    });
    const keep = new Set(
      [...new Set(files.map((file) => file.date))].sort().reverse().slice(0, LOG_DATES_TO_KEEP),
    );
    for (const file of files) {
      if (keep.has(file.date) || this.repairs.has(file.date)) continue;
      try {
        this.fs.unlink(path.join(this.directory, file.name));
        this.states.delete(file.date);
        this.sources.delete(file.date);
      } catch (error) {
        this.report(error);
      }
    }
  }

  /** 等待在途索引恢复完成后结束资源生命周期。 */
  public async close(): Promise<void> {
    await Promise.allSettled(this.repairs.values());
  }

  /** 日志自身故障使用独立出口，避免递归写日志。 */
  private report(error: unknown): void {
    process.stderr.write(`[log] ${String(error)}\n`);
  }
}

/** 统一空页协议，由调用方填充状态与游标。 */
function empty_page(status: LogPage["status"]): LogPage {
  return { status, entries: [], before: null, after: null, has_more: false };
}

/** 解析单行 JSON 对象，损坏位置由调用方报告。 */
function read_object(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf-8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    // 外部损坏的日志行由调用方报告位置，不尝试猜测或修补正文。
    return null;
  }
}

/** 将磁盘正文收窄为当前契约，保留可序列化诊断。 */
function read_record(bytes: Buffer): LogFileRecord | null {
  const value = read_object(bytes);
  if (value === null) return null;
  const content = read_log_content(value.content);
  if (
    content === null ||
    typeof value.created_at !== "string" ||
    typeof value.source !== "string" ||
    value.level !== normalize_log_level(value.level)
  )
    return null;
  return {
    created_at: value.created_at,
    source: value.source,
    level: normalize_log_level(value.level),
    content,
    ...(value.window === false ? { window: false as const } : {}),
    ...(value.error === undefined
      ? {}
      : { error: normalize_log_error(value.error, "unknown_log_error") ?? undefined }),
    ...(typeof value.context === "object" && value.context !== null && !Array.isArray(value.context)
      ? { context: value.context as Record<string, unknown> }
      : {}),
  };
}

/** 校验进度及摘要位置，避免损坏索引指向错误范围。 */
function read_index(bytes: Buffer): IndexRecord | null {
  const value = read_object(bytes);
  if (
    value === null ||
    !is_offset(value.end) ||
    value.end === 0 ||
    !is_offset(value.line) ||
    value.line === 0
  )
    return null;
  if (value.entry === undefined) return { line: value.line, end: value.end };
  if (typeof value.entry !== "object" || value.entry === null) return null;
  const entry = value.entry as Record<string, unknown>;
  if (
    !is_offset(entry.offset) ||
    entry.offset >= value.end ||
    typeof entry.created_at !== "string" ||
    typeof entry.source !== "string" ||
    typeof entry.message_preview !== "string" ||
    !is_offset(entry.message_length) ||
    entry.level !== normalize_log_level(entry.level)
  )
    return null;
  return {
    line: value.line,
    end: value.end,
    entry: {
      offset: entry.offset,
      created_at: entry.created_at,
      source: entry.source,
      level: normalize_log_level(entry.level),
      message_preview: entry.message_preview,
      message_length: entry.message_length,
    },
  };
}

/** 字节位置与行数只接受非负安全整数。 */
function is_offset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** API 与内部调用共用参数约束，日期永远不能变成任意文件路径。 */
function validate_request(request: LogPageRequest): void {
  if (
    !["latest", "before", "after", "check"].includes(request.direction) ||
    typeof request.date !== "string" ||
    !DATE_PATTERN.test(request.date) ||
    (request.limit !== undefined &&
      (!is_offset(request.limit) || request.limit < 1 || request.limit > LOG_PAGE_SIZE)) ||
    (request.direction === "latest" ? request.cursor !== undefined : request.cursor === undefined)
  )
    throw new AppError("request.validation_failed");
  if (request.cursor !== undefined) {
    const cursor = request.cursor;
    if (
      cursor === null ||
      typeof cursor !== "object" ||
      typeof cursor.date !== "string" ||
      !DATE_PATTERN.test(cursor.date) ||
      !is_offset(cursor.line) ||
      typeof cursor.revision !== "string" ||
      cursor.date !== request.date
    )
      throw new AppError("request.validation_failed");
  }
}
