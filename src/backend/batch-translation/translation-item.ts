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
