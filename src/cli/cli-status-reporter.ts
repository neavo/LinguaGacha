import type { CLICommandName } from "./cli-parser";
import type { ApiJsonValue } from "../core/api/api-types";
import type { TaskRunStatus } from "../core/engine/protocol/task-types";
import { JsonTool } from "../shared/utils/json-tool";

type NowProvider = () => Date;
type JsonLineWriter = (line: string) => void;

export interface CLIProgressStats {
  total: number; // total 是外部协议中的任务总量，不暴露内部 total_line 命名
  skipped: number; // skipped 保留四卡片形状，CLI 全量任务第一版固定由投影层计算
  failed: number; // failed 对应任务失败行数
  completed: number; // completed 对应任务成功处理行数
  pending: number; // pending 是 total 扣除 skipped / failed / completed 后的剩余量
  percent: number; // percent 是 completed + skipped 在 total 中的占比，保持 number 而非带百分号文本
}

export interface CLIJsonStatusReporterOptions {
  command: CLICommandName;
  now?: NowProvider;
  writeLine: JsonLineWriter;
}

interface CLIProgressInput {
  status: string;
  progress: Record<string, ApiJsonValue>;
}

/**
 * CLI JSONL 状态投影器；它只输出 started / progress / finished 三类机器协议事件。
 */
export class CLIJsonStatusReporter {
  private readonly command: CLICommandName; // command 是外部协议唯一任务标识，task_type 不再重复输出
  private readonly now: NowProvider; // now 注入用于测试稳定时间戳，不读取全局时间
  private readonly write_line: JsonLineWriter; // write_line 是 stdout 的窄写入口，便于 CLI 入口统一替换
  private started = false; // started 防止异常路径重复写开始事件
  private finished = false; // finished 保证最终态只写一次，避免任务错误和导出错误双重上报
  private last_progress_key: string | null = null; // last_progress_key 只记录外部 stats，内部 snapshot revision 不影响协议节流

  /**
   * 构造 CLI 状态投影器，调用方负责提供具体输出目标。
   */
  public constructor(options: CLIJsonStatusReporterOptions) {
    this.command = options.command;
    this.now = options.now ?? (() => new Date());
    this.write_line = options.writeLine;
  }

  /**
   * 输出命令开始事件；运行期错误也会先补发 started，保证调用方看到完整生命周期。
   */
  public emit_started(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.write_event({
      type: "started",
      command: this.command,
      timestamp: this.timestamp(),
    });
  }

  /**
   * 从任务快照投影四卡片进度；外部 stats 未变化时不重复刷屏。
   */
  public emit_progress(snapshot: CLIProgressInput): void {
    const stats = build_cli_progress_stats(snapshot.progress as Record<string, ApiJsonValue>);
    if (this.last_progress_key === null && is_empty_stats(stats)) {
      return;
    }
    const progress_key = JsonTool.stringifyStrict(stats);
    if (progress_key === this.last_progress_key) {
      return;
    }
    this.last_progress_key = progress_key;
    this.write_event({
      type: "progress",
      command: this.command,
      status: String(snapshot.status),
      timestamp: this.timestamp(),
      stats,
    });
  }

  /**
   * 输出最终态；成功和失败都由同一事件表达，进程退出码仍由 CLI 入口负责。
   */
  public emit_finished(status: TaskRunStatus | "error", error?: unknown): void {
    if (this.finished) {
      return;
    }
    this.emit_started();
    this.finished = true;
    const event: Record<string, unknown> = {
      type: "finished",
      command: this.command,
      status,
      timestamp: this.timestamp(),
    };
    if (status === "error" && error !== undefined) {
      event["error"] = {
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.write_event(event);
  }

  /**
   * 统一写出紧凑 JSON 行，避免调用点散落 JSON.stringify 和换行处理。
   */
  private write_event(event: Record<string, unknown>): void {
    this.write_line(JsonTool.stringifyStrict(event));
  }

  /**
   * 所有状态事件统一使用 ISO 时间戳，便于调用方按文本排序和解析。
   */
  private timestamp(): string {
    return this.now().toISOString();
  }
}

/**
 * 全零 stats 只表示任务刚受理但还没有真实进度，started 事件已经覆盖该状态。
 */
function is_empty_stats(stats: CLIProgressStats): boolean {
  return (
    stats.total === 0 &&
    stats.skipped === 0 &&
    stats.failed === 0 &&
    stats.completed === 0 &&
    stats.pending === 0
  );
}

/**
 * 将内部 TaskProgress 投影为稳定四卡片 stats；外部字段不跟随内部 total_line 等命名变化。
 */
export function build_cli_progress_stats(progress: Record<string, ApiJsonValue>): CLIProgressStats {
  const total = Math.max(0, read_progress_count(progress["total_line"]));
  const completed = clamp_count(
    read_progress_count(progress["processed_line"]) > 0
      ? read_progress_count(progress["processed_line"])
      : read_progress_count(progress["line"]),
    0,
    total,
  );
  const failed = clamp_count(read_progress_count(progress["error_line"]), 0, total - completed);
  const skipped = 0;
  const pending = Math.max(0, total - skipped - failed - completed);
  const percent = total > 0 ? ((completed + skipped) / total) * 100 : 0;
  return { total, skipped, failed, completed, pending, percent };
}

/**
 * 进度计数只接受有限数字并向下取整，避免 NaN 或小数进入外部协议。
 */
function read_progress_count(value: ApiJsonValue | undefined): number {
  const number_value = Number(value ?? 0);
  return Number.isFinite(number_value) ? Math.floor(number_value) : 0;
}

/**
 * 计数字段统一夹在合法区间内，保护外部协议不被内部异常快照污染。
 */
function clamp_count(value: number, min_value: number, max_value: number): number {
  return Math.min(max_value, Math.max(min_value, value));
}
