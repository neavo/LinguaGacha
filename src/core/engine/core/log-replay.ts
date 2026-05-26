import type { LogManager } from "../../log/log-manager";
import type { MutableJsonRecord } from "../runtime/task-runtime-types";
import type { WorkUnitLogEntry } from "../protocol/work-unit";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../../shared/i18n";

export type ReplayLogEntry = WorkUnitLogEntry;

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
  public task_run_start(
    model: MutableJsonRecord,
    app_language: unknown,
    prompt_text: string | null = null,
  ): void {
    this.append({ level: "info", message: "" }, "engine");
    this.append(
      {
        level: "info",
        message: `${this.t(app_language, "app.log.engine_api_name")} - ${String(model["name"] ?? "")}`,
      },
      "engine",
    );
    this.append(
      {
        level: "info",
        message: `${this.t(app_language, "app.log.engine_api_url")} - ${String(model["api_url"] ?? "")}`,
      },
      "engine",
    );
    this.append(
      {
        level: "info",
        message: `${this.t(app_language, "app.log.engine_api_model")} - ${String(model["model_id"] ?? "")}`,
      },
      "engine",
    );
    this.append({ level: "info", message: "" }, "engine");
    const normalized_prompt_text = prompt_text?.trim() ?? "";
    if (normalized_prompt_text !== "") {
      this.append({ level: "info", message: normalized_prompt_text }, "engine");
      this.append({ level: "info", message: "" }, "engine");
    }
  }

  /**
   * 任务终态日志和公开 task snapshot 分开写，避免只看日志时丢失收尾信息
   */
  public task_run_finish(status: "idle" | "done" | "error", app_language: unknown): void {
    const message =
      status === "done"
        ? this.t(app_language, "app.log.engine_task_done")
        : status === "idle"
          ? this.t(app_language, "app.log.engine_task_stop")
          : this.t(app_language, "app.log.engine_task_fail");
    this.append({ level: "info", message: "" }, "engine");
    this.append({ level: status === "error" ? "warning" : "info", message }, "engine");
    this.append({ level: "info", message: "" }, "engine");
  }

  /**
   * worker 返回的日志仍由 Core LogManager 写出，保证文件、控制台和日志窗口三类目标不分叉
   */
  public work_unit_logs(logs?: ReplayLogEntry[]): void {
    if (logs === undefined) {
      return;
    }
    for (const entry of logs) {
      this.append(entry, "engine-worker");
    }
  }

  /**
   * 任务异常统一写入应用日志，便于和 work-unit 日志并排排查
   */
  public task_error(message: string, error: unknown): void {
    this.log_manager.error(message, {
      source: "engine",
      error,
    });
  }

  /**
   * 测试桩可能只实现部分日志方法；生产环境仍会走完整 LogManager
   */
  private append(entry: ReplayLogEntry, source: string): void {
    const log_manager = this.log_manager as Partial<Pick<LogManager, "info" | "warning" | "error">>;
    log_manager[entry.level]?.(entry.message, {
      source,
      error: entry.error,
      context: entry.context,
    });
  }

  // t 封装类内部的非显然分支，避免调用方重复理解同一约束。
  private t(app_language: unknown, key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_i18n_locale(app_language), key, params);
  }
}
