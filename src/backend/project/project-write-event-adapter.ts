import {
  is_json_record,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import type { ProjectDatabase } from "../database/database-operations";
import * as AppErrors from "../../shared/error";
import type {
  ProjectChangeEvent,
  ProjectChangeFilesPayload,
  ProjectChangeItemsPayload,
  ProjectChangePayloadMode,
  ProjectChangeSectionPayload,
  ProjectDataSection,
} from "../../shared/project-event";
import { ProjectDataReader } from "./project-data-reader";
import type { ProjectSessionState } from "./project-session-state";

export type ProjectWriteChangeRequest = {
  projectPath: string;
  source: string;
  updatedSections: ProjectDataSection[];
  items?: Pick<
    ProjectChangeItemsPayload,
    "payloadMode" | "changedIds" | "deleteIds" | "fieldPatch"
  >;
  files?: Pick<ProjectChangeFilesPayload, "payloadMode" | "changedPaths" | "deletePaths">;
  sections?: Partial<
    Record<ProjectDataSection, Pick<ProjectChangeSectionPayload, "payloadMode" | "data">>
  >;
  sectionModes?: Partial<Record<ProjectDataSection, ProjectChangePayloadMode>>;
};

export type ProjectChangePublisher = (
  payload: ProjectWriteChangeRequest,
) => ProjectChangeEvent | null;

/**
 * 将 Store 的提交描述适配为公开 ProjectChangeEvent。
 */
export function adapt_project_change(
  database: ProjectDatabase,
  session_state: ProjectSessionState,
  payload: ProjectWriteChangeRequest,
): ProjectChangeEvent | null {
  const state = session_state.snapshot();
  const project_path = payload.projectPath.trim();
  if (project_path === "") {
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason: "project_change_target_missing" },
    });
  }
  if (!state.loaded || state.projectPath !== project_path) {
    return null;
  }

  const data_reader = new ProjectDataReader(database);
  const normalized = normalize_change_request(payload);
  const meta = data_reader.get_all_meta(project_path);
  const all_section_revisions = data_reader.build_section_revisions(meta);
  // 工程 revision 取全量最大值；事件只投影本次变化 section 的当前 revision。
  return {
    type: "project.changed",
    eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    source: normalized.source,
    projectPath: project_path,
    projectRevision: Math.max(...Object.values(all_section_revisions), 0),
    sectionRevisions: Object.fromEntries(
      normalized.updatedSections.map((section) => [section, all_section_revisions[section]]),
    ),
    updatedSections: normalized.updatedSections,
    ...build_items_payload(data_reader, normalized.items, project_path),
    ...build_files_payload(data_reader, normalized.files, project_path),
    ...build_sections_payload(data_reader, normalized.sections, {
      projectPath: project_path,
      projectState: state,
      updatedSections: normalized.updatedSections,
    }),
  };
}

/**
 * 组合根可直接注入 Store 的函数类型。
 */
export function create_project_change_publisher(
  database: ProjectDatabase,
  session_state: ProjectSessionState,
): ProjectChangePublisher {
  return (payload) => adapt_project_change(database, session_state, payload);
}

/**
 * 补齐未显式给出的 section 载荷模式，items/files 默认 section-invalidated。
 */
function normalize_change_request(request: ProjectWriteChangeRequest): ProjectWriteChangeRequest {
  const sections = { ...request.sections };
  for (const section of request.updatedSections) {
    if (
      has_explicit_section_payload(request, section) ||
      section === "items" ||
      section === "files"
    ) {
      continue;
    }
    sections[section] = { payloadMode: request.sectionModes?.[section] ?? "canonical-delta" };
  }
  return {
    ...request,
    items:
      request.items ??
      (request.updatedSections.includes("items") && !has_explicit_section_payload(request, "items")
        ? { payloadMode: "section-invalidated" }
        : undefined),
    files:
      request.files ??
      (request.updatedSections.includes("files") && !has_explicit_section_payload(request, "files")
        ? { payloadMode: "section-invalidated" }
        : undefined),
    ...(Object.keys(sections).length === 0 ? {} : { sections }),
  };
}

/** 调用方是否已为指定 section 提供 sections 载荷。 */
function has_explicit_section_payload(
  request: ProjectWriteChangeRequest,
  section: ProjectDataSection,
): boolean {
  return (
    request.sections !== undefined &&
    Object.prototype.hasOwnProperty.call(request.sections, section)
  );
}

