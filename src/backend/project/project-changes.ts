import type { ApiJsonValue } from "../api/api-types";
import { ApiStreamHub } from "../api/api-stream-hub";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  is_item_status,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import { is_task_skipped_item_status, TASK_PROGRESS_STATUSES } from "../../domain/task";
import * as AppErrors from "../../shared/error";
import { should_skip_by_language_prefilter } from "../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../shared/prefilter/rule-prefilter";
import {
  normalizeProjectChangePayloadMode,
  normalizeProjectDataSections,
  PROJECT_CHANGE_EVENT_TOPIC,
  type ProjectChangeEvent,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemFieldPatch,
  type ProjectChangeItemsPayload,
  type ProjectChangeJsonRecord,
  type ProjectChangePayloadMode,
  type ProjectChangeSectionPayload,
  type ProjectDataSection,
  type ProjectWriteResult,
} from "../../shared/project-event";
import {
  build_section_revisions_from_meta,
  get_section_revision,
  ProjectDataReader,
  type ProjectDataJsonRecord,
  type ProjectDataRecord,
} from "./project-data";
import type { ProjectEvent, ProjectEventBus, ProjectEventDispatchResult } from "./project-events";
import { ProjectSessionState } from "./project-session";

type ProjectWriteFileRecord = {
  rel_path: string; // 项目内相对路径，用于按文件分组预过滤
  file_type: string; // 格式类型，只参与 KVJSON 优化分支
};

export type ProjectWriteState = {
  files: Record<string, unknown>; // section 镜像，调用方需提供当前完整文件集合
  items: Record<string, unknown>; // section 镜像，调用方需提供当前完整公开 DTO 集合
};

export type ProjectItemViewRecord = {
  item_id: number; // 公开 item 主键，所有局部写入都以它定位数据库事实
  file_path: string; // 项目内相对路径
  row_number: number; // 公开行号
  src: string; // 原文
  dst: string; // 译文
  name_dst: ProjectItemPublicRecord["name_dst"]; // 角色译名
  status: ProjectItemPublicRecord["status"]; // 翻译状态
  text_type: ProjectItemPublicRecord["text_type"]; // 文本规则类型
  retry_count: number; // 重试次数
  skip_internal_filter: boolean; // 是否绕过内部过滤
};

export type ProjectPrefilterStats = {
  rule_skipped: number; // 规则预过滤跳过数量
  language_skipped: number; // 源语言预过滤跳过数量
  mtool_skipped: number; // MTool KVJSON 优化跳过数量
  duplicated: number; // 同文件重复原文跳过数量
};

export type ProjectAnalysisWriteOutput = {
  extras: Record<string, unknown>; // 当前分析进度保留字段，新建和 reset 默认从空对象开始
  candidate_count: number; // 当前候选术语数，预过滤不会生成候选
  status_summary: Record<string, unknown>; // 分析视角的可处理、已处理和失败行数摘要
};

export type ProjectPrefilterWriteOutput = {
  items: Record<string, ProjectItemPublicRecord>; // 预过滤后的完整公开 item 集合
  analysis: ProjectAnalysisWriteOutput; // 重置后的分析计算事实
  translation_extras: Record<string, unknown>; // 按最终 item 状态重建的翻译进度 meta
  project_settings: {
    source_language: string; // 写回 settings mirror 的源语言
    target_language: string; // 写回 settings mirror 的目标语言
    mtool_optimizer_enable: boolean; // 写回 settings mirror 的 MTool 开关
    skip_duplicate_source_text_enable: boolean; // 写回 settings mirror 的重复过滤开关
  };
  prefilter_config: {
    source_language: string; // 旧项目读取仍需要的预过滤源语言镜像
    mtool_optimizer_enable: boolean; // 旧项目读取仍需要的 MTool 镜像
    skip_duplicate_source_text_enable: boolean; // 旧项目读取仍需要的重复过滤镜像
  };
  stats: ProjectPrefilterStats; // 调试和测试用统计，不作为持久事实写入口
};

