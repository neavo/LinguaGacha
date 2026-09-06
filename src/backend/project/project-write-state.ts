import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import {
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";

import {
  type BatchTranslationProgress,
  TASK_PROGRESS_STATUSES,
} from "../../domain/batch-translation";
import { should_skip_by_language_prefilter } from "../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../shared/prefilter/rule-prefilter";
import {
  coordinate_project_duplicate_statuses,
  type ProjectItemDuplicateIdentity,
} from "../../shared/project/project-item-duplicates";

type ProjectWriteFileRecord = {
  rel_path: string; // 项目内相对路径，用于按文件分组预过滤
  file_type: string; // 格式类型，只参与 KVJSON 优化分支
};

export type ProjectWriteState = {
  files: Record<string, unknown>; // section 镜像，调用方需提供当前完整文件集合
  items: Record<string, unknown>; // section 镜像，调用方需提供当前完整公开 DTO 集合
};

export type ProjectItemViewRecord = ProjectItemDuplicateIdentity & {
  item_id: number; // 公开 item 主键，所有局部写入都以它定位数据库事实
  row_number: number; // 公开行号
  dst: string; // 译文
  name_dst: ProjectItemPublicRecord["name_dst"]; // 角色译名
  status: ProjectItemPublicRecord["status"]; // 翻译状态
  retry_count: number; // 重试次数
  skip_internal_filter: boolean; // 是否绕过内部过滤
};

export type ProjectPrefilterStats = {
  rule_skipped: number; // 规则预过滤跳过数量
  language_skipped: number; // 源语言预过滤跳过数量
  mtool_skipped: number; // MTool KVJSON 优化跳过数量
  duplicated: number; // 重复项跳过数量
};

export type ProjectPrefilterWriteOutput = {
  items: Record<string, ProjectItemPublicRecord>; // 预过滤后的完整公开 item 集合
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
  skip_duplicate_source_text_enable: boolean; // 是否启用重复项过滤
};

/**
 * 将外部输入先归一为完整公开 DTO，再收窄为局部算法需要的计算视图。
 */
export function derive_project_item_view_record(value: unknown): ProjectItemViewRecord | null {
  const item = normalize_project_item_public_record(value);
  if (item === null) {
    return null;
  }
  return derive_project_item_view_record_from_public(item);
}

/**
 * 从已校验公开 DTO 构造 reset、预过滤和统计使用的轻量视图。
 */
export function derive_project_item_view_record_from_public(
  item: ProjectItemPublicRecord,
): ProjectItemViewRecord {
  return {
    item_id: item.item_id,
    file_path: item.file_path,
    row_number: item.row_number,
    src: item.src,
    name_src: item.name_src,
    dst: item.dst,
    name_dst: item.name_dst,
    status: item.status,
    text_type: item.text_type,
    retry_count: item.retry_count,
    skip_internal_filter: item.skip_internal_filter,
  };
}

/**
 * 局部算法会修改视图，先复制以免污染上游缓存。
 */
export function clone_project_item_view_record(item: ProjectItemViewRecord): ProjectItemViewRecord {
  return {
    ...item,
  };
}

/**
 * 构造空闲翻译任务快照，供 reset 或无历史进度时作为统计基底。
 */
export function create_empty_translation_task_snapshot(): Record<string, unknown> {
  const progress: BatchTranslationProgress = {
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_input_tokens: 0,
    total_reasoning_tokens: 0,
    total_output_tokens: 0,
    time: 0,
    start_time: 0,
  };
  return {
    status: "idle",
    request_in_flight_count: 0,
    progress,
    scope: { kind: "all" },
  };
}

/**
 * 按最终 item 状态重建翻译进度 meta；任务生命周期仍由 BatchTranslationSnapshot 管理。
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

  const translation_extras = {
    ...normalize_batch_translation_progress(args.task_snapshot.progress ?? args.task_snapshot),
  };
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  return translation_extras;
}

/**
 * 从 files section 镜像收窄预过滤需要的路径和格式字段。
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

/**
 * 将 record 形状的 item 集合收窄成公开 DTO Map，边界丢弃非法条目。
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

/**
 * 将公开 DTO Map 转成预过滤和进度统计使用的轻量视图 Map。
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

/**
 * 预过滤核心只接收后端权威项目快照，输出完整可写的计算事实。
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
  const kvjson_items_by_path = new Map<string, ProjectItemViewRecord[]>();

  for (const item of item_index.values()) {
    const file_type = file_type_by_path.get(item.file_path);
    if (item.status === "LANGUAGE_SKIPPED" || item.status === "DUPLICATED") {
      item.status = "NONE";
    }
    // KVJSON 的 RULE_SKIPPED 可能来自可切换的 MTool 优化；先清理后由通用规则和当前开关重算。
    if (item.status === "RULE_SKIPPED" && file_type === "KVJSON") {
      item.status = "NONE";
    } else if (item.status === "RULE_SKIPPED") {
      rule_skipped += 1;
    }
    if (input.mtool_optimizer_enable && file_type === "KVJSON") {
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

  const duplicate_changes = coordinate_project_duplicate_statuses(
    [...item_index.values()],
    input.skip_duplicate_source_text_enable,
  );
  for (const change of duplicate_changes) {
    const item = item_index.get(change.item_id);
    if (item !== undefined) item.status = change.status;
  }
  const duplicated = [...item_index.values()].filter((item) => item.status === "DUPLICATED").length;

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
