import type {
  WorkbenchSelectorFileRecord,
  WorkbenchSelectorItemRecord,
  WorkbenchStats,
} from "./types";

type BuildWorkbenchViewArgs = {
  files: Record<string, unknown>;
  items: Record<string, unknown>;
  analysis?: Record<string, unknown>;
};

const ANALYSIS_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

function normalizeWorkbenchFileRecord(value: unknown): WorkbenchSelectorFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as WorkbenchSelectorFileRecord).rel_path ?? ""),
    file_type: String((value as WorkbenchSelectorFileRecord).file_type ?? ""),
    sort_index: Number((value as WorkbenchSelectorFileRecord).sort_index ?? 0),
  };
}

function normalizeWorkbenchItemRecord(value: unknown): WorkbenchSelectorItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    item_id: Number((value as WorkbenchSelectorItemRecord).item_id ?? 0),
    file_path: String((value as WorkbenchSelectorItemRecord).file_path ?? ""),
    src: String((value as WorkbenchSelectorItemRecord).src ?? ""),
    status: String((value as WorkbenchSelectorItemRecord).status ?? ""),
  };
}

function clamp_count(value: number, min_value: number, max_value: number): number {
  return Math.min(max_value, Math.max(min_value, value));
}

function read_count(value: unknown): number {
  const number_value = Number(value ?? 0);
  return Number.isFinite(number_value) ? number_value : 0;
}

function complete_workbench_stats(args: {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
}): WorkbenchStats {
  const completed_or_skipped_count = args.completed_count + args.skipped_count;
  return {
    total_items: args.total_items,
    completed_count: args.completed_count,
    failed_count: args.failed_count,
    pending_count: args.pending_count,
    skipped_count: args.skipped_count,
    completion_percent:
      args.total_items > 0 ? (completed_or_skipped_count / args.total_items) * 100 : 0,
  };
}

function buildAnalysisStatsFromItems(item_values: WorkbenchSelectorItemRecord[]): WorkbenchStats {
  let total_line = 0;

  for (const item of item_values) {
    if (item.src.trim() === "" || ANALYSIS_SKIPPED_STATUSES.has(item.status)) {
      continue;
    }
    total_line += 1;
  }

  return complete_workbench_stats({
    total_items: item_values.length,
    completed_count: 0,
    failed_count: 0,
    pending_count: total_line,
    skipped_count: Math.max(0, item_values.length - total_line),
  });
}

function buildAnalysisStats(args: {
  item_values: WorkbenchSelectorItemRecord[];
  analysis: Record<string, unknown> | undefined;
}): WorkbenchStats {
  const status_summary = args.analysis?.status_summary;
  if (typeof status_summary !== "object" || status_summary === null) {
    return buildAnalysisStatsFromItems(args.item_values);
  }

  const summary = status_summary as Record<string, unknown>;
  const total_items = args.item_values.length;
  const total_line = clamp_count(read_count(summary.total_line), 0, total_items);
  const completed_count = clamp_count(read_count(summary.processed_line), 0, total_line);
  const failed_count = clamp_count(
    read_count(summary.error_line),
    0,
    Math.max(0, total_line - completed_count),
  );
  const pending_count = Math.max(0, total_line - completed_count - failed_count);

  return complete_workbench_stats({
    total_items,
    completed_count,
    failed_count,
    pending_count,
    skipped_count: Math.max(0, total_items - total_line),
  });
}

export function buildWorkbenchView(args: BuildWorkbenchViewArgs) {
  const item_values = Object.values(args.items)
    .map((item) => normalizeWorkbenchItemRecord(item))
    .filter((item): item is WorkbenchSelectorItemRecord => item !== null);
  const file_values = Object.values(args.files)
    .map((file) => normalizeWorkbenchFileRecord(file))
    .filter((file): file is WorkbenchSelectorFileRecord => file !== null)
    .sort((left_file, right_file) => {
      const sort_result = left_file.sort_index - right_file.sort_index;
      if (sort_result !== 0) {
        return sort_result;
      }

      return left_file.rel_path.localeCompare(right_file.rel_path, "zh-Hans-CN");
    });
  const item_count_by_file_path = new Map<string, number>();
  let translation_completed_count = 0;
  let translation_failed_count = 0;
  let translation_pending_count = 0;
  let translation_skipped_count = 0;

  for (const item of item_values) {
    item_count_by_file_path.set(
      item.file_path,
      (item_count_by_file_path.get(item.file_path) ?? 0) + 1,
    );

    if (item.status === "ERROR") {
      translation_failed_count += 1;
      continue;
    }
    if (item.status === "PROCESSED") {
      translation_completed_count += 1;
      continue;
    }
    if (item.status === "NONE") {
      translation_pending_count += 1;
      continue;
    }
    translation_skipped_count += 1;
  }

  const translation_stats = complete_workbench_stats({
    total_items: item_values.length,
    completed_count: translation_completed_count,
    failed_count: translation_failed_count,
    pending_count: translation_pending_count,
    skipped_count: translation_skipped_count,
  });
  const analysis_stats = buildAnalysisStats({
    item_values,
    analysis: args.analysis,
  });

  const entries = file_values.map((file) => {
    return {
      rel_path: file.rel_path,
      file_type: file.file_type,
      item_count: item_count_by_file_path.get(file.rel_path) ?? 0,
    };
  });

  return {
    entries,
    summary: {
      file_count: entries.length,
      total_items: item_values.length,
      translation_stats,
      analysis_stats,
    },
  };
}
