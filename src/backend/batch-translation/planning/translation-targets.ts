import type { BatchTranslationStartCommand } from "../../../domain/batch-translation";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";
import { AppError } from "../../../shared/error";
import { read_task_item_id, read_task_item_status } from "../translation-item";

/** 保留完整语境和工程顺序，只在执行副本中重置已选目标。 */
export function prepare_translation_targets(
  items: readonly TextTaskItemRecord[],
  command: BatchTranslationStartCommand,
): { items: TextTaskItemRecord[]; target_ids: ReadonlySet<number> } {
  const selected = command.scope.kind === "items" ? new Set(command.scope.item_ids) : null;
  if (selected !== null) {
    const existing = new Set(items.map(read_task_item_id));
    if ([...selected].some((id) => !existing.has(id)))
      throw new AppError("request.validation_failed");
  }
  const target_ids = new Set<number>();
  const prepared = items.map((item) => {
    const id = read_task_item_id(item);
    const status = read_task_item_status(item);
    const eligible =
      command.operation === "retranslate" ||
      command.mode === "reset" ||
      status === "NONE" ||
      (command.include_errors === true && status === "ERROR");
    if ((selected !== null && !selected.has(id)) || !eligible) return item;
    target_ids.add(id);
    return {
      ...item,
      ...(command.operation === "translate" && command.mode === "reset" ? { dst: "" } : {}),
      status: "NONE",
      retry_count: 0,
    };
  });
  return { items: prepared, target_ids };
}