export type ProjectPrefilterWriteInput = {
  state: ProjectWriteState; // 当前项目事实快照，调用方负责提供后端权威事实
  task_snapshot?: Record<string, unknown>; // 可选旧进度基底，缺省时从空翻译进度开始
  source_language: string; // 源语言预过滤口径
  target_language?: string; // 只写入 settings mirror，不参与预过滤判断
  mtool_optimizer_enable: boolean; // 是否启用 KVJSON 优化预过滤
  skip_duplicate_source_text_enable: boolean; // 是否启用同文件重复原文过滤
};

// 外部输入必须先是完整公开 DTO，计算视图只服务局部计算。
/**
 * 解析当前场景的最终消费值。
 */
export function derive_project_item_view_record(value: unknown): ProjectItemViewRecord | null {
  const item = normalize_project_item_public_record(value);
  if (item === null) {
    return null;
  }
  return derive_project_item_view_record_from_public(item);
}

// 从已校验公开 DTO 计算可变视图，保留 reset、预过滤和统计需要的字段。
/**
 * 解析当前场景的最终消费值。
 */
export function derive_project_item_view_record_from_public(
  item: ProjectItemPublicRecord,
): ProjectItemViewRecord {
  return {
    item_id: item.item_id,
    file_path: item.file_path,
    row_number: item.row_number,
    src: item.src,
    dst: item.dst,
    name_dst: item.name_dst,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
    skip_internal_filter: item.skip_internal_filter,
  };
}

// 局部计算会原地修改视图，复制后再交给调用点避免污染上游缓存。
/**
 * 承接当前模块的核心控制分支。
 */
export function clone_project_item_view_record(item: ProjectItemViewRecord): ProjectItemViewRecord {
  return {
    ...item,
  };
}

// 从任务快照中提取可持久化进度字段，排除任务生命周期专用字段。
/**
 * 构建当前场景的稳定结果。
 */
function build_translation_extras(task_snapshot: Record<string, unknown>): Record<string, unknown> {
  const progress = task_snapshot.progress;
  if (typeof progress === "object" && progress !== null && !Array.isArray(progress)) {
    return { ...(progress as Record<string, unknown>) };
  }
  const translation_extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task_snapshot)) {
    if (
      key === "task_type" ||
      key === "status" ||
      key === "busy" ||
      key === "request_in_flight_count" ||
      key === "analysis_candidate_count" ||
      key === "extras" ||
      key === "progress"
    ) {
      continue;
    }
    translation_extras[key] = value;
  }
  return translation_extras;
}

// 构造空闲翻译任务快照，供后端 reset 或无历史进度时作为统计基底。
/**
 * 构建当前场景的稳定结果。
 */
export function create_empty_translation_task_snapshot(): Record<string, unknown> {
  return {
    task_type: "translation",
    status: "idle",
    busy: false,
    request_in_flight_count: 0,
    progress: {
      line: 0,
      total_line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    extras: { kind: "translation", scope: { kind: "all" } },
  };
}

// 按最终 item 状态重建翻译进度 meta，task snapshot 运行态由专属任务模块发布。
/**
 * 构建当前场景的稳定结果。
 */
export function build_translation_extras_from_items(args: {
  task_snapshot: Record<string, unknown>;
  items: Map<number, ProjectItemViewRecord>;
}): Record<string, unknown> {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;

  for (const item of args.items.values()) {
    if (item.status === "PROCESSED") {
      processed_line += 1;
    }
    if (item.status === "ERROR") {
      error_line += 1;
    }
    if ((TASK_PROGRESS_STATUSES as readonly string[]).includes(item.status)) {
      total_line += 1;
    }
  }

  const translation_extras = build_translation_extras(args.task_snapshot);
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  return translation_extras;
}

// 分析 reset 的默认统计只统计仍需分析的非跳过条目。
/**
 * 构建当前场景的稳定结果。
 */
export function build_analysis_status_summary(
  items: Iterable<ProjectItemViewRecord>,
): Record<string, unknown> {
  let total_line = 0;
  for (const item of items) {
    if (item.src.trim() === "" || is_task_skipped_item_status(item.status)) {
      continue;
    }
    total_line += 1;
  }

  return {
    total_line,
    processed_line: 0,
    error_line: 0,
    line: 0,
  };
}

// 分析进度快照只保留稳定数字字段，避免坏 meta 扩散到任务运行态。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function normalize_analysis_progress_snapshot(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  return {
    start_time: Number(snapshot.start_time ?? 0.0),
    time: Number(snapshot.time ?? 0.0),
    total_line: Number(snapshot.total_line ?? 0),
    line: Number(snapshot.line ?? 0),
    processed_line: Number(snapshot.processed_line ?? 0),
    error_line: Number(snapshot.error_line ?? 0),
    total_tokens: Number(snapshot.total_tokens ?? 0),
    total_input_tokens: Number(snapshot.total_input_tokens ?? 0),
    total_output_tokens: Number(snapshot.total_output_tokens ?? 0),
  };
}

