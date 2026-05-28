import {
  is_project_runtime_stage,
  type ProjectRuntimeChangeEvent,
  type ProjectRuntimeStage,
} from "@/app/desktop/desktop-project-change-types";
import {
  normalize_section_array,
  normalize_section_revisions,
} from "@/app/desktop/desktop-runtime-event-payload";
import {
  normalizeProjectChangePayloadMode,
  type ProjectChangeItemFieldPatch,
  type ProjectChangeItemsPayload,
  type ProjectChangeJsonRecord,
  type ProjectChangePayloadMode,
} from "@shared/project-event";
import { is_item_status } from "@base/item";

/**
 * Core SSE 与同步 mutation 共享的项目变更载荷，入口处必须立即转成运行态事件。
 */
export type ProjectChangeEventPayload = {
  eventId?: unknown;
  source?: unknown;
  projectPath?: unknown;
  projectRevision?: unknown;
  updatedSections?: unknown;
  items?: unknown;
  files?: unknown;
  sections?: unknown;
  sectionRevisions?: unknown;
};

/**
 * 将后端 project.data_changed / mutation change 载荷收窄为前端运行态刷新事件。
 */
export function normalize_project_change_event(
  payload: ProjectChangeEventPayload,
): ProjectRuntimeChangeEvent | null {
  const project_path = String(payload.projectPath ?? "").trim();
  const updated_sections = normalize_section_array(payload.updatedSections).filter(
    is_project_runtime_stage,
  );
  if (project_path === "" || updated_sections.length === 0) {
    return null;
  }

  const items = normalize_project_change_items(payload.items);
  const files = is_record(payload.files)
    ? {
        payloadMode: normalizeProjectChangePayloadMode(payload.files.payloadMode),
        upsert: normalize_record_map(payload.files.upsert),
        changedPaths: normalize_string_array(payload.files.changedPaths),
        deletePaths: normalize_string_array(payload.files.deletePaths),
      }
    : undefined;
  const sections = normalize_project_change_sections(payload.sections);

  return {
    eventId: String(payload.eventId ?? ""),
    source: String(payload.source ?? "project_change"),
    projectPath: project_path,
    projectRevision: Number(payload.projectRevision ?? 0),
    updatedSections: updated_sections,
    operations: [
      {
        ...(items === undefined ? {} : { items }),
        ...(files === undefined ? {} : { files }),
        sections,
      },
    ],
    sectionRevisions: normalize_section_revisions(payload.sectionRevisions),
  };
}

/**
 * mutation result 需要先证明单个 change 是对象，再进入共享项目变更 normalizer。
 */
export function is_project_change_record(value: unknown): value is Record<string, unknown> {
  return is_record(value);
}

// normalize_project_change_sections 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_project_change_sections(
  value: unknown,
): Partial<Record<ProjectRuntimeStage, { payloadMode: ProjectChangePayloadMode; data: unknown }>> {
  if (!is_record(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([section, raw_payload]) => {
      if (!is_project_runtime_stage(section) || !is_record(raw_payload)) {
        return [];
      }
      const payload_mode: ProjectChangePayloadMode = normalizeProjectChangePayloadMode(
        raw_payload.payloadMode,
      );
      return [[section, { payloadMode: payload_mode, data: raw_payload.data }]];
    }),
  );
}

/**
 * items payload 在运行态入口完成 field-patch 校验；坏 patch 只能触发补读，不能下发半可信字段。
 */
function normalize_project_change_items(value: unknown): ProjectChangeItemsPayload | undefined {
  if (!is_record(value)) {
    return undefined;
  }

  const payload_mode = normalizeProjectChangePayloadMode(value.payloadMode);
  const changed_ids = normalize_number_array(value.changedIds);
  const delete_ids = normalize_number_array(value.deleteIds);

  if (payload_mode === "field-patch") {
    const field_patch = normalize_project_change_item_field_patch(value.fieldPatch);
    if (field_patch === undefined) {
      return {
        payloadMode: "section-invalidated",
        changedIds: changed_ids,
        deleteIds: delete_ids,
      };
    }
    return {
      payloadMode: "field-patch",
      fieldPatch: field_patch,
      changedIds: changed_ids,
      deleteIds: delete_ids,
    };
  }

  return {
    payloadMode: payload_mode,
    ...(payload_mode === "canonical-delta" ? { upsert: normalize_record_map(value.upsert) } : {}),
    changedIds: changed_ids,
    deleteIds: delete_ids,
  };
}

// normalize_record_map 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_record_map(value: unknown): Record<string, ProjectChangeJsonRecord> {
  if (!is_record(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => is_record(entry[1]))
      .map(([key, record]) => [key, { ...record } as ProjectChangeJsonRecord]),
  );
}

// normalize_number_array 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_number_array(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => Number(item))
        .filter((item): item is number => Number.isInteger(item) && item > 0),
    ),
  ];
}

// normalize_string_array 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter((item) => item !== ""))];
}

/**
 * 字段 patch 只保留后端允许的校对字段，status 必须落在 item 状态唯一词表内。
 */
function normalize_project_change_item_field_patch(
  value: unknown,
): ProjectChangeItemFieldPatch | undefined {
  if (!is_record(value)) {
    return undefined;
  }
  const patch: ProjectChangeItemFieldPatch = {};
  if (typeof value.dst === "string") {
    patch.dst = value.dst;
  }
  if (is_item_status(value.status)) {
    patch.status = value.status;
  }
  const retry_count = Number(value.retry_count);
  if (Number.isFinite(retry_count)) {
    patch.retry_count = Math.trunc(retry_count);
  }
  return Object.keys(patch).length === 0 ? undefined : patch;
}

// is_record 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
