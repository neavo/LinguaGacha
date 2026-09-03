import {
  Item,
  is_item_status,
  type ItemManualStatus,
  type ItemNameField,
  type ItemStatus,
} from "../../domain/item";
import { are_item_name_fields_equal, write_item_name_text } from "../item-name";
import type { ProjectChangeItemFieldPatch } from "../project-event";

/** 跨缓存与数据库传播的完整 Item 字段补丁词表。 */
const PROJECT_ITEM_FIELD_PATCH_KEYS = ["dst", "name_dst", "status", "retry_count"] as const;

type ProjectItemFieldPatchKey = (typeof PROJECT_ITEM_FIELD_PATCH_KEYS)[number];

/** 项目 Item 字段写入共同依赖的完整事实。 */
export type ProjectItemWriteFields = {
  dst: string; // 正文译文
  name_dst: ItemNameField; // 角色姓名译文
  status: string; // 持久状态；读取旧项目时可能尚未归一
  retry_count: number; // 自动翻译重试次数
};

/** GUI 与 Agent 共用的单条人工 Item 更新意图。 */
export type ProjectItemManualUpdate = Readonly<{
  dst?: string; // 人工确认的正文译文，允许空字符串
  name_dst?: string; // 姓名第一个槽位的人工译文
  status?: ItemManualStatus; // 最终人工状态意图
}>;

/** 差异构造允许消费尚未完成边界收窄的字段来源。 */
type ProjectItemFieldPatchSource = {
  dst?: unknown;
  name_dst?: unknown;
  status?: unknown;
  retry_count?: unknown;
};

/** 区分缺失字段与显式 null，供姓名字段 patch 使用。 */
function has_own_field(
  value: ProjectItemFieldPatchSource,
  field: ProjectItemFieldPatchKey,
): boolean {
  return Object.hasOwn(value, field);
}

/** 收窄外部字段 patch 的普通对象外壳。 */
function is_record(value: unknown): value is ProjectItemFieldPatchSource {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 空 patch 不产生写入或事件。 */
function is_project_item_field_patch_empty(
  patch: ProjectChangeItemFieldPatch | null | undefined,
): boolean {
  return patch === null || patch === undefined || Object.keys(patch).length === 0;
}

// 外部 patch 只允许四个公开字段，坏值和空 patch 都收敛为 null。
export function normalize_project_item_field_patch(
  value: unknown,
): ProjectChangeItemFieldPatch | null {
  if (!is_record(value)) {
    return null;
  }

  const patch: ProjectChangeItemFieldPatch = {};
  if (typeof value.dst === "string") {
    patch.dst = value.dst;
  }
  if (has_own_field(value, "name_dst")) {
    patch.name_dst = Item.normalize_name_field(value.name_dst);
  }
  if (is_item_status(value.status)) {
    patch.status = value.status;
  }
  const retry_count = Number(value.retry_count);
  if (Number.isFinite(retry_count)) {
    patch.retry_count = Math.trunc(retry_count);
  }

  return is_project_item_field_patch_empty(patch) ? null : patch;
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
  if (typeof patch.retry_count === "number" && patch.retry_count !== item.retry_count) {
    next_item.retry_count = patch.retry_count;
    touched = true;
  }

  return touched ? next_item : null;
}

/**
 * 将人工意图解释为最终字段事实。正文实际变化表示人工接受当前结果，统一完成状态并清除自动重试历史；
 * 显式状态拥有最终优先级，姓名译文不改变正文任务状态。
 */
export function apply_project_item_manual_update<TItem extends ProjectItemWriteFields>(
  current: TItem,
  update: ProjectItemManualUpdate,
): TItem | null {
  const next: TItem = { ...current };
  if (update.dst !== undefined) {
    if (update.dst !== current.dst) {
      next.dst = update.dst;
      next.status = "PROCESSED";
      next.retry_count = 0;
    } else if (update.dst !== "" && current.status === "ERROR") {
      // 相同非空译文可用于确认既有结果并结束错误态。
      next.status = "PROCESSED";
      next.retry_count = 0;
    }
  }
  if (update.name_dst !== undefined) {
    next.name_dst = write_item_name_text(next.name_dst, update.name_dst);
  }
  if (update.status !== undefined) {
    next.status = update.status;
    next.retry_count = 0;
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
  if (has_own_field(next, "name_dst")) {
    const name_dst = Item.normalize_name_field(next.name_dst);
    if (!are_item_name_fields_equal(name_dst, current.name_dst)) {
      patch.name_dst = name_dst;
    }
  }
  const status: ItemStatus = Item.normalize_status(next.status);
  if (status !== current.status) {
    patch.status = status;
  }
  const retry_count = Number(next.retry_count);
  if (Number.isFinite(retry_count) && retry_count !== Number(current.retry_count)) {
    patch.retry_count = Math.max(0, Math.trunc(retry_count));
  }

  return is_project_item_field_patch_empty(patch) ? null : patch;
}
