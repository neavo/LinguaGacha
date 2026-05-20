import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import * as AppErrors from "../../shared/error";
import {
  normalizeProjectChangePayloadMode,
  normalizeProjectDataSections,
  type ProjectChangeEvent,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemsPayload,
  type ProjectChangeJsonRecord,
  type ProjectChangeSectionPayload,
  type ProjectDataSection,
} from "../../shared/project/event";
import { ProjectRuntimeProjectionService } from "./project-runtime-projection-service";
import type {
  ProjectRuntimeProjectionJsonRecord,
  ProjectRuntimeProjectionMutableRecord,
} from "./project-runtime-projection-service";
import { ProjectSessionState } from "./project-session-state";

/**
 * 项目变更草稿必须绑定实际写入工程，adapter 才能按同一 .lg 回读公开投影
 */
export type ProjectChangeDraftRecord = Record<string, ApiJsonValue> & {
  targetProjectPath: string;
};

/**
 * 将领域写入结果转换为公开 ProjectChangeEvent，canonical delta 只在当前事务结果上投影
 */
export class ProjectChangeEventAdapter {
  private readonly session_state: ProjectSessionState; // 当前工程路径只能信任 Gateway 会话状态

  private readonly projection_service: ProjectRuntimeProjectionService; // DB -> API payload 投影集中在无状态服务

  /**
   * 注入会话状态和投影服务，避免任务域或 mutation 域直接拼公开事件
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    projection_service = new ProjectRuntimeProjectionService(database),
  ) {
    this.session_state = session_state;
    this.projection_service = projection_service;
  }

  /**
   * 输出 ProjectChangeEvent；调用方只声明变更 section、payload mode 和可选 ids
   */
  public adapt_project_change(payload: ProjectChangeDraftRecord): ProjectChangeEvent | null {
    const state = this.session_state.snapshot();
    const target_project_path = String(payload.targetProjectPath ?? "").trim();
    if (target_project_path === "") {
      throw new AppErrors.InternalInvariantError({
        diagnostic_context: { reason: "project_change_target_missing" },
      });
    }
    if (!state.loaded || state.projectPath !== target_project_path) {
      return null;
    }
    const project_path = target_project_path;
    const meta = this.projection_service.get_all_meta(project_path);
    const updated_sections = normalizeProjectDataSections(payload["updatedSections"]);
    const all_section_revisions = this.projection_service.build_section_revisions(meta);
    const section_revisions = this.build_section_revision_payload(meta, updated_sections);
    return {
      type: "project.changed",
      eventId: this.build_event_id(),
      source: String(payload["source"] ?? "project_change"),
      projectPath: project_path,
      projectRevision: Math.max(
        ...Object.values(all_section_revisions),
        this.read_number(payload["projectRevision"], 0),
        0,
      ),
      sectionRevisions: section_revisions,
      updatedSections: updated_sections,
      ...this.build_items_payload(payload["items"], project_path),
      ...this.build_files_payload(payload["files"], project_path),
      ...this.build_sections_payload(payload["sections"], {
        projectPath: project_path,
        projectState: state,
        updatedSections: updated_sections,
      }),
    };
  }

  /**
   * item canonical-delta 可只给 changedIds，adapter 会在当前 DB 事实中回读公开行
   */
  private build_items_payload(
    value: ApiJsonValue | undefined,
    project_path: string,
  ): { items?: ProjectChangeItemsPayload } {
    const record = this.normalize_object(value);
    if (Object.keys(record).length === 0) {
      return {};
    }
    const payload_mode = normalizeProjectChangePayloadMode(record["payloadMode"]);
    const changed_ids = this.normalize_number_list(record["changedIds"]);
    const delete_ids = this.normalize_number_list(record["deleteIds"]);
    const field_patch =
      payload_mode === "field-patch" ? this.normalize_item_field_patch(record["fieldPatch"]) : {};
    const upsert =
      payload_mode === "canonical-delta"
        ? this.build_item_upsert_payload(project_path, changed_ids)
        : undefined;
    return {
      items: {
        payloadMode: payload_mode,
        ...(upsert === undefined ? {} : { upsert }),
        ...(Object.keys(field_patch).length === 0 ? {} : { fieldPatch: field_patch }),
        ...(changed_ids.length === 0 ? {} : { changedIds: changed_ids }),
        ...(delete_ids.length === 0 ? {} : { deleteIds: delete_ids }),
      },
    };
  }

  /**
   * files canonical-delta 可按 path 从当前 files block 中裁出，避免调用方理解 asset 投影
   */
  private build_files_payload(
    value: ApiJsonValue | undefined,
    project_path: string,
  ): { files?: ProjectChangeFilesPayload } {
    const record = this.normalize_object(value);
    if (Object.keys(record).length === 0) {
      return {};
    }
    const payload_mode = normalizeProjectChangePayloadMode(record["payloadMode"]);
    const changed_paths = this.normalize_string_list(record["changedPaths"]);
    const delete_paths = this.normalize_string_list(record["deletePaths"]);
    const upsert =
      payload_mode === "canonical-delta"
        ? this.build_file_upsert_payload(project_path, changed_paths)
        : undefined;
    return {
      files: {
        payloadMode: payload_mode,
        ...(upsert === undefined ? {} : { upsert }),
        ...(changed_paths.length === 0 ? {} : { changedPaths: changed_paths }),
        ...(delete_paths.length === 0 ? {} : { deletePaths: delete_paths }),
      },
    };
  }