// 把保留统计和当前状态摘要合成为分析进度 meta。
/**
 * 构建当前场景的稳定结果。
 */
export function build_analysis_progress_snapshot(args: {
  extras: Record<string, unknown>;
  status_summary: Record<string, unknown>;
}): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    start_time: 0.0,
    time: 0.0,
    total_line: 0,
    line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
  };
  Object.assign(snapshot, args.extras);
  return normalize_analysis_progress_snapshot({
    ...snapshot,
    total_line: args.status_summary.total_line ?? 0,
    line: args.status_summary.line ?? 0,
    processed_line: args.status_summary.processed_line ?? 0,
    error_line: args.status_summary.error_line ?? 0,
  });
}

// 从 files section 镜像收窄预过滤需要的文件字段。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_file_record(value: unknown): ProjectWriteFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as ProjectWriteFileRecord).rel_path ?? ""),
    file_type: String((value as ProjectWriteFileRecord).file_type ?? "NONE"),
  };
}

// 把 record 形状的 item 集合收窄成公开 DTO Map，非法条目在后端算法边界丢弃。
/**
 * 构建当前场景的稳定结果。
 */
export function build_public_item_map(
  items: Record<string, unknown>,
): Map<number, ProjectItemPublicRecord> {
  const item_map = new Map<number, ProjectItemPublicRecord>();
  for (const value of Object.values(items)) {
    const item = normalize_project_item_public_record(value);
    if (item === null) {
      continue;
    }
    item_map.set(item.item_id, { ...item });
  }
  return item_map;
}

// 把公开 DTO Map 计算为预过滤和进度统计使用的轻量视图 Map。
/**
 * 构建当前场景的稳定结果。
 */
export function build_item_view_map(
  public_items: Map<number, ProjectItemPublicRecord>,
): Map<number, ProjectItemViewRecord> {
  const item_map = new Map<number, ProjectItemViewRecord>();
  for (const item of public_items.values()) {
    item_map.set(item.item_id, derive_project_item_view_record_from_public(item));
  }
  return item_map;
}

// 后端预过滤核心只接收当前项目事实快照，输出完整可写的计算事实。
/**
 * 解析当前场景的最终消费值。
 */
