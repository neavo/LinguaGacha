export type RuntimeProjectItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  name_dst: unknown;
  status: string;
  text_type: string;
  retry_count: number;
};

const TRACKED_TRANSLATION_STATUSES = new Set(["NONE", "PROCESSED", "ERROR"]);
const ANALYSIS_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

export function normalize_runtime_project_item_record(
  value: unknown,
): RuntimeProjectItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id) || item_id <= 0) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    name_dst: candidate.name_dst ?? null,
    status: String(candidate.status ?? "NONE"),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

export function clone_runtime_project_item_record(
  item: RuntimeProjectItemRecord,
): RuntimeProjectItemRecord {
  return {
    ...item,
  };
}

function build_translation_extras(task_snapshot: Record<string, unknown>): Record<string, unknown> {
  const translation_extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task_snapshot)) {
    if (
      key === "task_type" ||
      key === "status" ||
      key === "busy" ||
      key === "request_in_flight_count" ||
      key === "analysis_candidate_count"
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
    status: "IDLE",
    busy: false,
    request_in_flight_count: 0,
    line: 0,
    total_line: 0,
    processed_line: 0,
    error_line: 0,
    total_tokens: 0,
    total_output_tokens: 0,
    total_input_tokens: 0,
    time: 0,
    start_time: 0,
    analysis_candidate_count: 0,
  };
}

export function build_translation_task_and_project_state(args: {
  task_snapshot: Record<string, unknown>;
  items: Map<number, RuntimeProjectItemRecord>;
  analysis_candidate_count?: number;
}): {
  translation_extras: Record<string, unknown>;
  project_status: string;
  task_snapshot: Record<string, unknown>;
} {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;
  let has_pending = false;

  for (const item of args.items.values()) {
    if (item.status === "PROCESSED") {
      processed_line += 1;
    }
    if (item.status === "ERROR") {
      error_line += 1;
    }
    if (item.status === "NONE") {
      has_pending = true;
    }
    if (TRACKED_TRANSLATION_STATUSES.has(item.status)) {
      total_line += 1;
    }
  }

  const translation_extras = build_translation_extras(args.task_snapshot);
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  const project_status = total_line <= 0 ? "NONE" : has_pending ? "PROCESSING" : "PROCESSED";

  return {
    translation_extras,
    project_status,
    task_snapshot: {
      ...args.task_snapshot,
      ...translation_extras,
      analysis_candidate_count:
        args.analysis_candidate_count ?? Number(args.task_snapshot.analysis_candidate_count ?? 0),
    },
  };
}

export function build_analysis_status_summary(
  items: Iterable<RuntimeProjectItemRecord>,
): Record<string, unknown> {
  let total_line = 0;
  for (const item of items) {
    if (item.src.trim() === "" || ANALYSIS_SKIPPED_STATUSES.has(item.status)) {
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
