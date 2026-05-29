import type { ApiJsonValue } from "../../api/api-types";
import type { JsonRecord, MutableJsonRecord } from "../run/task-run-types";
import type { TaskProgressSnapshot } from "./engine-options";

// 进度字段默认值集中在这里，避免 runner 新增字段时漏写归零逻辑
const EMPTY_PROGRESS: TaskProgressSnapshot = {
  start_time: 0,
  time: 0,
  total_line: 0,
  line: 0,
  processed_line: 0,
  error_line: 0,
  total_tokens: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
};

/**
 * 任务进度快照工具，复刻历史 `TaskProgressSnapshot` 的数值口径
 */
export class TaskProgressSnapshotTool {
  /**
   * 创建新任务进度，start_time 使用秒级浮点数兼容旧前端展示
   */
  public static empty(total_line = 0, start_time = Date.now() / 1000): TaskProgressSnapshot {
    return { ...EMPTY_PROGRESS, total_line, start_time };
  }

  /**
   * 从数据库 meta 或 executor payload 恢复进度，坏值统一归零
   */
  public static from_record(value: ApiJsonValue | undefined): TaskProgressSnapshot {
    const record = this.is_record(value) ? value : {};
    return {
      start_time: this.read_float(record["start_time"], 0),
      time: this.read_float(record["time"], 0),
      total_line: this.read_number(record["total_line"], 0),
      line: this.read_number(record["line"], 0),
      processed_line: this.read_number(record["processed_line"], 0),
      error_line: this.read_number(record["error_line"], 0),
      total_tokens: this.read_number(record["total_tokens"], 0),
      total_input_tokens: this.read_number(record["total_input_tokens"], 0),
      total_output_tokens: this.read_number(record["total_output_tokens"], 0),
    };
  }

  /**
   * 更新耗时字段时只依赖 start_time，避免多个 runner 各自累计误差
   */
  public static with_elapsed(snapshot: TaskProgressSnapshot): TaskProgressSnapshot {
    if (snapshot.start_time <= 0) {
      return { ...snapshot, time: 0 };
    }
    return { ...snapshot, time: Math.max(0, Date.now() / 1000 - snapshot.start_time) };
  }

  /**
   * 累计 token 并同步 total_tokens，保持输入输出字段是唯一来源
   */
  public static add_tokens(
    snapshot: TaskProgressSnapshot,
    input_tokens: number,
    output_tokens: number,
  ): TaskProgressSnapshot {
    const total_input_tokens = snapshot.total_input_tokens + Math.trunc(input_tokens);
    const total_output_tokens = snapshot.total_output_tokens + Math.trunc(output_tokens);
    return {
      ...snapshot,
      total_input_tokens,
      total_output_tokens,
      total_tokens: total_input_tokens + total_output_tokens,
    };
  }

  /**
   * 更新行数统计，并默认让 line 等于 processed + error
   */
  public static with_counts(
    snapshot: TaskProgressSnapshot,
    counts: Partial<Pick<TaskProgressSnapshot, "total_line" | "processed_line" | "error_line">>,
  ): TaskProgressSnapshot {
    const processed_line = counts.processed_line ?? snapshot.processed_line;
    const error_line = counts.error_line ?? snapshot.error_line;
    return {
      ...snapshot,
      total_line: counts.total_line ?? snapshot.total_line,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 转成可写入 database meta 的普通 JSON 对象
   */
  public static to_record(snapshot: TaskProgressSnapshot): MutableJsonRecord {
    return { ...snapshot };
  }

  /**
   * record 判断集中处理，避免数组被当成进度对象
   */
  private static is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 整数字段保持历史 int 语义，非法值走 fallback
   */
  private static read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * 时间字段允许小数，避免耗时显示被截断
   */
  private static read_float(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
  }
}
