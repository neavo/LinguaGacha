import type { DatabaseSync } from "node:sqlite";

import { is_task_progress_status } from "../../../shared/task";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type CheckpointMigrationRow = Record<string, unknown>;

// 旧 item 状态与当前任务进度状态的最小映射表，迁移只在这组值域间折返。
const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST";
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED";
const CURRENT_NONE = "NONE";

/**
 * 迁移背景：
 * 旧分析 checkpoint 可能持久化 item 时代的运行中/历史状态。
 * 当前 checkpoint 只允许任务进度三态，运行态不再承担旧值过滤。
 *
 * 生效场景：
 * `.lg` schema 可用后，打开旧工程时写回 `analysis_item_checkpoint.status`。
 *
 * 不处理范围：
 * 分析候选聚合、extras 和 item 本体状态分别由其它迁移或业务操作维护。
 */
export const analysis_checkpoint_status_migration: MigrationDescriptor = {
  id: "analysis-checkpoint-status",
  order: 500,
  /**
   * checkpoint 状态迁移在 item 和 TRANS 迁移之后执行，只处理分析进度表自己的状态列。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    AnalysisCheckpointStatusMigration.run(context.db);
  },
};

/**
 * 负责把旧 checkpoint 状态列一次性收敛为当前任务进度值域。
 */
export class AnalysisCheckpointStatusMigration {
  /**
   * 遍历 checkpoint 行并就地写回当前任务进度三态。
   */
  public static run(db: DatabaseSync): void {
    const rows = db.prepare("SELECT item_id, status FROM analysis_item_checkpoint").all();
    const update = db.prepare("UPDATE analysis_item_checkpoint SET status = ? WHERE item_id = ?");
    for (const row of rows) {
      const raw_status = row_text(row, "status");
      const normalized_status = this.normalize_checkpoint_status_value(raw_status);
      if (raw_status !== normalized_status) {
        update.run(normalized_status, row_number(row, "item_id"));
      }
    }
  }

  /**
   * 旧 item 状态映射到任务进度状态；未知值回到待处理，避免运行态继续过滤坏值。
   */
  public static normalize_checkpoint_status_value(value: unknown): string {
    const raw_value = String(value ?? "");
    if (raw_value === LEGACY_PROCESSED_IN_PAST) {
      return CURRENT_PROCESSED;
    }
    if (raw_value === LEGACY_PROCESSING) {
      return CURRENT_NONE;
    }
    return is_task_progress_status(raw_value) ? raw_value : CURRENT_NONE;
  }
}

/**
 * checkpoint 状态读取统一收窄为字符串。
 */
function row_text(row: CheckpointMigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * checkpoint item_id 写回前统一转 number，兼容 SQLite bigint 返回。
 */
function row_number(row: CheckpointMigrationRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}
