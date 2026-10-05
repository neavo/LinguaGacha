import {
  Item,
  is_item_status,
  type ItemManualStatus,
  type ItemNameField,
  type ItemStatus,
} from "../../domain/item";
import { is_json_record } from "../../domain/json";
import {
  are_item_name_fields_equal,
  read_item_name_text,
  write_item_name_text,
} from "../item-name";
import type { ProjectChangeItemFieldPatch } from "../project-event";

/** 项目 Item 字段写入共同依赖的完整事实。 */
export type ProjectItemWriteFields = {
  dst: string; // 正文译文
  name_dst: ItemNameField; // 角色姓名译文
  status: string; // 读取旧项目时可能尚未归一的持久状态
};

/** GUI 与 Agent 共用的单条人工 Item 更新意图。 */
export type ProjectItemManualUpdate = Readonly<{
  dst?: string; // 人工确认的正文译文，允许空字符串
  name_dst?: string; // 姓名第 0 槽的人工译文
  status?: ItemManualStatus; // 最终人工状态意图
}>;

/** 差异构造允许消费尚未完成边界收窄的字段来源。 */
type ProjectItemFieldPatchSource = {
  dst?: unknown;
  name_dst?: unknown;
  status?: unknown;
};

// 外部 patch 只允许公开字段，坏值和空 patch 都收敛为 null。
export function normalize_project_item_field_patch(
  value: unknown,
): ProjectChangeItemFieldPatch | null {
  if (!is_json_record(value)) {
    return null;
  }

  const patch: ProjectChangeItemFieldPatch = {};
  if (typeof value.dst === "string") {
    patch.dst = value.dst;
  }
  if (Object.hasOwn(value, "name_dst")) {
    patch.name_dst = Item.normalize_name_field(value.name_dst);
  }
  if (is_item_status(value.status)) {
    patch.status = value.status;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

// 返回新条目或 null，调用方可用 null 区分幂等 patch 与真实状态变化。
export function apply_project_item_field_patch<TItem extends ProjectItemWriteFields>(
  item: TItem,
  patch: ProjectChangeItemFieldPatch | null | undefined,
): TItem | null {
  if (patch === null || patch === undefined) {
    return null;
  }

  const next_item: TItem = { ...item };
  let touched = false;
  if (typeof patch.dst === "string" && patch.dst !== item.dst) {
    next_item.dst = patch.dst;
    touched = true;
  }
  if (Object.hasOwn(patch, "name_dst")) {
    const name_dst = Item.normalize_name_field(patch.name_dst);
    if (!are_item_name_fields_equal(name_dst, item.name_dst)) {
      next_item.name_dst = name_dst;
      touched = true;
    }
  }
  if (patch.status !== undefined && patch.status !== item.status) {
    next_item.status = patch.status;
    touched = true;
  }

  return touched ? next_item : null;
}

/**
 * 正文或可见姓名实际变化时默认完成条目，同值提交保持原状。
 * 显式状态拥有最终优先级，也可单独提交以确认现有结果。
 */
export function apply_project_item_manual_update<TItem extends ProjectItemWriteFields>(
  current: TItem,
  update: ProjectItemManualUpdate,
): TItem | null {
  const next: TItem = { ...current };
  if (update.dst !== undefined) next.dst = update.dst;
  // 同值可见姓名保留 null、标量或数组形状，实际编辑才写第 0 槽。
  if (update.name_dst !== undefined && update.name_dst !== read_item_name_text(current.name_dst)) {
    next.name_dst = write_item_name_text(next.name_dst, update.name_dst);
  }
  if (next.dst !== current.dst || !are_item_name_fields_equal(next.name_dst, current.name_dst)) {
    next.status = "PROCESSED";
  }
  if (update.status !== undefined) {
    next.status = update.status;
  }
  return build_project_item_field_patch(current, next) === null ? null : next;
}

// 对比当前与下一状态生成最小字段 patch，姓名比较复用领域归一语义。
export function build_project_item_field_patch(
  current: ProjectItemFieldPatchSource,
  next: ProjectItemFieldPatchSource,
): ProjectChangeItemFieldPatch | null {
  const patch: ProjectChangeItemFieldPatch = {};
  if (typeof next.dst === "string" && next.dst !== current.dst) {
    patch.dst = next.dst;
  }
  if (Object.hasOwn(next, "name_dst")) {
    const name_dst = Item.normalize_name_field(next.name_dst);
    if (!are_item_name_fields_equal(name_dst, current.name_dst)) {
      patch.name_dst = name_dst;
    }
  }
  const status: ItemStatus = Item.normalize_status(next.status);
  if (status !== current.status) {
    patch.status = status;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
