import {
  is_item_status,
  type Item,
  type ItemStatus,
  type ProjectItemPublicRecord,
  type PROJECT_ITEM_MANUAL_UPDATE_SCHEMA,
  normalize_item_status,
} from "../../domain/item";
import type { Static } from "typebox";
import { is_json_record } from "../../domain/json";
import { is_image_item_extra, type ImageItemExtra } from "./image-item";

/** 数据库写入规划使用的翻译字段补丁。 */
export type ProjectItemFieldPatch = Partial<
  Pick<ProjectItemPublicRecord, "dst" | "name_dst" | "status">
> & { extra_field?: ImageItemExtra | "" };

/** 项目 Item 字段写入共同依赖的完整事实。 */
export type ProjectItemWriteFields = Pick<Item, "dst" | "name_dst"> & {
  status: string; // 读取旧项目时可能尚未归一的持久状态
  extra_field?: Item["extra_field"];
};

/** GUI 与 Agent 共用的单条人工 Item 更新意图。 */
export type ProjectItemManualUpdate = Readonly<Static<typeof PROJECT_ITEM_MANUAL_UPDATE_SCHEMA>>;

// 外部 patch 只允许公开字段，坏值和空 patch 都收敛为 null。
export function normalize_project_item_field_patch(value: unknown): ProjectItemFieldPatch | null {
  if (!is_json_record(value)) {
    return null;
  }

  const patch: ProjectItemFieldPatch = {};
  if (typeof value.dst === "string") {
    patch.dst = value.dst;
  }
  if (Object.hasOwn(value, "name_dst")) {
    if (value.name_dst !== null && typeof value.name_dst !== "string") return null;
    patch.name_dst = value.name_dst;
  }
  if (is_item_status(value.status)) {
    patch.status = value.status;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

// 返回新条目或 null，调用方可用 null 区分幂等 patch 与真实状态变化。
export function apply_project_item_field_patch<TItem extends ProjectItemWriteFields>(
  item: TItem,
  patch: ProjectItemFieldPatch | null | undefined,
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
    const name_dst = patch.name_dst ?? null;
    if (name_dst !== item.name_dst) {
      next_item.name_dst = name_dst;
      touched = true;
    }
  }
  if (patch.status !== undefined && patch.status !== item.status) {
    next_item.status = patch.status;
    touched = true;
  }
  if (patch.extra_field !== undefined && patch.extra_field !== item.extra_field) {
    next_item.extra_field = patch.extra_field;
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
  // 同值空姓名保留 `null`，实际编辑才写入字符串。
  if (update.name_dst !== undefined && update.name_dst !== (current.name_dst ?? "")) {
    next.name_dst = update.name_dst;
  }
  if (next.dst !== current.dst || next.name_dst !== current.name_dst) {
    next.status = "PROCESSED";
  }
  if (update.status !== undefined) {
    next.status = update.status;
  }
  return build_project_item_field_patch(current, next) === null ? null : next;
}

/** 对比已校验的条目字段，并将历史状态归一为当前状态。 */
export function build_project_item_field_patch(
  current: ProjectItemWriteFields,
  next: ProjectItemWriteFields,
): ProjectItemFieldPatch | null {
  const patch: ProjectItemFieldPatch = {};
  if (next.dst !== current.dst) patch.dst = next.dst;
  if (next.name_dst !== current.name_dst) patch.name_dst = next.name_dst;
  const status: ItemStatus = normalize_item_status(next.status);
  if (status !== current.status) {
    patch.status = status;
  }
  // 条目更新只接纳图片的私有状态，其它格式的数据由原稿管理。
  if (
    next.extra_field !== current.extra_field &&
    (next.extra_field === "" || is_image_item_extra(next.extra_field))
  )
    patch.extra_field = next.extra_field;

  return Object.keys(patch).length === 0 ? null : patch;
}
