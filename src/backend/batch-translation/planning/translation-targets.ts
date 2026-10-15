import type { ItemStatus } from "../../../domain/item";
import type { TextTaskItemRecord } from "../../../shared/text/text-processing";
import { AppError } from "../../../shared/error";
import { read_task_item_id, read_task_item_status } from "../translation-item";

/** 保留完整语境和工程顺序，只在执行副本中重置已选目标。 */
export function prepare_translation_targets(
  items: readonly TextTaskItemRecord[],
  item_ids?: readonly number[],
  item_statuses?: readonly ItemStatus[],
  reset = false,
): { items: TextTaskItemRecord[]; target_ids: ReadonlySet<number> } {
  const selected = item_ids === undefined ? null : new Set(item_ids);
  const statuses = item_statuses === undefined ? null : new Set<string>(item_statuses);
  if (selected !== null) {
    const existing = new Set(items.map(read_task_item_id));
    if ([...selected].some((id) => !existing.has(id)))
      throw new AppError("request.validation_failed");
  }
  const target_ids = new Set<number>();
  const prepared = items.map((item) => {
    const id = read_task_item_id(item);
    const status = read_task_item_status(item);
    const eligible = statuses === null || statuses.has(status);
    if ((selected !== null && !selected.has(id)) || !eligible) return item;
    target_ids.add(id);
    return {
      ...item,
      ...(reset ? { dst: "" } : {}),
      status: "NONE",
    };
  });
  return { items: prepared, target_ids };
}
