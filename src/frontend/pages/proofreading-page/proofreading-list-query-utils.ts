import { JsonTool } from "@shared/utils/json-tool";
import type {
  ProofreadingFilterOptions,
  ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import type {
  ProofreadingListViewQuery,
  ProofreadingListWindow,
  ProofreadingSyncState,
} from "@shared/proofreading/proofreading-reader";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import {
  build_filter_signature,
  type ProofreadingViewFilterState,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";

export const PROOFREADING_INITIAL_WINDOW_ROWS = 128;
export const PROOFREADING_WINDOW_PREFETCH_ROWS = 256;

export type ProofreadingListWindowBounds = {
  start: number;
  count: number;
};

export type ProofreadingResolvedListQuery = {
  query_intent_key: string; // 只描述用户查询意图，不吸收 revision 或后端默认筛选的具体值
  query: ProofreadingListViewQuery; // 执行时按最新默认筛选物化出的后端查询
};

export type ProofreadingListSnapshot = {
  query_intent_key: string; // 创建当前 view 时使用的用户查询意图
  view: ProofreadingListView; // 与意图原子发布，避免异步刷新拼接平行 state/ref
};

export type ProofreadingRefreshSignal = {
  seq: number;
  mode: "full" | "delta" | "noop";
  itemIds: number[];
  deleteItemIds: number[];
};

/**
 * 把可见范围扩成预取窗口，并限制在当前稳定视图的行数内。
 */
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

/**
 * 从当前视图恢复下一次刷新窗口；空窗口也至少读取首屏容量。
 */
export function resolve_list_view_window_bounds(
  list_view: ProofreadingListView,
): ProofreadingListWindowBounds {
  return {
    start: list_view.window_start,
    count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, list_view.window_rows.length),
  };
}

/**
 * delta 刷新只替换旧视图的 revision 与窗口内容，保留成员身份、排序和 view_id。
 */
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

/**
 * 非空旧视图突然返回空窗口表示 view_id 已失效，需要退回完整 list query。
 */
export function is_missing_refreshed_list_window(args: {
  previous_view: ProofreadingListView;
  window: ProofreadingListWindow;
}): boolean {
  return (
    args.previous_view.row_count > 0 && args.window.row_count === 0 && args.window.rows.length === 0
  );
}

/**
 * 查询意图键只编码用户可编辑状态；后端默认筛选变化不得让 delta 刷新重算成员。
 */
export function build_proofreading_list_query_intent_key(args: {
  filter_state: ProofreadingViewFilterState;
  sort_state: AppTableSortState | null;
}): string {
  return JsonTool.stringifyStrict({
    filter_state: args.filter_state,
    sort_state: args.sort_state,
  });
}

/**
 * 筛选面板依赖当前 revision 和物化筛选，任一变化都必须重新统计。
 */
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

/**
 * 项目、语言或错误态改变缓存身份时强制全量同步，其余情况沿用事件模式。
 */
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

/**
 * 只把能精确表达行级变化的公开事件降为 delta，其余相关变化要求全量刷新。
 */
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

/**
 * 跨边界 item id 只接受去重后的正整数，避免无效载荷污染 delta 请求。
 */
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