/** 按 payloadMode 组装公开 items 变更。 */
function build_items_payload(
  data_reader: ProjectDataReader,
  value: ProjectWriteChangeRequest["items"],
  project_path: string,
): { items?: ProjectChangeItemsPayload } {
  if (value === undefined) {
    return {};
  }
  const changed_ids = value.changedIds ?? [];
  const delete_ids = value.deleteIds ?? [];
  const field_patch = value.payloadMode === "field-patch" ? value.fieldPatch : undefined;
  const upsert =
    value.payloadMode === "canonical-delta"
      ? build_item_upsert_payload(data_reader, project_path, changed_ids)
      : undefined;
  return {
    items: {
      payloadMode: value.payloadMode,
      ...(upsert === undefined ? {} : { upsert }),
      ...(field_patch === undefined || Object.keys(field_patch).length === 0
        ? {}
        : { fieldPatch: field_patch }),
      ...(changed_ids.length === 0 ? {} : { changedIds: changed_ids }),
      ...(delete_ids.length === 0 ? {} : { deleteIds: delete_ids }),
    },
  };
}

/** 按 payloadMode 组装公开 files 变更。 */
function build_files_payload(
  data_reader: ProjectDataReader,
  value: ProjectWriteChangeRequest["files"],
  project_path: string,
): { files?: ProjectChangeFilesPayload } {
  if (value === undefined) {
    return {};
  }
  const changed_paths = value.changedPaths ?? [];
  const delete_paths = value.deletePaths ?? [];
  const upsert =
    value.payloadMode === "canonical-delta"
      ? build_file_upsert_payload(data_reader, project_path, changed_paths)
      : undefined;
  return {
    files: {
      payloadMode: value.payloadMode,
      ...(upsert === undefined ? {} : { upsert }),
      ...(changed_paths.length === 0 ? {} : { changedPaths: changed_paths }),
      ...(delete_paths.length === 0 ? {} : { deletePaths: delete_paths }),
    },
  };
}

/** 非 items/files section 的公开载荷组装。 */
function build_sections_payload(
  data_reader: ProjectDataReader,
  value: ProjectWriteChangeRequest["sections"],
  args: {
    projectPath: string;
    projectState: { loaded: boolean; projectPath: string };
    updatedSections: ProjectDataSection[];
  },
): { sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>> } {
  const sections: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>> = {};
  for (const section of args.updatedSections) {
    const has_explicit_payload = Object.prototype.hasOwnProperty.call(value ?? {}, section);
    if ((section === "items" || section === "files") && !has_explicit_payload) {
      continue;
    }
    const raw_payload = value?.[section];
    const payload_mode = raw_payload?.payloadMode ?? "section-invalidated";
    const has_explicit_data =
      raw_payload !== undefined && Object.prototype.hasOwnProperty.call(raw_payload, "data");
    sections[section] = {
      payloadMode: payload_mode,
      ...(payload_mode !== "canonical-delta"
        ? {}
        : {
            data: has_explicit_data
              ? (raw_payload?.data ?? null)
              : build_section_data(data_reader, args.projectState, section),
          }),
    };
  }
  return Object.keys(sections).length === 0 ? {} : { sections };
}

/** canonical-delta 缺少显式 data 时回读当前 section 事实。 */
function build_section_data(
  data_reader: ProjectDataReader,
  project_state: { loaded: boolean; projectPath: string },
  section: ProjectDataSection,
): JsonValue {
  const payload = data_reader.build_section_payloads({
    projectState: project_state,
    sections: [section],
  });
  return read_json_record(payload["sections"])[section] ?? {};
}

/** 按 item id 读取公开 DTO 作为 upsert。 */
function build_item_upsert_payload(
  data_reader: ProjectDataReader,
  project_path: string,
  changed_ids: number[],
): Record<string, JsonRecord> {
  const upsert: Record<string, JsonRecord> = {};
  for (const item of data_reader.build_item_records_by_ids(project_path, changed_ids)) {
    const item_id = read_number(item["item_id"]);
    if (item_id > 0) {
      upsert[item_id.toString()] = item as JsonRecord;
    }
  }
  return upsert;
}

/** 按相对路径筛选文件公开记录作为 upsert。 */
function build_file_upsert_payload(
  data_reader: ProjectDataReader,
  project_path: string,
  changed_paths: string[],
): Record<string, JsonRecord> {
  const files = data_reader.build_files_record_block(project_path);
  const path_set = new Set(changed_paths);
  const upsert: Record<string, JsonRecord> = {};
  for (const [file_path, record] of Object.entries(files)) {
    if (path_set.size > 0 && !path_set.has(file_path)) {
      continue;
    }
    if (is_json_record(record)) {
      upsert[file_path] = record as JsonRecord;
    }
  }
  return upsert;
}

/** item id 等数字字段的容错截断。 */
function read_number(value: JsonValue | undefined): number {
  const number_value = Number(value ?? 0);
  return Number.isFinite(number_value) ? Math.trunc(number_value) : 0;
}