export function compute_project_prefilter_write(
  input: ProjectPrefilterWriteInput,
): ProjectPrefilterWriteOutput {
  const file_type_by_path = new Map<string, string>();
  for (const value of Object.values(input.state.files)) {
    const file = normalize_file_record(value);
    if (file === null) {
      continue;
    }
    file_type_by_path.set(file.rel_path, file.file_type);
  }

  const full_item_index = new Map<number, ProjectItemPublicRecord>();
  const item_index = new Map<number, ProjectItemViewRecord>();
  for (const value of Object.values(input.state.items)) {
    const public_item = normalize_project_item_public_record(value);
    if (public_item === null) {
      continue;
    }
    const item = derive_project_item_view_record_from_public(public_item);
    full_item_index.set(public_item.item_id, public_item);
    item_index.set(item.item_id, clone_project_item_view_record(item));
  }

  let rule_skipped = 0;
  let language_skipped = 0;
  let mtool_skipped = 0;
  let duplicated = 0;
  const kvjson_items_by_path = new Map<string, ProjectItemViewRecord[]>();

  for (const item of item_index.values()) {
    if (
      item.status === "RULE_SKIPPED" ||
      item.status === "LANGUAGE_SKIPPED" ||
      item.status === "DUPLICATED"
    ) {
      item.status = "NONE";
    }
    if (input.mtool_optimizer_enable && file_type_by_path.get(item.file_path) === "KVJSON") {
      const current_group = kvjson_items_by_path.get(item.file_path);
      if (current_group === undefined) {
        kvjson_items_by_path.set(item.file_path, [item]);
      } else {
        current_group.push(item);
      }
    }
  }

  for (const item of item_index.values()) {
    if (item.status !== "NONE" || item.skip_internal_filter) {
      continue;
    }
    if (should_skip_by_rule_prefilter(item.src)) {
      item.status = "RULE_SKIPPED";
      rule_skipped += 1;
      continue;
    }
    if (should_skip_by_language_prefilter(item.src, input.source_language)) {
      item.status = "LANGUAGE_SKIPPED";
      language_skipped += 1;
    }
  }

  if (input.mtool_optimizer_enable) {
    for (const file_items of kvjson_items_by_path.values()) {
      const target_clauses = new Set<string>();
      for (const item of file_items) {
        if (!item.src.includes("\n")) {
          continue;
        }
        for (const line of item.src.split(/\r\n|\r|\n/gu)) {
          const normalized_line = line.trim();
          if (normalized_line !== "") {
            target_clauses.add(normalized_line);
          }
        }
      }

      for (const item of file_items) {
        if (item.status !== "NONE" || !target_clauses.has(item.src)) {
          continue;
        }
        item.status = "RULE_SKIPPED";
        mtool_skipped += 1;
      }
    }
  }

  if (input.skip_duplicate_source_text_enable) {
    const seen_src_by_file_path = new Map<string, Set<string>>();
    for (const item of item_index.values()) {
      const seen_src = seen_src_by_file_path.get(item.file_path) ?? new Set<string>();
      if (item.status === "NONE" && seen_src.has(item.src)) {
        item.status = "DUPLICATED";
        duplicated += 1;
      } else if (item.status === "NONE" || item.status === "PROCESSED") {
        seen_src.add(item.src);
      }
      seen_src_by_file_path.set(item.file_path, seen_src);
    }
  }

  const next_items: Record<string, ProjectItemPublicRecord> = {};
  for (const item of item_index.values()) {
    const full_item = full_item_index.get(item.item_id);
    if (full_item === undefined) {
      continue;
    }
    next_items[String(item.item_id)] = {
      ...full_item,
      file_path: item.file_path,
      row_number: item.row_number,
      src: item.src,
      dst: item.dst,
      name_src: full_item.name_src,
      name_dst: item.name_dst ?? null,
      extra_field: full_item.extra_field,
      tag: full_item.tag,
      file_type: full_item.file_type,
      status: item.status,
      text_type: item.text_type,
      retry_count: item.retry_count,
      skip_internal_filter: item.skip_internal_filter,
    };
  }

  const translation_extras = build_translation_extras_from_items({
    task_snapshot: input.task_snapshot ?? create_empty_translation_task_snapshot(),
    items: item_index,
  });

  return {
    items: next_items,
    analysis: {
      extras: {},
      candidate_count: 0,
      status_summary: build_analysis_status_summary(item_index.values()),
    },
    translation_extras,
    project_settings: {
      source_language: input.source_language,
      target_language: input.target_language ?? "",
      mtool_optimizer_enable: input.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: input.skip_duplicate_source_text_enable,
    },
    prefilter_config: {
      source_language: input.source_language,
      mtool_optimizer_enable: input.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: input.skip_duplicate_source_text_enable,
    },
    stats: {
      rule_skipped,
      language_skipped,
      mtool_skipped,
      duplicated,
    },
  };
}

/**
 * 项目变更草稿必须绑定实际写入工程，adapter 才能按同一 .lg 回读公开形状
 */
