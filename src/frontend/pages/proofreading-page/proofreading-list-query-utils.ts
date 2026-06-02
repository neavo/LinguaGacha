import { JsonTool } from "@shared/utils/json-tool";
import type {
  ProofreadingFilterOptions,
  ProofreadingListView,
  ProofreadingSearchScope,
} from "@shared/proofreading/proofreading-types";
import type {
  ProofreadingListWindow,
  ProofreadingSyncState,
} from "@shared/proofreading/proofreading-list-reader";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import { build_filter_signature } from "@frontend/pages/proofreading-page/proofreading-filter-state";

export const PROOFREADING_INITIAL_WINDOW_ROWS = 128;
export const PROOFREADING_WINDOW_PREFETCH_ROWS = 256;

export type ProofreadingListWindowBounds = {
  start: number;
  count: number;
};

export type ProofreadingListQueryInput = {
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
};

export type ProofreadingRefreshSignal = {
  seq: number;
  mode: "full" | "delta" | "noop";
  itemIds: number[];
  deleteItemIds: number[];
};

export function resolve_prefetched_list_window_bounds(args: {
  range: ProofreadingListWindowBounds;
  row_count: number;
}): ProofreadingListWindowBounds {
  const request_start = Math.max(0, args.range.start - PROOFREADING_WINDOW_PREFETCH_ROWS);
  const requested_count = Math.max(
    PROOFREADING_INITIAL_WINDOW_ROWS,
    args.range.count + PROOFREADING_WINDOW_PREFETCH_ROWS * 2,
  );
  const remaining_count = args.row_count > 0 ? Math.max(0, args.row_count - request_start) : 0;
  return {
    start: request_start,
    count: remaining_count > 0 ? Math.min(remaining_count, requested_count) : requested_count,
  };
}

export function resolve_list_view_window_bounds(
  list_view: ProofreadingListView,
): ProofreadingListWindowBounds {
  return {
    start: list_view.window_start,
    count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, list_view.window_rows.length),
  };
}

export function build_refreshed_proofreading_list_view(args: {
  previous_view: ProofreadingListView;
  sync_state: ProofreadingSyncState;
  window: ProofreadingListWindow;
}): ProofreadingListView {
  return {
    ...args.previous_view,
    projectId: args.sync_state.projectId,
    revisions: {
      files: args.sync_state.revisions.files,
      items: args.sync_state.revisions.items,
      quality: args.sync_state.revisions.quality,
      proofreading: args.sync_state.revisions.proofreading,
    },
    row_count: args.window.row_count,
    window_start: args.window.start,
    window_rows: args.window.rows,
  };
}

export function is_missing_refreshed_list_window(args: {
  previous_view: ProofreadingListView;
  window: ProofreadingListWindow;
}): boolean {
  return (
    args.previous_view.row_count > 0 && args.window.row_count === 0 && args.window.rows.length === 0
  );
}

export function build_sort_signature(sort_state: AppTableSortState | null): string {
  return sort_state === null ? "null" : `${sort_state.column_id}:${sort_state.direction}`;
}

export function build_list_query_signature(args: {
  revisions: {
    items: number;
    quality: number;
    proofreading: number;
  };
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
}): string {
  return JsonTool.stringifyStrict({
    revisions: args.revisions,
    filters: build_filter_signature(args.filters),
    keyword: args.keyword,
    scope: args.scope,
    is_regex: args.is_regex,
    sort: build_sort_signature(args.sort_state),
  });
}

export function build_sync_list_query_signature(args: {
  sync_state: ProofreadingSyncState;
  query: ProofreadingListQueryInput;
}): string {
  return build_list_query_signature({
    revisions: args.sync_state.revisions,
    filters: args.query.filters,
    keyword: args.query.keyword,
    scope: args.query.scope,
    is_regex: args.query.is_regex,
    sort_state: args.query.sort_state,
  });
}

export function build_filter_panel_signature(args: {
  revisions: {
    items: number;
    quality: number;
    proofreading: number;
  };
  filters: ProofreadingFilterOptions;
}): string {
  return JsonTool.stringifyStrict({
    revisions: args.revisions,
    filters: build_filter_signature(args.filters),
  });
}

export function resolve_requested_sync_mode(args: {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  sync_state: ProofreadingSyncState | null;
  project_path: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal_mode: "full" | "delta" | "noop";
}): "full" | "delta" | "noop" {
  if (
    args.cache_status === "error" ||
    args.sync_state === null ||
    args.sync_state.projectId !== args.project_path
  ) {
    return "full";
  }

  if (args.sync_state.sourceLanguage !== args.sourceLanguage) {
    return "full";
  }

  if (args.sync_state.targetLanguage !== args.targetLanguage) {
    return "full";
  }

  return args.signal_mode;
}

export function resolve_proofreading_refresh_signal(signal: {
  seq: number;
  updated_sections: string[];
  results: Array<{
    itemDelta?: {
      upsertItemIds: Array<number | string>;
      deleteItemIds: Array<number | string>;
      fullReplace: boolean;
    };
  }>;
}): ProofreadingRefreshSignal | null {
  if (signal.updated_sections.length === 0) {
    return null;
  }
  if (signal.updated_sections.every((section) => section === "proofreading")) {
    return {
      seq: signal.seq,
      mode: "noop",
      itemIds: [],
      deleteItemIds: [],
    };
  }
  if (
    signal.updated_sections.some((section) => ["project", "files", "quality"].includes(section)) ||
    signal.results.some((result) => result.itemDelta?.fullReplace === true)
  ) {
    return {
      seq: signal.seq,
      mode: "full",
      itemIds: [],
      deleteItemIds: [],
    };
  }
  const item_ids = normalize_refresh_item_ids(
    signal.results.flatMap((result) => result.itemDelta?.upsertItemIds ?? []),
  );
  const delete_item_ids = normalize_refresh_item_ids(
    signal.results.flatMap((result) => result.itemDelta?.deleteItemIds ?? []),
  );
  if (signal.updated_sections.includes("items")) {
    if (item_ids.length > 0 || delete_item_ids.length > 0) {
      return {
        seq: signal.seq,
        mode: "delta",
        itemIds: item_ids,
        deleteItemIds: delete_item_ids,
      };
    }
    return {
      seq: signal.seq,
      mode: "full",
      itemIds: [],
      deleteItemIds: [],
    };
  }
  if (
    signal.updated_sections.some((section) =>
      ["project", "items", "quality", "proofreading"].includes(section),
    )
  ) {
    return {
      seq: signal.seq,
      mode: "full",
      itemIds: [],
      deleteItemIds: [],
    };
  }
  return null;
}

function normalize_refresh_item_ids(values: Array<number | string>): number[] {
  const ids = new Set<number>();
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      ids.add(parsed);
    }
  }
  return [...ids];
}
