import type { JsonValue } from "../../domain/json";
import { Item } from "../../domain/item";
import { is_json_record } from "../../domain/json";

import * as AppErrors from "../../shared/error";
import type { ProjectChangeItemFieldPatch, ProjectDataSection } from "../../shared/project-event";
import type { ProjectItemWriteFields } from "../../shared/project/project-item-update";

export type ProjectExpectedSectionRevisions = Partial<Record<ProjectDataSection, number>>;

/** Agent 与校对写入口共用的显式 item 身份和前后字段事实。 */
export type ProjectItemWriteChange = Readonly<{
  item_id: number;
  current: Readonly<ProjectItemWriteFields>;
  next: Readonly<ProjectItemWriteFields>;
}>;

export type TranslationItemPatch = {
  item_id: number;
  patch: ProjectChangeItemFieldPatch;
};

/**
 * 将公开 JSON revision map 收窄为 Store 可直接消费的请求类型。
 */
export function normalize_project_expected_section_revisions(
  value: JsonValue | undefined,
): ProjectExpectedSectionRevisions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const expected: ProjectExpectedSectionRevisions = {};
  for (const [section, revision] of Object.entries(value)) {
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: {
          reason: "invalid_expected_section_revision",
          section,
        },
      });
    }
    expected[section as ProjectDataSection] = revision;
  }
  return expected;
}

/**
 * 写服务需要 revision guard 时拒绝缺失或非对象请求。
 */
export function require_project_expected_section_revisions(
  value: JsonValue | undefined,
): ProjectExpectedSectionRevisions {
  const expected = normalize_project_expected_section_revisions(value);
  if (expected === null) {
    throw new AppErrors.AppError("request.validation_failed");
  }
  return expected;
}

/**
 * 将任务 artifact 收窄为 Store 可直接提交的翻译字段 patch。
 */
export function normalize_translation_item_patches(
  value: JsonValue | undefined,
): TranslationItemPatch[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason: "empty_translation_item_patch" },
    });
  }
  const patches: TranslationItemPatch[] = [];
  const seen = new Set<number>();
  for (const raw_item of value) {
    if (!is_json_record(raw_item)) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "invalid_translation_item_patch" },
      });
    }
    const item_id = read_positive_integer(raw_item["item_id"], "invalid_translation_item_id");
    if (seen.has(item_id)) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: {
          reason: "duplicate_translation_item_patch",
          item_id,
        },
      });
    }
    seen.add(item_id);
    const patch: TranslationItemPatch["patch"] = {};
    if (Object.hasOwn(raw_item, "dst")) {
      if (typeof raw_item["dst"] !== "string") {
        throw new AppErrors.AppError("runtime.internal_invariant", {
          diagnostic_context: { reason: "invalid_translation_dst", item_id },
        });
      }
      patch.dst = raw_item["dst"];
    }
    if (Object.hasOwn(raw_item, "name_dst")) {
      patch.name_dst = Item.normalize_name_field(raw_item["name_dst"]);
    }
    if (Object.hasOwn(raw_item, "status")) {
      patch.status = Item.normalize_status(raw_item["status"]);
    }
    if (Object.hasOwn(raw_item, "retry_count")) {
      patch.retry_count = read_non_negative_integer(
        raw_item["retry_count"],
        "invalid_translation_retry_count",
        item_id,
      );
    }
    if (Object.keys(patch).length === 0) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "empty_translation_item_patch", item_id },
      });
    }
    patches.push({ item_id, patch });
  }
  return patches;
}

/** 任务 artifact 要求的正整数主键。 */
function read_positive_integer(value: JsonValue | undefined, reason: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason },
    });
  }
  return parsed;
}

/** 允许 0 的整数字段，失败时附带 item_id。 */
function read_non_negative_integer(
  value: JsonValue | undefined,
  reason: string,
  item_id: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason, item_id },
    });
  }
  return parsed;
}