export type ProjectChangeDraftRecord = Record<string, ApiJsonValue> & {
  targetProjectPath: string;
};

/**
 * 将领域写入结果转换为公开 ProjectChangeEvent，规范化增量只在当前事务结果上组装
 */
export class ProjectChangeEventAdapter {
  private readonly session_state: ProjectSessionState; // 当前工程路径只能信任 Gateway 会话状态

  private readonly data_reader: ProjectDataReader; // DB -> API payload 组装集中在无状态服务

  /**
   * 注入会话状态和读取服务，避免任务域或写入域直接拼公开事件
   */
  public constructor(
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    data_reader = new ProjectDataReader(database),
  ) {
    this.session_state = session_state;
    this.data_reader = data_reader;
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
    const meta = this.data_reader.get_all_meta(project_path);
    const updated_sections = normalizeProjectDataSections(payload["updatedSections"]);
    const all_section_revisions = this.data_reader.build_section_revisions(meta);
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
   * files canonical-delta 可按 path 从当前 files block 中裁出，避免调用方理解 asset 组装
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
   * section canonical-delta 可携带调用方给出的后端规范 data；缺省时才由读取层补齐完整 section。
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
    meta: ProjectDataJsonRecord,
    updated_sections: ProjectDataSection[],
  ): Partial<Record<ProjectDataSection, number>> {
    const section_revisions: Partial<Record<ProjectDataSection, number>> = {};
    for (const section of updated_sections) {
      section_revisions[section] = this.data_reader.get_section_revision(meta, section);
    }
    return section_revisions;
  }