  /**
   * section canonical-delta 可携带调用方给出的后端规范 data；缺省时才由投影层补齐完整 section。
   */
  private build_sections_payload(
    value: ApiJsonValue | undefined,
    args: {
      projectPath: string;
      projectState: { loaded: boolean; projectPath: string };
      updatedSections: ProjectDataSection[];
    },
  ): { sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>> } {
    const raw_sections = this.normalize_object(value);
    const sections: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>> = {};
    for (const section of args.updatedSections) {
      const has_explicit_section_payload = Object.prototype.hasOwnProperty.call(
        raw_sections,
        section,
      );
      if ((section === "items" || section === "files") && !has_explicit_section_payload) {
        continue;
      }
      const raw_payload = this.normalize_object(raw_sections[section]);
      const payload_mode = normalizeProjectChangePayloadMode(
        raw_payload["payloadMode"] ?? "section-invalidated",
      );
      const has_explicit_data = Object.prototype.hasOwnProperty.call(raw_payload, "data");
      sections[section] = {
        payloadMode: payload_mode,
        ...(payload_mode !== "canonical-delta"
          ? {}
          : {
              data: has_explicit_data
                ? (raw_payload["data"] ?? null)
                : this.build_section_data(args.projectState, section),
            }),
      };
    }
    return Object.keys(sections).length === 0 ? {} : { sections };
  }

  /**
   * 只给本次更新 section 回填 revision，事件消费者不会误判未更新 section
   */
  private build_section_revision_payload(
    meta: ProjectRuntimeProjectionJsonRecord,
    updated_sections: ProjectDataSection[],
  ): Partial<Record<ProjectDataSection, number>> {
    const section_revisions: Partial<Record<ProjectDataSection, number>> = {};
    for (const section of updated_sections) {
      section_revisions[section] = this.projection_service.get_runtime_section_revision(
        meta,
        section,
      );
    }
    return section_revisions;
  }

  /**
   * 按需构建单个 section data，复用 read-sections 的 store payload 口径
   */
  private build_section_data(
    project_state: { loaded: boolean; projectPath: string },
    section: ProjectDataSection,
  ): ApiJsonValue {
    const payload = this.projection_service.build_section_payloads({
      projectState: project_state,
      sections: [section],
    });
    const sections = this.normalize_object(payload["sections"]);
    return sections[section] ?? {};
  }

  /**
   * 根据 changedIds 回读 item 公开行，并转成 item_id map
   */
  private build_item_upsert_payload(
    project_path: string,
    changed_ids: number[],
  ): Record<string, ProjectChangeJsonRecord> {
    const upsert: Record<string, ProjectChangeJsonRecord> = {};
    if (project_path === "" || changed_ids.length === 0) {
      return upsert;
    }
    for (const item of this.projection_service.build_item_records_by_ids(
      project_path,
      changed_ids,
    )) {
      const item_id = this.read_number(item["item_id"], 0);
      if (item_id > 0) {
        upsert[item_id.toString()] = item as ProjectChangeJsonRecord;
      }
    }
    return upsert;
  }

  /**
   * 字段级 item patch 只允许校对页可写字段，保持后端事件仍是窄事实表达。
   */
  private normalize_item_field_patch(value: ApiJsonValue | undefined): {
    dst?: string;
    status?: string;
    retry_count?: number;
  } {
    const record = this.normalize_object(value);
    const patch: { dst?: string; status?: string; retry_count?: number } = {};
    if (typeof record["dst"] === "string") {
      patch.dst = record["dst"];
    }
    if (typeof record["status"] === "string") {
      patch.status = record["status"];
    }
    const retry_count = Number(record["retry_count"]);
    if (Number.isFinite(retry_count)) {
      patch.retry_count = Math.trunc(retry_count);
    }
    return patch;
  }

  /**
   * 从当前 files block 裁剪指定路径；未指定 changedPaths 时返回完整 files delta
   */
  private build_file_upsert_payload(
    project_path: string,
    changed_paths: string[],
  ): Record<string, ProjectChangeJsonRecord> {
    const files = this.projection_service.build_files_record_block(project_path);
    const path_set = new Set(changed_paths);
    const upsert: Record<string, ProjectChangeJsonRecord> = {};
    for (const [path, record] of Object.entries(files)) {
      if (path_set.size > 0 && !path_set.has(path)) {
        continue;
      }
      if (this.is_record(record)) {
        upsert[path] = record as ProjectChangeJsonRecord;
      }
    }
    return upsert;
  }

  /**
   * eventId 只需要进程内唯一，便于前端日志与测试定位重复事件
   */
  private build_event_id(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 数字字段坏值按默认值处理，避免 NaN 进入公开事件
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }

  /**
   * ids-only 与 canonical-delta 共用正整数 id 归一口径
   */
  private normalize_number_list(value: ApiJsonValue | undefined): number[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(
        value
          .map((item) => this.read_number(item, NaN))
          .filter((item_id) => Number.isFinite(item_id) && item_id > 0),
      ),
    ];
  }

  /**
   * 路径列表去空并去重，保持 files delta key 稳定
   */
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return [
      ...new Set(value.map((item) => String(item ?? "").trim()).filter((item) => item !== "")),
    ];
  }

  /**
   * JSON record 统一收窄入口
   */
  private normalize_object(value: ApiJsonValue | undefined): ProjectRuntimeProjectionMutableRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 只把普通对象视为 record，数组和 null 都不是公开 payload block
   */
  private is_record(value: unknown): value is ProjectRuntimeProjectionJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
