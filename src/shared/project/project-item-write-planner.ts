import type { ItemStatus } from "../../domain/item";
import type { ProjectChangeItemFieldPatch } from "../project-event";
import { coordinate_project_duplicate_statuses } from "./project-item-duplicates";
import {
  apply_project_item_field_patch,
  build_project_item_field_patch,
  type ProjectItemWriteFields,
} from "./project-item-update";

export type ProjectItemWriteRecord = Omit<ProjectItemWriteFields, "status"> & {
  item_id: number; // 数据库与公开事件共享的稳定身份
  file_path: string; // 重复组文件边界
  row_number: number; // 文件内确定性顺序
  src: string; // 重复组原文键
  status: ItemStatus; // 已归一的当前状态
};

export type ProjectItemExplicitChange = Readonly<{
  item_id: number; // 显式意图目标
  current: Readonly<ProjectItemWriteFields>; // 调用边界观察的旧事实
  next: Readonly<ProjectItemWriteFields>; // 调用边界解释后的目标事实
}>;

export type ProjectItemPlannedChange = Readonly<{
  item_id: number; // 实际变化条目，包含同组被动变化
  current: Readonly<ProjectItemWriteRecord>; // 事务开始时事实
  next: Readonly<ProjectItemWriteRecord>; // 协调完成后的事实
  patch: ProjectChangeItemFieldPatch; // 数据库最小字段补丁
}>;

/**
 * 在事务快照上重放显式字段意图，再维护受影响同文组的被动状态，返回数据库需要的完整实际差异。
 */
export function plan_project_item_changes(args: {
  items: readonly ProjectItemWriteRecord[];
  explicit_changes: readonly ProjectItemExplicitChange[];
  duplicate_filter_enabled: boolean;
}): ProjectItemPlannedChange[] {
  const current_by_id = new Map(args.items.map((item) => [item.item_id, { ...item }]));
  const next_by_id = new Map(args.items.map((item) => [item.item_id, { ...item }]));
  const affected_item_ids = new Set<number>(); // 只有状态变化会改变当前可写字段下的重复资格

  for (const explicit of args.explicit_changes) {
    const current = next_by_id.get(explicit.item_id);
    if (current === undefined) continue;
    const intent_patch = build_project_item_field_patch(explicit.current, explicit.next);
    const next = apply_project_item_field_patch(current, intent_patch);
    if (next === null) continue;
    next_by_id.set(explicit.item_id, next);
    if (current.status !== next.status) affected_item_ids.add(explicit.item_id);
  }

  const duplicate_changes = coordinate_project_duplicate_statuses(
    [...next_by_id.values()],
    args.duplicate_filter_enabled,
    affected_item_ids,
  );
  for (const change of duplicate_changes) {
    const current = next_by_id.get(change.item_id);
    if (current === undefined) continue;
    next_by_id.set(change.item_id, { ...current, status: change.status });
  }

  const changes: ProjectItemPlannedChange[] = [];
  for (const [item_id, next] of next_by_id) {
    const current = current_by_id.get(item_id);
    if (current === undefined) continue;
    const patch = build_project_item_field_patch(current, next);
    if (patch !== null) changes.push({ item_id, current, next, patch });
  }
  return changes;
}