  /**
   * 按需构建单个 section data，复用公开项目变更 payload 口径
   */
  private build_section_data(
    project_state: { loaded: boolean; projectPath: string },
    section: ProjectDataSection,
  ): ApiJsonValue {
    const payload = this.data_reader.build_section_payloads({
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
    for (const item of this.data_reader.build_item_records_by_ids(project_path, changed_ids)) {
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
  private normalize_item_field_patch(value: ApiJsonValue | undefined): ProjectChangeItemFieldPatch {
    const record = this.normalize_object(value);
    const patch: ProjectChangeItemFieldPatch = {};
    if (typeof record["dst"] === "string") {
      patch.dst = record["dst"];
    }
    if (is_item_status(record["status"])) {
      patch.status = record["status"];
    }
    const retry_count = Number(record["retry_count"]);
    if (Number.isFinite(retry_count)) {
      patch.retry_count = Math.trunc(retry_count);
    }
    return patch;
  }

  /**
   * 从当前 files block 裁剪指定路径；未指定 changedPaths 时返回完整 files 增量
   */
  private build_file_upsert_payload(
    project_path: string,
    changed_paths: string[],
  ): Record<string, ProjectChangeJsonRecord> {
    const files = this.data_reader.build_files_record_block(project_path);
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
   * item 增量共用正整数 id 归一口径
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
   * 路径列表去空并去重，保持 files 增量 key 稳定
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
  private normalize_object(value: ApiJsonValue | undefined): ProjectDataRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 只把普通对象视为 record，数组和 null 都不是公开 payload block
   */
  private is_record(value: unknown): value is ProjectDataJsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

type ProjectChangeStreamRecord = Record<string, ApiJsonValue>;

/**
 * 项目数据变更发布器：把领域变更草稿适配为 ProjectChangeEvent 后广播
 */
export class ProjectChangePublisher {
  private readonly project_change_adapter: ProjectChangeEventAdapter; // adapter 是领域变更到公开 ProjectChangeEvent 的唯一出口

  private readonly api_stream_hub: ApiStreamHub; // 只广播已适配的公开 JSON topic

  /**
   * 注入变更适配器和公开 stream hub，项目域不需要理解 SSE 连接
   */
  public constructor(
    project_change_adapter: ProjectChangeEventAdapter,
    api_stream_hub: ApiStreamHub,
  ) {
    this.project_change_adapter = project_change_adapter;
    this.api_stream_hub = api_stream_hub;
  }

  /**
   * 发布项目数据变更，并把同一份 ProjectChangeEvent 返回给 HTTP 写入响应
   */
  public publish_project_change(payload: ProjectChangeDraftRecord): ProjectChangeEvent | null {
    const event = this.project_change_adapter.adapt_project_change(payload);
    if (event === null) {
      return null;
    }
    this.api_stream_hub.publish(
      PROJECT_CHANGE_EVENT_TOPIC,
      event as unknown as ProjectChangeStreamRecord,
    );
    return event;
  }
}

type JsonRecord = Record<string, ApiJsonValue>;

type RevisionBackedSection = "files" | "items" | "analysis" | "proofreading";

export type ProjectWriteRevisionContext = {
  project_path: string; // revision guard 与 revision writer 必须使用同一个工程身份
  meta: JsonRecord; // 本次乐观锁校验和 revision bump 的共同快照
  sections: ProjectDataSection[]; // 本次乐观锁声明读取或更新的项目数据域
};

export type ProjectWriteChangeRequest = {
  projectPath: string; // 已由会话或显式路径校验，publisher 不再猜测目标工程
  source: string; // HTTP 写入与 SSE 事件共用的行为标签
  updatedSections: ProjectDataSection[]; // 决定前端刷新哪些项目 section
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

export type ProjectWriteCommitRequest = {
  projectPath: string; // 本次 revision guard、事务写入和事件发布的共同工程身份
  expectedSectionRevisions: ApiJsonValue | undefined; // 保留 API 原始锁值，在提交点统一收窄
  sections: ProjectDataSection[]; // 提交阶段必须重新校验的依赖数据域
  buildOperations: (context: ProjectWriteRevisionContext) => DatabaseOperation[]; // 必须同步读取最新事实并构造事务
  change: Omit<ProjectWriteChangeRequest, "projectPath">; // 只声明发布草稿，工程路径由协调器补齐
};

/**
 * 统一协调同步项目写入的 revision guard、revision writer 和规范化事件草稿
 */
export class ProjectWriteCoordinator {
  private readonly database: ProjectDatabase; // workflow 是 revision meta 的唯一读取与写入入口

  private readonly project_change_publisher: ProjectChangePublisher | null; // publisher 是写库成功后进入 project.data_changed 的唯一出口

  private readonly project_event_bus: ProjectEventBus; // 内部 committed event 先于公开变更发布，供后端 cache 维护热数据

  /**
   * 注入数据库和可选发布器，保持纯测试场景能只验证写库结果
   */
  public constructor(
    database: ProjectDatabase,
    project_change_publisher: ProjectChangePublisher | null,
    project_event_bus: ProjectEventBus,
  ) {
    this.database = database;
    this.project_change_publisher = project_change_publisher;
    this.project_event_bus = project_event_bus;
  }

  /**
   * 按 section 校验乐观锁并返回同一 meta 快照，后续 revision bump 不再二次猜测基线
   */
  public assert_expected_section_revisions(
    project_path: string,
    expected_section_revisions: ApiJsonValue | undefined,
    sections: ProjectDataSection[],
  ): ProjectWriteRevisionContext {
    const expected = normalize_project_expected_section_revisions(expected_section_revisions);
    if (expected === null) {
      throw new AppErrors.RequestValidationError();
    }
    const meta = this.read_project_meta(project_path);
    for (const section of sections) {
      if (!Object.prototype.hasOwnProperty.call(expected, section)) {
        throw new AppErrors.RequestValidationError({
          public_details: { section },
        });
      }
      const current_revision = get_section_revision(meta, section);
      const expected_revision = expected[section] ?? 0;
      if (current_revision !== expected_revision) {
        throw new AppErrors.RevisionConflictError({
          public_details: {
            current_revision,
            expected_revision,
            section,
          },
        });
      }
    }
    return {
      project_path,
      meta,
      sections: [...sections],
    };
  }

  /**
   * 基于 revision guard 快照生成 bump 操作，确保事务内每个 section 只推进一次
   */
  public build_section_revision_operations(
    context: ProjectWriteRevisionContext,
    sections = filter_revision_backed_sections(context.sections),
  ): DatabaseOperation[] {
    return sections.map((section) =>
      this.op("setMeta", {
        projectPath: context.project_path,
        key: resolve_revision_meta_key(section),
        value: get_section_revision(context.meta, section) + 1,
      }),
    );
  }

  /**
   * 在最终提交点连续完成 revision guard、事务构造、写库和规范化事件发布
   */
  public async commit_project_write(
    request: ProjectWriteCommitRequest,
  ): Promise<ProjectWriteResult> {
    const revision_context = this.assert_expected_section_revisions(
      request.projectPath,
      request.expectedSectionRevisions,
      request.sections,
    );
    const operations = request.buildOperations(revision_context);
    this.database.execute_transaction(operations);
    await this.publish_app_events_for_committed_change({
      projectPath: request.projectPath,
      ...request.change,
    });
    return this.publish_project_data_change({
      projectPath: request.projectPath,
      ...request.change,
    });
  }

  /**
   * 无项目数据变化时仍返回统一写入结果，调用方不再保留旧响应分支
   */
  public empty_project_write_result(): ProjectWriteResult {
    return { accepted: true, changes: [] };
  }

  /**
   * 数据库提交成功后只发布规范化变更草稿，HTTP 返回和 SSE 广播共用同一事件
   */
  public publish_project_data_change(request: ProjectWriteChangeRequest): ProjectWriteResult {
    if (this.project_change_publisher === null || request.updatedSections.length === 0) {
      return this.empty_project_write_result();
    }

    const change_event: ProjectChangeEvent | null =
      this.project_change_publisher.publish_project_change({
        targetProjectPath: request.projectPath,
        source: request.source,
        updatedSections: request.updatedSections as unknown as ApiJsonValue,
        ...this.build_row_payloads(request),
        ...this.build_section_payloads(request),
      });
    if (change_event === null || change_event === undefined) {
      return this.empty_project_write_result();
    }
    return { accepted: true, changes: [change_event] };
  }

  /**
   * 读取完整 meta，revision guard 和质量服务都复用同一读取口径
   */
  public read_project_meta(project_path: string): JsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 行级 payload 表达调用方明确声明的增量；items/files 缺省全量变更只发布轻量失效信号。
   */
  private build_row_payloads(request: ProjectWriteChangeRequest): {
    items?: ApiJsonValue;
    files?: ApiJsonValue;
  } {
    return {
      ...this.build_default_row_payload(request, "items"),
      ...this.build_default_row_payload(request, "files"),
    };
  }

  /**
   * 未提供行级增量的小 section 默认发布规范化 section；items/files 交给行级失效信号。
   */
  private build_section_payloads(request: ProjectWriteChangeRequest): {
    sections?: ApiJsonValue;
  } {
    const sections = { ...request.sections };
    for (const section of request.updatedSections) {
      if (this.has_explicit_section_payload(request, section)) {
        continue;
      }
      if (section === "items" || section === "files") {
        continue;
      }
      sections[section] = { payloadMode: request.sectionModes?.[section] ?? "canonical-delta" };
    }
    return Object.keys(sections).length === 0
      ? {}
      : { sections: sections as unknown as ApiJsonValue };
  }

  private build_default_row_payload(
    request: ProjectWriteChangeRequest,
    section: "items" | "files",
  ): { items?: ApiJsonValue; files?: ApiJsonValue } {
    const explicit_payload = section === "items" ? request.items : request.files;
    if (explicit_payload !== undefined) {
      return section === "items"
        ? { items: explicit_payload as unknown as ApiJsonValue }
        : { files: explicit_payload as unknown as ApiJsonValue };
    }
    if (
      !request.updatedSections.includes(section) ||
      this.has_explicit_section_payload(request, section)
    ) {
      return {};
    }
    return section === "items"
      ? { items: { payloadMode: "section-invalidated" } }
      : { files: { payloadMode: "section-invalidated" } };
  }

  private has_explicit_section_payload(
    request: ProjectWriteChangeRequest,
    section: ProjectDataSection,
  ): boolean {
    return (
      request.sections !== undefined &&
      Object.prototype.hasOwnProperty.call(request.sections, section)
    );
  }

  /**
   * 数据库事务成功后先发布后端内部事件，确保后端 query cache 先于公开 SSE 更新。
   */
  public async publish_app_events_for_committed_change(
    request: ProjectWriteChangeRequest,
  ): Promise<void> {
    for (const event of this.build_app_events_after_commit(request)) {
      this.assert_app_event_dispatch_success(await this.project_event_bus.publish(event));
    }
  }

  /**
   * 内部 committed event 维护后端 query cache，失败时不能继续发布公开项目变更。
   */
  private assert_app_event_dispatch_success(results: ProjectEventDispatchResult[]): void {
    const failed_result = results.find((result) => !result.ok);
    if (failed_result === undefined) {
      return;
    }
    if (failed_result.error instanceof Error) {
      throw failed_result.error;
    }
    throw new AppErrors.InternalInvariantError({
      diagnostic_context: {
        source: "project-write",
        reason: "app_event_dispatch_failed",
        event_type: failed_result.type,
        handler_index: failed_result.handlerIndex,
      },
    });
  }

  /**
   * 将公开变更草稿拆成 cache 可消费的领域事件，避免缓存模块理解 SSE payload。
   */
  private build_app_events_after_commit(request: ProjectWriteChangeRequest): ProjectEvent[] {
    const meta = this.read_project_meta(request.projectPath);
    const section_revisions = build_section_revisions_from_meta(meta);
    const common = {
      projectPath: request.projectPath,
      source: request.source,
      affectedSections: request.updatedSections,
      sectionRevisions: section_revisions,
    };
    const events: ProjectEvent[] = [];
    if (
      request.updatedSections.some(
        (section) => section === "items" || section === "files" || section === "proofreading",
      )
    ) {
      events.push({
        ...common,
        type: "project.items.changed",
        items: request.items,
        files: request.files,
        scope: request.items?.changedIds === undefined ? "items-full" : "items-partial",
      });
    }
    if (request.updatedSections.includes("quality")) {
      events.push({
        ...common,
        type: "project.quality.changed",
        scope: "quality-full",
      });
    }
    if (request.updatedSections.includes("prompts")) {
      events.push({
        ...common,
        type: "project.prompts.changed",
        scope: "prompts-full",
      });
    }
    if (request.updatedSections.includes("analysis")) {
      events.push({
        ...common,
        type: "project.analysis.changed",
        sections: request.sections,
        scope: "analysis-full",
      });
    }
    if (request.updatedSections.includes("project")) {
      events.push({
        ...common,
        type: "project.settings.changed",
      });
    }
    return events;
  }

  /**
   * 把未知 JSON 收窄为对象，避免 meta 读取调用点扩散类型判断
   */
  private normalize_object(value: ApiJsonValue | undefined): JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 创建 database workflow 操作对象，避免协调器外部拼接协议壳
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}

/**
 * expected_section_revisions 只接受 JSON number 整数，拒绝字符串、布尔值、小数和负数锁值
 */
export function normalize_project_expected_section_revisions(
  value: ApiJsonValue | undefined,
): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const expected: Record<string, number> = {};
  for (const [section, revision] of Object.entries(value)) {
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "invalid_expected_section_revision", section },
      });
    }
    expected[section] = revision;
  }
  return expected;
}

/**
 * 运行态 section 到 meta key 的唯一映射，避免各服务各自拼 revision key
 */
function resolve_revision_meta_key(section: RevisionBackedSection): string {
  if (section === "proofreading") {
    return "proofreading_revision.proofreading";
  }
  return `project_runtime_revision.${section}`;
}

/**
 * 只有带独立运行态 meta key 的 section 才能由通用 writer 自动 bump
 */
function filter_revision_backed_sections(sections: ProjectDataSection[]): RevisionBackedSection[] {
  return sections.filter(
    (section): section is RevisionBackedSection =>
      section === "files" ||
      section === "items" ||
      section === "analysis" ||
      section === "proofreading",
  );
}
