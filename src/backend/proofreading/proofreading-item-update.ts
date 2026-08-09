import { Item } from "../../domain/item";
import { are_item_name_fields_equal, write_item_name_text } from "../../shared/item-name";
import type { ProjectItemWriteFields } from "../../shared/project/project-item-field-patch";
import type { ProofreadingManualStatusCode } from "../../shared/proofreading/proofreading-types";

/** 单条校对更新允许触及的字段；item 身份由调用边界单独持有。 */
export type ProofreadingItemUpdateFields = Readonly<{
  dst?: string;
  name_dst?: string;
  status?: ProofreadingManualStatusCode;
}>;

/** GUI 与 Agent 工作区共享的单 item 人工更新语义。 */
export function apply_proofreading_item_update<TItem extends ProjectItemWriteFields>(
  current: TItem,
  update: ProofreadingItemUpdateFields,
): TItem {
  const next = { ...current };
  if (update.dst !== undefined) {
    next.dst = update.dst;
    next.status = update.dst === "" ? Item.normalize_status(next.status) : "PROCESSED";
  }
  if (update.name_dst !== undefined) {
    next.name_dst = write_item_name_text(next.name_dst, update.name_dst);
  }
  if (update.status !== undefined) {
    next.status = update.status;
    next.retry_count = 0;
  }
  return next;
}

/** 只比较人工更新会触及的持久字段。 */
export function are_proofreading_item_write_fields_equal<
  TLeft extends ProjectItemWriteFields,
  TRight extends ProjectItemWriteFields,
>(left: Readonly<TLeft>, right: Readonly<TRight>): boolean {
  return (
    left.dst === right.dst &&
    are_item_name_fields_equal(left.name_dst, right.name_dst) &&
    left.status === right.status &&
    left.retry_count === right.retry_count
  );
}
