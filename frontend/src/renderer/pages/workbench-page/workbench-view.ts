import type {
  WorkbenchSelectorFileRecord,
  WorkbenchSelectorItemRecord,
  WorkbenchSnapshot,
  WorkbenchSnapshotEntry,
  WorkbenchStats,
} from "./types";

type BuildWorkbenchViewArgs = {
  files: Record<string, unknown>;
  items: Record<string, unknown>;
  analysis?: Record<string, unknown>;
};

export type WorkbenchViewCache = {
  snapshot: WorkbenchSnapshot;
  files: WorkbenchSelectorFileRecord[];
  items_by_id: Map<string, WorkbenchSelectorItemRecord>;
  item_count_by_file_path: Map<string, number>;
  translation_counts: {
    completed_count: number;
    failed_count: number;
    pending_count: number;
    skipped_count: number;
  };
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

function buildAnalysisStatsFromSummary(args: {
  total_items: number;
  analysis: Record<string, unknown> | undefined;
}): WorkbenchStats | null {
  const status_summary = args.analysis?.status_summary;
  if (typeof status_summary !== "object" || status_summary === null) {
    return null;
  }

  const summary = status_summary as Record<string, unknown>;
  const total_line = clamp_count(read_count(summary.total_line), 0, args.total_items);
  const completed_count = clamp_count(read_count(summary.processed_line), 0, total_line);
  const failed_count = clamp_count(
    read_count(summary.error_line),
    0,
    Math.max(0, total_line - completed_count),
  );
  const pending_count = Math.max(0, total_line - completed_count - failed_count);

  return complete_workbench_stats({
    total_items: args.total_items,
    completed_count,
    failed_count,
    pending_count,
    skipped_count: Math.max(0, args.total_items - total_line),
  });
}

function buildAnalysisStats(args: {
  item_values: WorkbenchSelectorItemRecord[];
  analysis: Record<string, unknown> | undefined;
}): WorkbenchStats {
  const summary_stats = buildAnalysisStatsFromSummary({
    total_items: args.item_values.length,
    analysis: args.analysis,
  });
  if (summary_stats === null) {
    return buildAnalysisStatsFromItems(args.item_values);
  }

  return summary_stats;
}

function apply_translation_count_delta(
  counts: WorkbenchViewCache["translation_counts"],
  item: WorkbenchSelectorItemRecord,
  delta: 1 | -1,
): void {
  if (item.status === "ERROR") {
    counts.failed_count += delta;
    return;
  }
  if (item.status === "PROCESSED") {
    counts.completed_count += delta;
    return;
  }
  if (item.status === "NONE") {
    counts.pending_count += delta;
    return;
  }
  counts.skipped_count += delta;
}

function apply_file_item_count_delta(
  item_count_by_file_path: Map<string, number>,
  file_path: string,
  delta: 1 | -1,
): void {
  const next_count = (item_count_by_file_path.get(file_path) ?? 0) + delta;
  if (next_count <= 0) {
    item_count_by_file_path.delete(file_path);
    return;
  }

  item_count_by_file_path.set(file_path, next_count);
}

function build_entries_from_cache(cache: WorkbenchViewCache): WorkbenchSnapshotEntry[] {
  return cache.files.map((file) => {
    return {
      rel_path: file.rel_path,
      file_type: file.file_type,
      item_count: cache.item_count_by_file_path.get(file.rel_path) ?? 0,
    };
  });
}

function build_translation_stats_from_cache(cache: WorkbenchViewCache): WorkbenchStats {
  return complete_workbench_stats({
    total_items: cache.items_by_id.size,
    completed_count: cache.translation_counts.completed_count,
    failed_count: cache.translation_counts.failed_count,
    pending_count: cache.translation_counts.pending_count,
    skipped_count: cache.translation_counts.skipped_count,
  });
}

function build_snapshot_from_cache(
  cache: WorkbenchViewCache,
  analysis: Record<string, unknown> | undefined,
): WorkbenchSnapshot | null {
  const analysis_stats = buildAnalysisStatsFromSummary({
    total_items: cache.items_by_id.size,
    analysis,
  });
  if (analysis_stats === null) {
    return null;
  }

  const entries = build_entries_from_cache(cache);
  return {
    entries,
    file_count: entries.length,
    total_items: cache.items_by_id.size,
    translation_stats: build_translation_stats_from_cache(cache),
    analysis_stats,
  };
}

export function createWorkbenchViewCache(args: BuildWorkbenchViewArgs): WorkbenchViewCache {
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
  const items_by_id = new Map<string, WorkbenchSelectorItemRecord>();
  const translation_counts = {
    completed_count: 0,
    failed_count: 0,
    pending_count: 0,
    skipped_count: 0,
  };

  for (const item of item_values) {
    items_by_id.set(String(item.item_id), item);
    item_count_by_file_path.set(
      item.file_path,
      (item_count_by_file_path.get(item.file_path) ?? 0) + 1,
    );
    apply_translation_count_delta(translation_counts, item, 1);
  }

  const translation_stats = complete_workbench_stats({
    total_items: item_values.length,
    completed_count: translation_counts.completed_count,
    failed_count: translation_counts.failed_count,
    pending_count: translation_counts.pending_count,
    skipped_count: translation_counts.skipped_count,
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

  const snapshot = {
    entries,
    file_count: entries.length,
    total_items: item_values.length,
    translation_stats,
    analysis_stats,
  };

  return {
    snapshot,
    files: file_values,
    items_by_id,
    item_count_by_file_path,
    translation_counts,
  };
}

export function applyWorkbenchItemsDeltaToCache(args: {
  cache: WorkbenchViewCache;
  state: BuildWorkbenchViewArgs;
  item_ids: Array<number | string>;
}): WorkbenchViewCache | null {
  const cache: WorkbenchViewCache = {
    snapshot: args.cache.snapshot,
    files: args.cache.files,
    items_by_id: new Map(args.cache.items_by_id),
    item_count_by_file_path: new Map(args.cache.item_count_by_file_path),
    translation_counts: { ...args.cache.translation_counts },
  };

  for (const item_id of new Set(args.item_ids.map((value) => String(value)))) {
    const previous_item = cache.items_by_id.get(item_id) ?? null;
    const next_item = normalizeWorkbenchItemRecord(args.state.items[item_id]);

    if (previous_item !== null) {
      cache.items_by_id.delete(item_id);
      apply_file_item_count_delta(cache.item_count_by_file_path, previous_item.file_path, -1);
      apply_translation_count_delta(cache.translation_counts, previous_item, -1);
    }

    if (next_item !== null) {
      cache.items_by_id.set(item_id, next_item);
      apply_file_item_count_delta(cache.item_count_by_file_path, next_item.file_path, 1);
      apply_translation_count_delta(cache.translation_counts, next_item, 1);
    }
  }

  const snapshot = build_snapshot_from_cache(cache, args.state.analysis);
  if (snapshot === null) {
    return null;
  }

  return {
    ...cache,
    snapshot,
  };
}

export function buildWorkbenchView(args: BuildWorkbenchViewArgs) {
  const cache = createWorkbenchViewCache(args);
  return {
    entries: cache.snapshot.entries,
    summary: {
      file_count: cache.snapshot.file_count,
      total_items: cache.snapshot.total_items,
      translation_stats: cache.snapshot.translation_stats,
      analysis_stats: cache.snapshot.analysis_stats,
    },
  };
}
