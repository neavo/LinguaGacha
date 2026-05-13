import type { LogManager } from "../../log/log-manager";
import type { MutableJsonRecord } from "../runtime/task-runtime-types";

export type ReplayLogEntry = {
  level: "info" | "warning" | "error";
  message: string;
};

/**
 * TaskLogReplay 统一任务生命周期日志和 worker 日志回放，避免 Engine 主流程夹杂日志格式细节
 */
export class TaskLogReplay {
  /**
   * log_manager 是日志文件、控制台和日志窗口的唯一写入口
   */
  public constructor(private readonly log_manager: LogManager) {}

  /**
   * 任务启动日志输出“API 名称 / 地址 / 模型”三行诊断
   */
  public task_run_start(task_label: string, model: MutableJsonRecord): void {
    this.append(
      "info",
      `${task_label}启动\nAPI 名称 - ${String(model["name"] ?? "")}\nAPI 地址 - ${String(
        model["api_url"] ?? "",
      )}\n模型 - ${String(model["model_id"] ?? "")}`,
      "engine",
    );
  }

  /**
   * 任务终态日志和公开 task snapshot 分开写，避免只看日志时丢失收尾信息
   */
  public task_run_finish(task_label: string, status: "idle" | "done" | "error"): void {
    const message =
      status === "done"
        ? `${task_label}完成。`
        : status === "idle"
          ? `${task_label}已停止。`
          : `${task_label}失败。`;
    this.append(status === "error" ? "warning" : "info", message, "engine");
  }

  /**
   * worker 返回的日志仍由 main 侧 LogManager 写出，保证文件、控制台和日志窗口三类目标不分叉
   */
  public work_unit_logs(logs?: ReplayLogEntry[]): void {
    if (logs === undefined) {
      return;
    }
    for (const entry of logs) {
      this.append(entry.level, entry.message, "engine-worker");
    }
  }

  /**
   * 任务异常统一写入应用日志，便于和 work-unit 日志并排排查
   */
  public task_error(message: string, error: unknown): void {
    this.log_manager.error(message, {
      source: "engine",
      error_message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  /**
   * 测试桩可能只实现部分日志方法；生产环境仍会走完整 LogManager
   */
  private append(level: ReplayLogEntry["level"], message: string, source: string): void {
    const log_manager = this.log_manager as Partial<Pick<LogManager, "info" | "warning" | "error">>;
    log_manager[level]?.(message, { source });
  }
}
