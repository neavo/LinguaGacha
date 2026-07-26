import { Item, is_item_status, type ItemNameField, type ItemStatus } from "../../domain/item";
import { are_item_name_fields_equal } from "../item-name";
import type { ProjectChangeItemFieldPatch } from "../project-event";

const PROJECT_ITEM_FIELD_PATCH_KEYS = ["dst", "name_dst", "status", "retry_count"] as const;

type ProjectItemFieldPatchKey = (typeof PROJECT_ITEM_FIELD_PATCH_KEYS)[number];

type ProjectItemFieldPatchSource = {
  dst?: unknown;
  name_dst?: unknown;
  status?: unknown;
  retry_count?: unknown;
};

type ProjectItemFieldPatchTarget = {
  dst: string;
  name_dst: ItemNameField;
  status: string;
  retry_count: number;
};

function has_own_field(
  value: ProjectItemFieldPatchSource,
  field: ProjectItemFieldPatchKey,
): boolean {
  return Object.hasOwn(value, field);
}

function is_record(value: unknown): value is ProjectItemFieldPatchSource {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
export function apply_project_item_field_patch<TItem extends ProjectItemFieldPatchTarget>(
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
