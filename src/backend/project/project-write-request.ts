import type { JsonValue } from "../../domain/json";
import { PROJECT_REVISION_SCHEMA } from "../../domain/project-revision";
import { Check } from "typebox/value";
import { normalize_item_name_field, normalize_item_status } from "../../domain/item";
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
    if (!Check(PROJECT_REVISION_SCHEMA, revision)) {
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
 * 将批次条目收窄为翻译字段补丁。空集合表示本批次只提交用量。
 */
export function normalize_translation_item_patches(
  value: JsonValue | undefined,
): TranslationItemPatch[] {
  if (!Array.isArray(value)) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason: "invalid_translation_item_patches" },
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
      patch.name_dst = normalize_item_name_field(raw_item["name_dst"]);
    }
    if (Object.hasOwn(raw_item, "status")) {
      patch.status = normalize_item_status(raw_item["status"]);
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

/** 翻译条目使用的正整数主键。 */
function read_positive_integer(value: JsonValue | undefined, reason: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason },
    });
  }
  return parsed;
}
