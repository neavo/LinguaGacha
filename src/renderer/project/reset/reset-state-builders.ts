import {
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "@base/item";
import { TASK_PROGRESS_STATUSES, is_task_skipped_item_status } from "@shared/task";

// reset、prefilter 和统计逻辑只需要可变视图字段，不能把它当完整持久事实写回
export type ProjectItemViewRecord = {
  item_id: number; // 公开 item 主键
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

// 外部输入必须先是完整公开 DTO，派生视图只服务局部计算
export function derive_project_item_view_record(value: unknown): ProjectItemViewRecord | null {
  const item = normalize_project_item_public_record(value);
  if (item === null) {
    return null;
  }
  return derive_project_item_view_record_from_public(item);
}

// 从已校验公开 DTO 派生可变视图，保留 reset 计算需要的字段
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

// 局部计算会原地修改视图，复制后再交给调用点避免污染上游缓存
export function clone_project_item_view_record(item: ProjectItemViewRecord): ProjectItemViewRecord {
  return {
    ...item,
  };
}

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

export function build_translation_task_and_project_state(args: {
  task_snapshot: Record<string, unknown>;
  items: Map<number, ProjectItemViewRecord>;
}): {
  translation_extras: Record<string, unknown>;
  task_snapshot: Record<string, unknown>;
} {
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

  return {
    translation_extras,
    task_snapshot: {
      ...args.task_snapshot,
      status: "idle",
      progress: translation_extras,
      extras: { kind: "translation", scope: { kind: "all" } },
    },
  };
}

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
