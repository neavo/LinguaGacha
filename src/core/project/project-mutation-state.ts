import {
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../base/item";
import { should_skip_by_language_prefilter } from "../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../shared/prefilter/rule-prefilter";
import { is_task_skipped_item_status, TASK_PROGRESS_STATUSES } from "../../shared/task";

type ProjectMutationFileRecord = {
  rel_path: string; // 项目内相对路径，用于按文件分组预过滤
  file_type: string; // 格式类型，只参与 KVJSON 优化分支
};

export type ProjectMutationState = {
  files: Record<string, unknown>; // files section 镜像，调用方需提供当前完整文件集合
  items: Record<string, unknown>; // items section 镜像，调用方需提供当前完整公开 DTO 集合
};

export type ProjectItemViewRecord = {
  item_id: number; // 公开 item 主键，所有局部 mutation 都以它定位数据库事实
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

export type ProjectAnalysisMutationOutput = {
  extras: Record<string, unknown>; // 当前分析进度保留字段，新建和 reset 默认从空对象开始
  candidate_count: number; // 当前候选术语数，预过滤不会生成候选
  status_summary: Record<string, unknown>; // 分析视角的可处理、已处理和失败行数摘要
};

export type ProjectPrefilterMutationOutput = {
  items: Record<string, ProjectItemPublicRecord>; // 预过滤后的完整公开 item 集合
  analysis: ProjectAnalysisMutationOutput; // 重置后的分析派生事实
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

export type ProjectPrefilterMutationInput = {
  state: ProjectMutationState; // 当前项目事实快照，调用方负责提供后端权威事实
  task_snapshot?: Record<string, unknown>; // 可选旧进度基底，缺省时从空翻译进度开始
  source_language: string; // 源语言预过滤口径
  target_language?: string; // 只写入 settings mirror，不参与预过滤判断
  mtool_optimizer_enable: boolean; // 是否启用 KVJSON 优化预过滤
  skip_duplicate_source_text_enable: boolean; // 是否启用同文件重复原文过滤
};

// 外部输入必须先是完整公开 DTO，派生视图只服务局部计算。
export function derive_project_item_view_record(value: unknown): ProjectItemViewRecord | null {
  const item = normalize_project_item_public_record(value);
  if (item === null) {
    return null;
  }
  return derive_project_item_view_record_from_public(item);
}

// 从已校验公开 DTO 派生可变视图，保留 reset、预过滤和统计需要的字段。
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
export function clone_project_item_view_record(item: ProjectItemViewRecord): ProjectItemViewRecord {
  return {
    ...item,
  };
}

// 从任务快照中提取可持久化进度字段，排除任务生命周期专用字段。
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
function normalize_file_record(value: unknown): ProjectMutationFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as ProjectMutationFileRecord).rel_path ?? ""),
    file_type: String((value as ProjectMutationFileRecord).file_type ?? "NONE"),
  };
}

// 把 record 形状的 item 集合收窄成公开 DTO Map，非法条目在后端算法边界丢弃。
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

// 把公开 DTO Map 派生为预过滤和进度统计使用的轻量 view Map。
export function build_item_view_map(
  public_items: Map<number, ProjectItemPublicRecord>,
): Map<number, ProjectItemViewRecord> {
  const item_map = new Map<number, ProjectItemViewRecord>();
  for (const item of public_items.values()) {
    item_map.set(item.item_id, derive_project_item_view_record_from_public(item));
  }
  return item_map;
}

// 后端预过滤核心只接收当前项目事实快照，输出完整可写的派生事实。
export function compute_project_prefilter_mutation(
  input: ProjectPrefilterMutationInput,
): ProjectPrefilterMutationOutput {
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
