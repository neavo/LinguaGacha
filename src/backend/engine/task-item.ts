import {
  is_task_progress_status,
  is_task_skipped_item_status,
  type TaskProgressStatus,
} from "../../domain/task";
import { read_json_integer, type MutableJsonRecord } from "../../domain/json";

/**
 * 读取任务项当前状态事实。
 */
export function read_task_item_status(item: MutableJsonRecord): string {
  return String(item["status"] ?? "NONE");
}

/**
 * item id 同时兼容数据库内部 id 和公开 item_id。
 */
export function read_task_item_id(item: MutableJsonRecord): number {
  return read_json_integer(item["id"] ?? item["item_id"], 0);
}

/**
 * 分析跳过规则由执行与规划阶段共同复用，避免两处调度语义漂移。
 */
export function is_analyzable_task_item(item: MutableJsonRecord): boolean {
  return (
    !is_task_skipped_item_status(read_task_item_status(item)) &&
    String(item["src"] ?? "").trim() !== ""
  );
}

/**
 * checkpoint 只接受三态状态，坏数据不会影响调度。
 */
export function build_analysis_checkpoint_status_map(
  checkpoints: readonly MutableJsonRecord[],
): Map<number, TaskProgressStatus> {
  const result = new Map<number, TaskProgressStatus>();
  for (const checkpoint of checkpoints) {
    const item_id = read_json_integer(checkpoint["item_id"], 0);
    const status = checkpoint["status"];
    if (item_id > 0 && is_task_progress_status(status)) {
      result.set(item_id, status);
    }
  }
  return result;
}
