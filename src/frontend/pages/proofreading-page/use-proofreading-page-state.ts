import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  INPUT_QUERY_DEBOUNCE_MS,
  useDebouncedCallback,
} from "@frontend/widgets/interactions/use-debounce";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useProjectSessionTableUiState } from "@frontend/app/session/project-session-ui-state-context";
import {
  create_replace_all_plan,
  create_save_item_plan,
  type ProofreadingCommandPlan,
} from "@shared/proofreading/proofreading-command-planner";
import { useProofreadingBatchActions } from "@frontend/pages/proofreading-page/use-proofreading-batch-actions";
import {
  compile_text_pattern,
  matches_text_pattern,
  replace_text_pattern,
  type CompiledTextPattern,
} from "@shared/text/text-pattern";
import { createProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import type {
  ProofreadingListWindow,
  ProofreadingSyncState,
} from "@shared/proofreading/proofreading-list-reader";
import type {
  AppTableScrollAnchor,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

import { JsonTool } from "../../../shared/utils/json-tool";
import type { ProjectDataSection, ProjectDataSectionRevisions } from "@shared/project-event";
import {
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingClientItem,
  type ProofreadingDialogState,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingListView,
  type ProofreadingManualStatusCode,
  type ProofreadingPendingConfirmation,
  type ProofreadingSearchScope,
  type ProofreadingVisibleItem,
} from "@frontend/pages/proofreading-page/types";

// 校对页所有保存动作共享同一业务 operation，具体 item 范围留在写入 context。
const PROOFREADING_WRITE: ProjectWriteOperation = "proofreading.write";

const PROOFREADING_INITIAL_WINDOW_ROWS = 128; // 首屏只取可见窗口的轻量余量，避免初次状态包过大
const PROOFREADING_WINDOW_PREFETCH_ROWS = 256; // 滚动读取前后扩展窗口，降低快速滚动时的补取频率
const PROOFREADING_REPLACE_SCAN_CHUNK_ROWS = 256; // 替换查找按较大块扫描，减少查询往返
const PROOFREADING_REQUIRED_SECTIONS: ProjectDataSection[] = [
  "project",
  "items",
  "quality",
  "proofreading",
];
// session 恢复排序的白名单，避免旧列 id 进入列表查询。
const PROOFREADING_SORT_COLUMN_IDS = new Set(["src", "dst", "status"]);

// 区分“跟随后端默认值”和“用户显式选择”，保留跨 sync 的筛选语义。
type ProofreadingFilterChoice<T> =
  | {
      mode: "default";
    }
  | {
      mode: "selected";
      values: T[];
    };

// 保存用户筛选意图，默认模式会随最新 sync 默认筛选展开。
type ProofreadingFilterSelection = {
  warning_types: ProofreadingFilterChoice<string>;
  statuses: ProofreadingFilterChoice<string>;
  file_paths: ProofreadingFilterChoice<string>;
  glossary_terms: ProofreadingFilterChoice<ProofreadingGlossaryTerm>;
  include_without_glossary_miss: boolean;
};

// 校对页登记到 session UI state 的轻量查询状态。
type ProofreadingViewFilterState = {
  selection: ProofreadingFilterSelection;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
};

// 记录当前预取窗口，供 delta 刷新复用同一视觉范围。
type ProofreadingListWindowBounds = {
  start: number;
  count: number;
};

// 切断 session 快照引用，避免页面排序对象被外部复用。
function clone_app_table_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  return sort_state === null
    ? null
    : {
        column_id: sort_state.column_id,
        direction: sort_state.direction,
      };
}

// 在 session 边界收窄排序状态，坏状态统一回到默认排序。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_proofreading_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  if (sort_state === null || !PROOFREADING_SORT_COLUMN_IDS.has(sort_state.column_id)) {
    return null;
  }

  return clone_app_table_sort_state(sort_state);
}

// 该维度跟随后端当前 defaultFilters。
function create_default_filter_choice<T>(): ProofreadingFilterChoice<T> {
  return {
    mode: "default",
  };
}

// 固化用户显式选择，并通过 clone_value 切断外部引用。
function create_selected_filter_choice<T>(
  values: T[],
  clone_value: (value: T) => T,
): ProofreadingFilterChoice<T> {
  return {
    mode: "selected",
    values: values.map((value) => clone_value(value)),
  };
}

// 复制筛选维度意图，避免 session 快照和页面状态共享数组。
function clone_filter_choice<T>(
  choice: ProofreadingFilterChoice<T>,
  clone_value: (value: T) => T,
): ProofreadingFilterChoice<T> {
  if (choice.mode === "default") {
    return create_default_filter_choice();
  }

  return create_selected_filter_choice(choice.values, clone_value);
}

// 把默认或显式选择展开成后端 query 可消费的具体值。
function materialize_filter_choice<T>(
  choice: ProofreadingFilterChoice<T>,
  default_values: T[],
  clone_value: (value: T) => T,
): T[] {
  const source_values = choice.mode === "default" ? default_values : choice.values;
  return source_values.map((value) => clone_value(value));
}

// 复制只读 tuple，避免术语筛选被外部数组改写污染。
function clone_glossary_term(term: ProofreadingGlossaryTerm): ProofreadingGlossaryTerm {
  return [term[0], term[1]] as const;
}

// 生成随 sync 默认筛选漂移的筛选意图。
function create_default_proofreading_filter_selection(
  default_filters: ProofreadingFilterOptions = create_empty_filter_options(),
): ProofreadingFilterSelection {
  return {
    warning_types: create_default_filter_choice(),
    statuses: create_default_filter_choice(),
    file_paths: create_default_filter_choice(),
    glossary_terms: create_default_filter_choice(),
    include_without_glossary_miss: default_filters.include_without_glossary_miss,
  };
}

// 把筛选弹窗确认结果固化为用户显式意图。
function create_selected_proofreading_filter_selection(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterSelection {
  return {
    warning_types: create_selected_filter_choice(filters.warning_types, (value) => value),
    statuses: create_selected_filter_choice(filters.statuses, (value) => value),
    file_paths: create_selected_filter_choice(filters.file_paths, (value) => value),
    glossary_terms: create_selected_filter_choice(filters.glossary_terms, clone_glossary_term),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

// 复制完整筛选意图，保证 session 恢复不会持有页面引用。
function clone_proofreading_filter_selection(
  selection: ProofreadingFilterSelection,
): ProofreadingFilterSelection {
  return {
    warning_types: clone_filter_choice(selection.warning_types, (value) => value),
    statuses: clone_filter_choice(selection.statuses, (value) => value),
    file_paths: clone_filter_choice(selection.file_paths, (value) => value),
    glossary_terms: clone_filter_choice(selection.glossary_terms, clone_glossary_term),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

// 在每次 sync 后用最新 defaultFilters 展开当前筛选意图。
function materialize_proofreading_filters(
  selection: ProofreadingFilterSelection,
  default_filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    warning_types: materialize_filter_choice(
      selection.warning_types,
      default_filters.warning_types,
      (value) => value,
    ),
    statuses: materialize_filter_choice(selection.statuses, default_filters.statuses, (value) => {
      return value;
    }),
    file_paths: materialize_filter_choice(
      selection.file_paths,
      default_filters.file_paths,
      (value) => value,
    ),
    glossary_terms: materialize_filter_choice(
      selection.glossary_terms,
      default_filters.glossary_terms,
      clone_glossary_term,
    ),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

// 提供校对页 session UI state 的初始查询状态。
function create_empty_proofreading_view_filter_state(): ProofreadingViewFilterState {
  return {
    selection: create_default_proofreading_filter_selection(),
    search_keyword: "",
    search_scope: "all",
    is_regex: false,
  };
}

// 复制 session 查询状态，隔离跨路由恢复快照。
function clone_proofreading_view_filter_state(
  filter_state: ProofreadingViewFilterState,
): ProofreadingViewFilterState {
  return {
    selection: clone_proofreading_filter_selection(filter_state.selection),
    search_keyword: filter_state.search_keyword,
    search_scope: filter_state.search_scope,
    is_regex: filter_state.is_regex,
  };
}

// 合并局部 patch 后统一克隆，避免调用点漏切引用。
function create_proofreading_view_filter_state(args: {
  selection: ProofreadingFilterSelection;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
}): ProofreadingViewFilterState {
  return {
    selection: clone_proofreading_filter_selection(args.selection),
    search_keyword: args.search_keyword,
    search_scope: args.search_scope,
    is_regex: args.is_regex,
  };
}

export type UseProofreadingPageStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  consumed_revisions: ProjectDataSectionRevisions;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
  is_refreshing: boolean;
  is_writing: boolean;
  readonly: boolean;
  search_keyword: string;
  replace_text: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
  invalid_regex_message: string | null;
  current_filters: ProofreadingFilterOptions;
  filter_dialog_filters: ProofreadingFilterOptions;
  filter_panel: ReturnType<typeof create_empty_proofreading_filter_panel_state>;
  filter_panel_loading: boolean;
  visible_items: ProofreadingVisibleItem[];
  visible_row_count: number;
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  restore_scroll_row_id: string | null;
  preserve_scroll_anchor: AppTableScrollAnchor;
  retranslating_row_ids: string[];
  filter_dialog_open: boolean;
  dialog_state: ProofreadingDialogState;
  dialog_item: ProofreadingItem | null;
  pending_confirmation: ProofreadingPendingConfirmation | null;
  refresh_snapshot: () => Promise<void>;
  update_search_keyword: (next_keyword: string) => void;
  update_replace_text: (next_replace_text: string) => void;
  update_search_scope: (next_scope: ProofreadingSearchScope) => void;
  update_regex: (next_is_regex: boolean) => void;
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  get_visible_row_at_index: (index: number) => ProofreadingVisibleItem | undefined;
  get_visible_row_id_at_index: (index: number) => string | undefined;
  resolve_visible_row_index: (row_id: string) => number | undefined;
  resolve_visible_row_index_async: (row_id: string) => Promise<number | undefined>;
  resolve_visible_row_ids_range: (range: { start: number; count: number }) => Promise<string[]>;
  read_visible_range: (range: { start: number; count: number }) => void;
  handle_table_selection_error: (error: unknown) => void;
  open_filter_dialog: () => void;
  close_filter_dialog: () => void;
  update_filter_dialog_filters: (next_filters: ProofreadingFilterOptions) => void;
  confirm_filter_dialog_filters: () => Promise<void>;
  open_edit_dialog: (row_id: string) => void;
  request_close_dialog: () => void;
  update_dialog_draft: (next_draft_dst: string) => void;
  save_dialog_entry: () => Promise<void>;
  replace_next_visible_match: () => Promise<void>;
  replace_all_visible_matches: () => Promise<void>;
  request_retranslate_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_clear_translation_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_set_translation_status_row_ids: (
    row_ids: string[],
    status: ProofreadingManualStatusCode,
    preferred_row_id?: string | null,
  ) => void;
  confirm_pending_confirmation: () => Promise<void>;
  close_pending_confirmation: () => void;
};

type ProofreadingListQueryInput = {
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
};

type ProofreadingRefreshSignal = {
  seq: number;
  mode: "full" | "delta" | "noop";
  itemIds: number[];
  deleteItemIds: number[];
};

/**
 * 判断当前值是否满足业务条件。
 */
function is_stale_proofreading_list_error(_error: unknown): boolean {
  return false;
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_filter_options(): ProofreadingFilterOptions {
  return {
    warning_types: [],
    statuses: [],
    file_paths: [],
    glossary_terms: [],
    include_without_glossary_miss: true,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_dst: "",
    saving: false,
  };
}

function serialize_glossary_terms(glossary_terms: ProofreadingGlossaryTerm[]): string[][] {
  return glossary_terms.map((term) => [term[0], term[1]]);
}

/**
 * 校对页搜索只编译单次匹配模式；全部替换的 global 模式由 planner 单独声明
 */
function create_search_pattern(keyword: string, is_regex: boolean): CompiledTextPattern | null {
  return compile_text_pattern({
    source_text: keyword,
    mode: is_regex ? "regex" : "literal",
    case_sensitive: false,
    global: false,
  });
}

/**
 * 空关键字和非法正则兜底由调用方处理，这里只判断已编译模式是否命中
 */
function matches_search_pattern(
  text: string,
  search_pattern: CompiledTextPattern | null,
  keyword: string,
): boolean {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return true;
  }

  if (search_pattern === null) {
    return true;
  }

  return matches_text_pattern(text, search_pattern);
}

/**
 * 单个替换和全部替换共用 replacement 语义：正则解释 `$1`，普通文本按字面量写入
 */
function replace_first_visible_match(
  text: string,
  search_pattern: CompiledTextPattern,
  replacement: string,
  is_regex: boolean,
): { text: string; replaced: boolean } {
  const replace_result = replace_text_pattern({
    text,
    pattern: search_pattern,
    replacement_text: replacement,
    replacement_syntax: is_regex ? "javascript" : "literal",
  });
  return {
    text: replace_result.text,
    replaced: replace_result.count > 0 && replace_result.text !== text,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function build_filter_signature(filters: ProofreadingFilterOptions): string {
  return JsonTool.stringifyStrict({
    warning_types: [...filters.warning_types].sort(),
    statuses: [...filters.statuses].sort(),
    file_paths: [...filters.file_paths].sort(),
    glossary_terms: serialize_glossary_terms(filters.glossary_terms).sort(
      (left_term, right_term) => {
        return left_term.join("→").localeCompare(right_term.join("→"), "zh-Hans-CN");
      },
    ),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  });
}

// 按当前可见范围扩展预取窗口，减少滚动边缘二次请求。
function resolve_prefetched_list_window_bounds(args: {
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

// 记录当前列表窗口，供项目刷新维持同一可见范围。
function resolve_list_view_window_bounds(
  list_view: ProofreadingListView,
): ProofreadingListWindowBounds {
  return {
    start: list_view.window_start,
    count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, list_view.window_rows.length),
  };
}

// 复用旧 view id，只替换 sync 后的行内容和 revision。
function build_refreshed_proofreading_list_view(args: {
  previous_view: ProofreadingListView;
  sync_state: ProofreadingSyncState;
  window: ProofreadingListWindow;
}): ProofreadingListView {
  return {
    ...args.previous_view,
    projectId: args.sync_state.projectId,
    revisions: {
      items: args.sync_state.revisions.items,
      quality: args.sync_state.revisions.quality,
      proofreading: args.sync_state.revisions.proofreading,
    },
    row_count: args.window.row_count,
    window_start: args.window.start,
    window_rows: args.window.rows,
  };
}

// 识别后端旧 view 失效时返回的空窗口，触发完整重建。
function is_missing_refreshed_list_window(args: {
  previous_view: ProofreadingListView;
  window: ProofreadingListWindow;
}): boolean {
  return (
    args.previous_view.row_count > 0 && args.window.row_count === 0 && args.window.rows.length === 0
  );
}

/**
 * 构建当前场景的稳定结果。
 */
function build_sort_signature(sort_state: AppTableSortState | null): string {
  return sort_state === null ? "null" : `${sort_state.column_id}:${sort_state.direction}`;
}

/**
 * 构建当前场景的稳定结果。
 */
function build_list_query_signature(args: {
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

// 用 sync revision 和查询参数判断旧 view 是否仍匹配当前 UI。
function build_sync_list_query_signature(args: {
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

/**
 * 构建当前场景的稳定结果。
 */
function build_filter_panel_signature(args: {
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
 * 解析当前场景的最终消费值。
 */
function resolve_requested_sync_mode(args: {
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
 * 解析当前场景的最终消费值。
 */
function resolve_proofreading_refresh_signal(signal: {
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

// SSE 增量里的 item id 可能来自 JSON 对象键或数组值，这里统一成正整数去重列表。
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

export function useProofreadingPageState(): UseProofreadingPageStateResult {
  const { t } = useI18n();
  const { dismiss_toast, push_progress_toast, push_toast } = useDesktopToast();
  const { proofreading_lookup_intent, clear_proofreading_lookup_intent } = useAppNavigation();
  const {
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    sync_task_snapshot,
    project_change_signal,
    commit_project_write,
    refresh_task,
  } = useDesktopState();
  const table_ui_state = useProjectSessionTableUiState<
    ProofreadingViewFilterState,
    AppTableSortState | null
  >({
    key: "proofreading",
    create_default_filter_state: create_empty_proofreading_view_filter_state,
    create_default_sort_state: () => null,
    clone_filter_state: clone_proofreading_view_filter_state,
    normalize_sort_state: normalize_proofreading_sort_state,
  });
  // 保存后端当前默认筛选，current_filters 每次渲染按 session 意图即时展开。
  const defaultFiltersRef = useRef(create_empty_filter_options());
  const current_filters = materialize_proofreading_filters(
    table_ui_state.filter_state.selection,
    defaultFiltersRef.current,
  );
  const search_keyword = table_ui_state.filter_state.search_keyword;
  const search_scope = table_ui_state.filter_state.search_scope;
  const is_regex = table_ui_state.filter_state.is_regex;
  const sort_state = table_ui_state.sort_state;
  const selected_row_ids = table_ui_state.selected_row_ids;
  const active_row_id = table_ui_state.active_row_id;
  const anchor_row_id = table_ui_state.anchor_row_id;
  const restore_scroll_row_id = table_ui_state.restore_scroll_row_id;
  const table_filter_state_ref = table_ui_state.filter_state_ref;
  const table_sort_state_ref = table_ui_state.sort_state_ref;
  const selected_row_ids_ref = table_ui_state.selected_row_ids_ref;
  const active_row_id_ref = table_ui_state.active_row_id_ref;
  const anchor_row_id_ref = table_ui_state.anchor_row_id_ref;
  const set_table_filter_state = table_ui_state.set_filter_state;
  const set_table_sort_state = table_ui_state.set_sort_state;
  const set_table_selection_state = table_ui_state.set_selection_state;
  const clear_table_selection_state = table_ui_state.clear_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
  const [list_view, set_list_view] = useState(() => create_empty_proofreading_list_view());
  const [filter_dialog_filters, set_filter_dialog_filters] = useState<ProofreadingFilterOptions>(
    () => clone_proofreading_filter_options(current_filters),
  );
  const [filter_panel, set_filter_panel] = useState(() => {
    return create_empty_proofreading_filter_panel_state();
  });
  const [filter_panel_loading, set_filter_panel_loading] = useState(false);
  const [is_refreshing, set_is_refreshing] = useState(false);
  const [cache_status, set_cache_status] = useState<"idle" | "refreshing" | "ready" | "error">(
    "idle",
  );
  const [consumed_revisions, set_consumed_revisions] = useState<ProjectDataSectionRevisions>({});
  const [settled_project_path, set_settled_project_path] = useState("");
  const [is_writing, set_is_writing] = useState(false);
  // preserve_scroll_anchor 通知 AppTable 在数据刷新前后保持当前窗口视觉偏移。
  const [preserve_scroll_anchor, set_preserve_scroll_anchor] = useState<AppTableScrollAnchor>({
    row_id: null,
    revision: 0,
  });
  const [replace_text, set_replace_text] = useState("");
  const [filter_dialog_open, set_filter_dialog_open] = useState(false);
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state();
  });
  const refresh_generation_ref = useRef(0);
  const list_view_request_id_ref = useRef(0);
  const list_window_request_id_ref = useRef(0);
  const filter_panel_request_id_ref = useRef(0);
  const filter_dialog_filters_ref = useRef(filter_dialog_filters);
  const sync_state_ref = useRef<ProofreadingSyncState | null>(null);
  const proofreading_runtime_client_ref = useRef(createProofreadingApiClient());
  // 记录 AppTable 最新可见范围，delta 刷新优先复用这个窗口。
  const visible_range_ref = useRef<ProofreadingListWindowBounds | null>(null);
  // 保存当前已预取窗口，首屏刷新时没有可见范围也能复用。
  const list_window_bounds_ref = useRef<ProofreadingListWindowBounds>({
    start: 0,
    count: PROOFREADING_INITIAL_WINDOW_ROWS,
  });
  const preferred_row_id_ref = useRef<string | null>(null);
  const should_select_first_visible_ref = useRef(false);
  const replace_cursor_ref = useRef(0);
  const pending_replace_cursor_ref = useRef<number | null>(null);
  const filter_dialog_open_ref = useRef(filter_dialog_open);
  // 给每次刷新锚点发布单调版本，避免 AppTable 重复消费。
  const preserve_scroll_anchor_revision_ref = useRef(0);
  // 标记项目身份切换后的首轮 sync 需要回到最新默认筛选。
  const pending_reset_filters_ref = useRef(false);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  // 标记本轮进入页面是否来自 session 恢复，决定是否套用默认筛选。
  const restored_ui_state_ref = useRef(table_ui_state.initial_ui_state !== null);
  // 记录当前模态 loading toast，确保刷新结束和卸载时能精确关闭。
  const loading_toast_id_ref = useRef<ReturnType<typeof push_progress_toast> | null>(null);
  const [loading_toast_visible, set_loading_toast_visible] = useState(false);
  // refresh_retry_nonce 用递增信号触发当前过期同步的一次性重试。
  const [refresh_retry_nonce, set_refresh_retry_nonce] = useState(0);
  // 记录已消费的重试信号，避免 effect 因 refresh_snapshot 身份变化重复执行。
  const consumed_refresh_retry_nonce_ref = useRef(0);
  const previous_proofreading_change_seq_ref = useRef(0);
  const proofreading_change_signal = useMemo(
    () => resolve_proofreading_refresh_signal(project_change_signal),
    [project_change_signal],
  );
  // 去重等价列表 query，并在 delta 复用旧 view 时校验查询身份。
  const last_list_query_signature_ref = useRef("");
  // 避免同一 revision 和筛选参数重复请求筛选面板。
  const last_filter_panel_signature_ref = useRef("");
  // 避免虚拟列表重复读取同一预取窗口。
  const last_visible_range_signature_ref = useRef("");
  // 给异步刷新路径读取最新 view，避免闭包里的旧 state 覆盖新列表。
  const list_view_ref = useRef(list_view);
  const [dialog_item_snapshot, set_dialog_item_snapshot] = useState<ProofreadingItem | null>(null);

  // reader identity 只来自 Backend query reader/state 同步结果。
  const resolve_disposable_project_id = useCallback((): string | null => {
    return sync_state_ref.current?.projectId ?? null;
  }, []);

  useEffect(() => {
    const proofreading_runtime_client = proofreading_runtime_client_ref.current;
    return () => {
      list_view_request_id_ref.current += 1;
      list_window_request_id_ref.current += 1;
      filter_panel_request_id_ref.current += 1;
      const project_id = resolve_disposable_project_id();
      if (project_id !== null) {
        void proofreading_runtime_client.dispose_project(project_id);
      }
    };
  }, [resolve_disposable_project_id]);

  useEffect(() => {
    filter_dialog_filters_ref.current = filter_dialog_filters;
  }, [filter_dialog_filters]);

  useEffect(() => {
    filter_dialog_open_ref.current = filter_dialog_open;
  }, [filter_dialog_open]);

  useEffect(() => {
    list_view_ref.current = list_view;
    list_window_bounds_ref.current = resolve_list_view_window_bounds(list_view);
  }, [list_view]);

  const visible_items = list_view.window_rows;
  const visible_row_ids = useMemo(() => {
    return visible_items.map((item) => item.row_id);
  }, [visible_items]);
  const visible_row_index_by_id = useMemo(() => {
    return new Map(
      visible_items.map((item, index) => {
        return [item.row_id, list_view.window_start + index] as const;
      }),
    );
  }, [list_view.window_start, visible_items]);
  const visible_item_by_id = useMemo(() => {
    return new Map(
      visible_items.map((item) => {
        return [item.row_id, item.item] as const;
      }),
    );
  }, [visible_items]);
  const dialog_item =
    dialog_state.target_row_id === null
      ? null
      : (visible_item_by_id.get(dialog_state.target_row_id) ?? dialog_item_snapshot);
  const readonly = task_snapshot.busy;
  const retranslating_row_ids = useMemo(() => {
    if (
      task_snapshot.task_type !== "translation" ||
      task_snapshot.extras.kind !== "translation" ||
      task_snapshot.extras.scope.kind !== "items"
    ) {
      return [];
    }

    return task_snapshot.extras.scope.item_ids.map((item_id) => {
      return build_proofreading_row_id(item_id);
    });
  }, [task_snapshot.extras, task_snapshot.task_type]);
  const invalid_regex_message =
    list_view.invalid_regex_message === null
      ? null
      : `${t("proofreading_page.feedback.regex_invalid")}: ${list_view.invalid_regex_message}`;
  const current_filter_signature = useMemo(() => {
    return build_filter_signature(current_filters);
  }, [current_filters]);
  const sort_signature = useMemo(() => {
    return build_sort_signature(sort_state);
  }, [sort_state]);

  const handle_api_error = useCallback(
    (error: unknown, fallback_message: string): void => {
      const message = resolve_visible_error_message(error, t, fallback_message);
      push_toast("error", message);
    },
    [push_toast, t],
  );

  const report_proofreading_list_error = useCallback(
    (error: unknown, fallback_message: string): boolean => {
      const message = resolve_visible_error_message(error, t, fallback_message);
      push_toast("error", message);
      return true;
    },
    [push_toast, t],
  );

  const update_table_filter_state = useCallback(
    (patch: Partial<ProofreadingViewFilterState>, options?: { persist?: boolean }): void => {
      const previous_filter_state = table_filter_state_ref.current;
      set_table_filter_state(
        create_proofreading_view_filter_state({
          selection: patch.selection ?? previous_filter_state.selection,
          search_keyword: patch.search_keyword ?? previous_filter_state.search_keyword,
          search_scope: patch.search_scope ?? previous_filter_state.search_scope,
          is_regex: patch.is_regex ?? previous_filter_state.is_regex,
        }),
        options,
      );
    },
    [set_table_filter_state, table_filter_state_ref],
  );

  const resolve_current_filters = useCallback((): ProofreadingFilterOptions => {
    return materialize_proofreading_filters(
      table_filter_state_ref.current.selection,
      defaultFiltersRef.current,
    );
  }, [table_filter_state_ref]);

  const resolve_refresh_scroll_anchor_row_id = useCallback((): string | null => {
    const window_row_ids = new Set(list_view_ref.current.window_rows.map((row) => row.row_id));
    const active_row_id = active_row_id_ref.current;
    if (active_row_id !== null && window_row_ids.has(active_row_id)) {
      return active_row_id;
    }

    const selected_row_id = selected_row_ids_ref.current.find((row_id) => {
      return window_row_ids.has(row_id);
    });
    return selected_row_id ?? list_view_ref.current.window_rows[0]?.row_id ?? null;
  }, [active_row_id_ref, selected_row_ids_ref]);

  const publish_refresh_scroll_anchor = useCallback((): void => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    set_preserve_scroll_anchor({
      row_id: resolve_refresh_scroll_anchor_row_id(),
      revision: next_revision,
    });
  }, [resolve_refresh_scroll_anchor_row_id]);

  const clear_refresh_scroll_anchor = useCallback((): void => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    set_preserve_scroll_anchor({
      row_id: null,
      revision: next_revision,
    });
  }, []);

  const apply_preferred_row_focus = useCallback(
    (preferred_row_id: string): void => {
      const current_selected_row_ids = selected_row_ids_ref.current;
      if (
        current_selected_row_ids.length > 1 &&
        current_selected_row_ids.includes(preferred_row_id)
      ) {
        const current_anchor_row_id = anchor_row_id_ref.current;
        set_table_selection_state({
          selected_row_ids: current_selected_row_ids,
          active_row_id: preferred_row_id,
          anchor_row_id:
            current_anchor_row_id !== null &&
            current_selected_row_ids.includes(current_anchor_row_id)
              ? current_anchor_row_id
              : (current_selected_row_ids[0] ?? preferred_row_id),
        });
        return;
      }

      set_table_selection_state({
        selected_row_ids: [preferred_row_id],
        active_row_id: preferred_row_id,
        anchor_row_id: preferred_row_id,
      });
    },
    [anchor_row_id_ref, selected_row_ids_ref, set_table_selection_state],
  );
  const run_project_write = useCallback(
    async (args: {
      path: string;
      plan: ProofreadingCommandPlan | null;
      fallback_error_key:
        | "proofreading_page.feedback.save_failed"
        | "proofreading_page.feedback.replace_failed"
        | "proofreading_page.feedback.clear_translation_failed"
        | "proofreading_page.feedback.set_status_failed";
      preferred_row_id?: string | null;
      pending_replace_cursor?: number | null;
      success_message_builder?: ((changed_count: number) => string) | null;
      empty_warning_message?: string | null;
      close_dialog?: boolean;
    }): Promise<void> => {
      if (args.plan === null || args.plan.changed_item_ids.length === 0) {
        if (args.empty_warning_message !== null && args.empty_warning_message !== undefined) {
          push_toast("warning", args.empty_warning_message);
        }
        return;
      }
      const write_plan = args.plan;

      if (args.pending_replace_cursor !== undefined) {
        pending_replace_cursor_ref.current = args.pending_replace_cursor;
      }
      preferred_row_id_ref.current = args.preferred_row_id ?? active_row_id_ref.current;

      set_is_writing(true);

      try {
        await commit_project_write({
          operation: PROOFREADING_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>(args.path, write_plan.request_body);
          },
        });
        await refresh_task();

        if (args.success_message_builder !== null && args.success_message_builder !== undefined) {
          push_toast("success", args.success_message_builder(write_plan.changed_item_ids.length));
        }

        if (args.close_dialog) {
          set_dialog_state(create_empty_dialog_state());
          set_dialog_item_snapshot(null);
        }
      } catch (error) {
        handle_api_error(error, t(args.fallback_error_key));
      } finally {
        set_is_writing(false);
      }
    },
    [commit_project_write, handle_api_error, push_toast, refresh_task, t],
  );

  const request_close_dialog = useCallback((): void => {
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
  }, []);

  const resolve_preferred_row_id = useCallback(
    (preferred_row_id?: string | null): string | null => {
      return preferred_row_id ?? active_row_id_ref.current;
    },
    [],
  );

  const remember_preferred_row_id = useCallback((preferred_row_id: string | null): void => {
    preferred_row_id_ref.current = preferred_row_id;
  }, []);

  const read_items_by_row_ids_ref = useRef(
    async (_row_ids: string[]): Promise<ProofreadingClientItem[]> => [],
  );
  const read_items_by_row_ids_for_batch = useCallback(
    async (row_ids: string[]): Promise<ProofreadingClientItem[]> => {
      return await read_items_by_row_ids_ref.current(row_ids);
    },
    [],
  );

  const {
    pending_confirmation,
    request_retranslate_row_ids,
    request_clear_translation_row_ids,
    request_set_translation_status_row_ids,
    confirm_pending_confirmation,
    close_pending_confirmation,
    clear_pending_confirmation,
  } = useProofreadingBatchActions({
    readonly,
    is_refreshing,
    is_writing,
    dialog_open: dialog_state.open,
    section_revisions: consumed_revisions,
    read_items_by_row_ids: read_items_by_row_ids_for_batch,
    task_snapshot,
    proofreading_revision: list_view.revisions.proofreading,
    sync_task_snapshot,
    run_project_write,
    set_is_writing,
    resolve_preferred_row_id,
    remember_preferred_row_id,
    close_edit_dialog: request_close_dialog,
    handle_api_error,
    t,
  });

  // 主搜索和筛选面板共用输入防抖；确认、刷新等显式路径会 cancel 后即时查询。
  const search_list_view_query_scheduler = useDebouncedCallback(
    (args: ProofreadingListQueryInput): void => {
      void run_list_view_query(args).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    INPUT_QUERY_DEBOUNCE_MS,
  );

  const filter_panel_query_scheduler = useDebouncedCallback(
    (filters: ProofreadingFilterOptions): void => {
      void run_filter_panel_query(filters, {
        mark_loading: true,
      }).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    INPUT_QUERY_DEBOUNCE_MS,
  );

  const cancel_pending_list_view_query = useCallback((): void => {
    search_list_view_query_scheduler.cancel();
  }, [search_list_view_query_scheduler]);

  const cancel_pending_cache_bound_queries = useCallback((): void => {
    search_list_view_query_scheduler.cancel();
    filter_panel_query_scheduler.cancel();
  }, [filter_panel_query_scheduler, search_list_view_query_scheduler]);

  const invalidate_list_view_requests = useCallback((): void => {
    list_view_request_id_ref.current += 1;
    list_window_request_id_ref.current += 1;
    last_visible_range_signature_ref.current = "";
  }, []);

  const invalidate_filter_panel_requests = useCallback((): void => {
    filter_panel_request_id_ref.current += 1;
  }, []);

  const invalidate_cache_bound_queries = useCallback((): void => {
    // cache 身份切换时，所有依赖 sync_state_ref 的待发布/在途查询都必须失效。
    cancel_pending_cache_bound_queries();
    invalidate_list_view_requests();
    invalidate_filter_panel_requests();
    last_list_query_signature_ref.current = "";
    last_filter_panel_signature_ref.current = "";
  }, [
    cancel_pending_cache_bound_queries,
    invalidate_filter_panel_requests,
    invalidate_list_view_requests,
  ]);

  const clear_table_selection = useCallback((): void => {
    clear_table_selection_state();
  }, [clear_table_selection_state]);

  const clear_transient_state_for_new_project = useCallback((): void => {
    clear_pending_confirmation();
    const empty_dialog_filters = create_empty_filter_options();
    reset_table_state({ persist: false });
    set_filter_dialog_filters(empty_dialog_filters);
    filter_dialog_filters_ref.current = empty_dialog_filters;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_consumed_revisions({});
    set_settled_project_path("");
    set_replace_text("");
    set_filter_dialog_open(false);
    filter_dialog_open_ref.current = false;
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
    replace_cursor_ref.current = 0;
    pending_replace_cursor_ref.current = null;
    preferred_row_id_ref.current = null;
    should_select_first_visible_ref.current = false;
    clear_refresh_scroll_anchor();
    pending_reset_filters_ref.current = false;
  }, [clear_pending_confirmation, clear_refresh_scroll_anchor, reset_table_state]);

  const clear_cache_state = useCallback((): void => {
    clear_pending_confirmation();
    refresh_generation_ref.current += 1;
    invalidate_cache_bound_queries();
    const currentProjectId = resolve_disposable_project_id();
    sync_state_ref.current = null;
    defaultFiltersRef.current = create_empty_filter_options();
    visible_range_ref.current = null;
    list_window_bounds_ref.current = {
      start: 0,
      count: PROOFREADING_INITIAL_WINDOW_ROWS,
    };
    clear_refresh_scroll_anchor();
    const empty_list_view = create_empty_proofreading_list_view();
    set_list_view(empty_list_view);
    list_view_ref.current = empty_list_view;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_is_refreshing(false);
    set_cache_status("idle");
    set_is_writing(false);
    if (currentProjectId !== null) {
      void proofreading_runtime_client_ref.current.dispose_project(currentProjectId);
    }
  }, [
    clear_pending_confirmation,
    clear_refresh_scroll_anchor,
    invalidate_cache_bound_queries,
    resolve_disposable_project_id,
  ]);

  const run_list_view_query = useCallback(
    async (
      args: ProofreadingListQueryInput,
      options?: {
        force?: boolean;
        stale_key?: string | null;
        window_bounds?: ProofreadingListWindowBounds;
      },
    ) => {
      const sync_state = sync_state_ref.current;
      if (sync_state === null) {
        return null;
      }

      const query_signature = build_list_query_signature({
        revisions: sync_state.revisions,
        filters: args.filters,
        keyword: args.keyword,
        scope: args.scope,
        is_regex: args.is_regex,
        sort_state: args.sort_state,
      });
      if (!options?.force && query_signature === last_list_query_signature_ref.current) {
        return list_view;
      }

      list_view_request_id_ref.current += 1;
      const request_id = list_view_request_id_ref.current;
      let next_list_view: ProofreadingListView;
      try {
        const list_view_query = {
          filters: args.filters,
          keyword: args.keyword,
          scope: args.scope,
          is_regex: args.is_regex,
          sort_state: args.sort_state,
          window_start: options?.window_bounds?.start ?? 0,
          window_count: options?.window_bounds?.count ?? PROOFREADING_INITIAL_WINDOW_ROWS,
        };
        next_list_view =
          options?.stale_key === undefined
            ? await proofreading_runtime_client_ref.current.build_proofreading_list_view(
                list_view_query,
              )
            : await proofreading_runtime_client_ref.current.build_proofreading_list_view(
                list_view_query,
                {
                  staleKey: options.stale_key,
                },
              );
      } catch (error) {
        if (
          request_id !== list_view_request_id_ref.current ||
          is_stale_proofreading_list_error(error)
        ) {
          return null;
        }

        throw error;
      }
      if (request_id !== list_view_request_id_ref.current) {
        return null;
      }

      last_list_query_signature_ref.current = query_signature;
      list_view_ref.current = next_list_view;
      list_window_bounds_ref.current = resolve_list_view_window_bounds(next_list_view);
      startTransition(() => {
        set_list_view(next_list_view);
      });
      return next_list_view;
    },
    [list_view],
  );

  const run_filter_panel_query = useCallback(
    async (
      filters: ProofreadingFilterOptions,
      options?: {
        force?: boolean;
        mark_loading?: boolean;
      },
    ) => {
      const sync_state = sync_state_ref.current;
      if (sync_state === null) {
        return null;
      }

      const query_signature = build_filter_panel_signature({
        revisions: sync_state.revisions,
        filters,
      });
      if (!options?.force && query_signature === last_filter_panel_signature_ref.current) {
        return filter_panel;
      }

      filter_panel_request_id_ref.current += 1;
      const request_id = filter_panel_request_id_ref.current;
      if (options?.mark_loading !== false) {
        set_filter_panel_loading(true);
      }

      try {
        let next_filter_panel: ProofreadingFilterPanelState;
        try {
          next_filter_panel =
            await proofreading_runtime_client_ref.current.build_proofreading_filter_panel({
              filters,
            });
        } catch (error) {
          if (
            request_id !== filter_panel_request_id_ref.current ||
            is_stale_proofreading_list_error(error)
          ) {
            return null;
          }

          throw error;
        }
        if (request_id !== filter_panel_request_id_ref.current) {
          return null;
        }

        last_filter_panel_signature_ref.current = query_signature;
        startTransition(() => {
          set_filter_panel(next_filter_panel);
        });
        return next_filter_panel;
      } finally {
        if (request_id === filter_panel_request_id_ref.current) {
          set_filter_panel_loading(false);
        }
      }
    },
    [filter_panel],
  );

  const schedule_search_list_view_query = useCallback(
    (args: ProofreadingListQueryInput): void => {
      cancel_pending_list_view_query();
      invalidate_list_view_requests();
      search_list_view_query_scheduler.schedule(args);
    },
    [
      cancel_pending_list_view_query,
      invalidate_list_view_requests,
      search_list_view_query_scheduler,
    ],
  );

  const warm_filter_panel_query = useCallback(
    (filters: ProofreadingFilterOptions): void => {
      void run_filter_panel_query(filters, {
        force: true,
        mark_loading: false,
      }).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    [report_proofreading_list_error, run_filter_panel_query, t],
  );

  const read_list_window = useCallback(
    async (range: { start: number; count: number }): Promise<ProofreadingListWindow | null> => {
      if (list_view.view_id === "" || list_view.row_count <= 0 || range.count <= 0) {
        return null;
      }

      const window_bounds = resolve_prefetched_list_window_bounds({
        range,
        row_count: list_view.row_count,
      });
      const range_signature = `${list_view.view_id}:${window_bounds.start}:${window_bounds.count}`;
      if (range_signature === last_visible_range_signature_ref.current) {
        return null;
      }

      last_visible_range_signature_ref.current = range_signature;
      list_window_request_id_ref.current += 1;
      const request_id = list_window_request_id_ref.current;
      let next_window: ProofreadingListWindow;
      try {
        next_window = await proofreading_runtime_client_ref.current.read_proofreading_list_window({
          view_id: list_view.view_id,
          start: window_bounds.start,
          count: window_bounds.count,
        });
      } catch (error) {
        if (is_stale_proofreading_list_error(error)) {
          if (request_id === list_window_request_id_ref.current) {
            last_visible_range_signature_ref.current = "";
          }
          return null;
        }

        if (request_id !== list_window_request_id_ref.current) {
          return null;
        }

        last_visible_range_signature_ref.current = "";
        throw error;
      }
      if (request_id !== list_window_request_id_ref.current) {
        return null;
      }

      if (next_window.view_id !== list_view.view_id) {
        return null;
      }

      list_view_ref.current = {
        ...list_view_ref.current,
        row_count: next_window.row_count,
        window_start: next_window.start,
        window_rows: next_window.rows,
      };
      startTransition(() => {
        set_list_view((previous_view) => {
          if (previous_view.view_id !== next_window.view_id) {
            return previous_view;
          }

          return {
            ...previous_view,
            row_count: next_window.row_count,
            window_start: next_window.start,
            window_rows: next_window.rows,
          };
        });
      });
      list_window_bounds_ref.current = {
        start: next_window.start,
        count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, next_window.rows.length),
      };
      return next_window;
    },
    [list_view.row_count, list_view.view_id],
  );

  const settle_list_view_and_filter_panel = useCallback(
    async (args: {
      filters: ProofreadingFilterOptions;
      keyword: string;
      scope: ProofreadingSearchScope;
      is_regex: boolean;
      sort_state: AppTableSortState | null;
      force?: boolean;
    }) => {
      const [next_list_view, next_filter_panel] = await Promise.all([
        run_list_view_query(
          {
            filters: args.filters,
            keyword: args.keyword,
            scope: args.scope,
            is_regex: args.is_regex,
            sort_state: args.sort_state,
          },
          {
            force: args.force,
          },
        ),
        run_filter_panel_query(args.filters, {
          force: args.force,
          mark_loading: false,
        }),
      ]);

      return next_list_view !== null && next_filter_panel !== null;
    },
    [run_filter_panel_query, run_list_view_query],
  );

  const read_items_by_row_ids = useCallback(
    async (row_ids: string[]): Promise<ProofreadingClientItem[]> => {
      if (row_ids.length === 0) {
        return [];
      }

      const items_by_row_id = new Map(
        visible_items.map((visible_item) => {
          return [visible_item.row_id, visible_item.item] as const;
        }),
      );
      const missing_row_ids = row_ids.filter((row_id) => {
        return !items_by_row_id.has(row_id);
      });
      if (missing_row_ids.length > 0) {
        const fetched_items =
          await proofreading_runtime_client_ref.current.read_proofreading_items_by_row_ids({
            row_ids: missing_row_ids,
          });
        fetched_items.forEach((item) => {
          items_by_row_id.set(item.row_id, item);
        });
      }

      return row_ids.flatMap((row_id) => {
        const item = items_by_row_id.get(row_id);
        return item === undefined ? [] : [item];
      });
    },
    [visible_items],
  );
  read_items_by_row_ids_ref.current = read_items_by_row_ids;

  const read_current_view_row_ids = useCallback(
    async (start: number, count: number): Promise<string[]> => {
      if (list_view.view_id === "" || count <= 0) {
        return [];
      }

      return await proofreading_runtime_client_ref.current.read_proofreading_row_ids_range({
        view_id: list_view.view_id,
        start,
        count,
      });
    },
    [list_view.view_id],
  );

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_transient_state_for_new_project();
      clear_cache_state();
      return;
    }

    const request_id = refresh_generation_ref.current + 1;
    refresh_generation_ref.current = request_id;
    let retry_after_stale = false;

    try {
      const previous_sync_state = sync_state_ref.current;
      const sync_mode = resolve_requested_sync_mode({
        cache_status,
        sync_state: previous_sync_state,
        project_path: project_snapshot.path,
        sourceLanguage: settings_snapshot.source_language,
        targetLanguage: settings_snapshot.target_language,
        signal_mode: proofreading_change_signal?.mode ?? "full",
      });
      let sync_state = previous_sync_state;
      if (sync_mode === "noop") {
        if (request_id !== refresh_generation_ref.current || sync_state === null) {
          return;
        }

        set_cache_status("ready");
        set_is_refreshing(false);
        set_settled_project_path(project_snapshot.path);
        return;
      }
      const previous_list_view = list_view_ref.current;
      const previous_current_filters = resolve_current_filters();
      const previous_list_query: ProofreadingListQueryInput = {
        filters: previous_current_filters,
        keyword: table_filter_state_ref.current.search_keyword,
        scope: table_filter_state_ref.current.search_scope,
        is_regex: table_filter_state_ref.current.is_regex,
        sort_state: table_sort_state_ref.current,
      };
      const previous_list_query_signature =
        previous_sync_state === null
          ? ""
          : build_sync_list_query_signature({
              sync_state: previous_sync_state,
              query: previous_list_query,
            });
      const previous_query_matches_current_state =
        previous_sync_state !== null &&
        previous_list_query_signature === last_list_query_signature_ref.current;
      const can_reuse_current_view_base =
        sync_mode === "delta" &&
        cache_status === "ready" &&
        previous_sync_state !== null &&
        previous_sync_state.projectId === project_snapshot.path &&
        previous_sync_state.sourceLanguage === settings_snapshot.source_language &&
        previous_sync_state.targetLanguage === settings_snapshot.target_language &&
        previous_list_view.view_id !== "";

      // 离开 ready 前先终止旧 cache 查询，避免防抖回调在刷新窗口读取旧 state。
      invalidate_cache_bound_queries();
      if (sync_mode === "full") {
        set_filter_panel_loading(false);
        set_filter_dialog_open(false);
        filter_dialog_open_ref.current = false;
      }
      set_is_refreshing(true);
      set_cache_status("refreshing");
      set_loading_toast_visible(sync_mode === "full");

      if (sync_mode === "full") {
        sync_state_ref.current = null;
      }
      sync_state = await proofreading_runtime_client_ref.current.sync_proofreading_cache({
        sourceLanguage: settings_snapshot.source_language,
        targetLanguage: settings_snapshot.target_language,
      });

      if (request_id !== refresh_generation_ref.current || sync_state === null) {
        return;
      }

      const nextDefaultFilters = clone_proofreading_filter_options(sync_state.defaultFilters);
      const next_filter_selection = pending_reset_filters_ref.current
        ? create_default_proofreading_filter_selection(nextDefaultFilters)
        : clone_proofreading_filter_selection(table_filter_state_ref.current.selection);
      const next_current_filters = materialize_proofreading_filters(
        next_filter_selection,
        nextDefaultFilters,
      );
      const next_list_query: ProofreadingListQueryInput = {
        filters: next_current_filters,
        keyword: table_filter_state_ref.current.search_keyword,
        scope: table_filter_state_ref.current.search_scope,
        is_regex: table_filter_state_ref.current.is_regex,
        sort_state: table_sort_state_ref.current,
      };
      const current_query_matches_previous_view =
        previous_sync_state !== null &&
        build_sync_list_query_signature({
          sync_state: previous_sync_state,
          query: next_list_query,
        }) === previous_list_query_signature;
      const can_reuse_current_view =
        can_reuse_current_view_base &&
        previous_query_matches_current_state &&
        current_query_matches_previous_view;
      const refresh_window_bounds = can_reuse_current_view
        ? visible_range_ref.current === null
          ? list_window_bounds_ref.current
          : resolve_prefetched_list_window_bounds({
              range: visible_range_ref.current,
              row_count: list_view_ref.current.row_count,
            })
        : undefined;
      if (can_reuse_current_view) {
        publish_refresh_scroll_anchor();
      }

      sync_state_ref.current = sync_state;
      defaultFiltersRef.current = clone_proofreading_filter_options(nextDefaultFilters);
      update_table_filter_state(
        {
          selection: next_filter_selection,
        },
        {
          persist: false,
        },
      );
      if (sync_mode !== "delta" || !filter_dialog_open_ref.current) {
        const next_dialog_filters = clone_proofreading_filter_options(next_current_filters);
        set_filter_dialog_filters(next_dialog_filters);
        filter_dialog_filters_ref.current = next_dialog_filters;
      }

      let next_list_view: ProofreadingListView | null = null;
      let should_build_list_view = true;
      if (can_reuse_current_view && refresh_window_bounds !== undefined) {
        const next_window =
          await proofreading_runtime_client_ref.current.read_proofreading_list_window({
            view_id: previous_list_view.view_id,
            start: refresh_window_bounds.start,
            count: refresh_window_bounds.count,
          });
        if (request_id !== refresh_generation_ref.current) {
          return;
        }

        if (
          next_window.view_id === previous_list_view.view_id &&
          list_view_ref.current.view_id === previous_list_view.view_id &&
          !is_missing_refreshed_list_window({
            previous_view: previous_list_view,
            window: next_window,
          })
        ) {
          next_list_view = build_refreshed_proofreading_list_view({
            previous_view: previous_list_view,
            sync_state,
            window: next_window,
          });
          last_list_query_signature_ref.current = build_sync_list_query_signature({
            sync_state,
            query: next_list_query,
          });
          list_view_ref.current = next_list_view;
          list_window_bounds_ref.current = {
            start: next_window.start,
            count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, next_window.rows.length),
          };
          last_visible_range_signature_ref.current = `${next_window.view_id}:${refresh_window_bounds.start}:${refresh_window_bounds.count}`;
          startTransition(() => {
            set_list_view((current_view) => {
              return current_view.view_id === previous_list_view.view_id
                ? (next_list_view ?? current_view)
                : current_view;
            });
          });
          should_build_list_view = false;
        }
      }
      if (should_build_list_view) {
        next_list_view = await run_list_view_query(next_list_query, {
          force: true,
          stale_key: null,
          window_bounds: can_reuse_current_view ? refresh_window_bounds : undefined,
        });
      }
      if (request_id !== refresh_generation_ref.current) {
        return;
      }

      if (next_list_view !== null) {
        warm_filter_panel_query(next_current_filters);
      }
      set_cache_status("ready");
      set_consumed_revisions(sync_state.revisions);
      set_settled_project_path(project_snapshot.path);
    } catch (error) {
      if (request_id !== refresh_generation_ref.current) {
        return;
      }

      if (is_stale_proofreading_list_error(error)) {
        // 当前项目仍加载时，stale 表示列表缓存被释放路径废弃，需要保留刷新态并立即重试。
        retry_after_stale = project_snapshot.loaded;
        if (retry_after_stale) {
          set_refresh_retry_nonce((previous_nonce) => previous_nonce + 1);
        }
        return;
      }

      const reported = report_proofreading_list_error(
        error,
        t("proofreading_page.feedback.refresh_failed"),
      );
      if (!reported) {
        return;
      }

      set_cache_status("error");
      set_settled_project_path(project_snapshot.path);
    } finally {
      // stale 重试期间不能清掉 pending_reset_filters_ref，否则首刷默认筛选会丢失。
      if (!retry_after_stale) {
        pending_reset_filters_ref.current = false;
      }
      if (request_id === refresh_generation_ref.current) {
        // stale 重试期间保持模态和刷新态，让用户看到同一轮加载仍在继续。
        if (!retry_after_stale) {
          set_loading_toast_visible(false);
          set_is_refreshing(false);
        }
      }
    }
  }, [
    cache_status,
    clear_cache_state,
    clear_transient_state_for_new_project,
    invalidate_cache_bound_queries,
    project_snapshot.loaded,
    project_snapshot.path,
    proofreading_change_signal,
    publish_refresh_scroll_anchor,
    resolve_current_filters,
    run_list_view_query,
    report_proofreading_list_error,
    settings_snapshot.source_language,
    settings_snapshot.target_language,
    table_filter_state_ref,
    table_sort_state_ref,
    t,
    update_table_filter_state,
    warm_filter_panel_query,
  ]);

  // refresh_retry_nonce effect 负责把 catch 分支里的重试信号接回刷新主链路。
  useEffect(() => {
    if (
      refresh_retry_nonce === 0 ||
      refresh_retry_nonce === consumed_refresh_retry_nonce_ref.current ||
      !project_snapshot.loaded
    ) {
      return;
    }

    consumed_refresh_retry_nonce_ref.current = refresh_retry_nonce;
    void refresh_snapshot();
  }, [project_snapshot.loaded, refresh_retry_nonce, refresh_snapshot]);

  const update_search_keyword = useCallback(
    (next_keyword: string): void => {
      should_select_first_visible_ref.current = false;
      visible_range_ref.current = null;
      update_table_filter_state({
        search_keyword: next_keyword,
      });
      clear_table_selection();
      schedule_search_list_view_query({
        filters: resolve_current_filters(),
        keyword: next_keyword,
        scope: table_filter_state_ref.current.search_scope,
        is_regex: table_filter_state_ref.current.is_regex,
        sort_state: table_sort_state_ref.current,
      });
    },
    [
      clear_table_selection,
      resolve_current_filters,
      schedule_search_list_view_query,
      table_filter_state_ref,
      table_sort_state_ref,
      update_table_filter_state,
    ],
  );

  const update_replace_text = useCallback((next_replace_text: string): void => {
    set_replace_text(next_replace_text);
  }, []);

  const update_search_scope = useCallback(
    (next_scope: ProofreadingSearchScope): void => {
      cancel_pending_list_view_query();
      should_select_first_visible_ref.current = false;
      visible_range_ref.current = null;
      update_table_filter_state({
        search_scope: next_scope,
      });
      clear_table_selection();
      void run_list_view_query(
        {
          filters: resolve_current_filters(),
          keyword: table_filter_state_ref.current.search_keyword,
          scope: next_scope,
          is_regex: table_filter_state_ref.current.is_regex,
          sort_state: table_sort_state_ref.current,
        },
        {
          force: true,
        },
      ).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    [
      cancel_pending_list_view_query,
      clear_table_selection,
      report_proofreading_list_error,
      resolve_current_filters,
      run_list_view_query,
      table_filter_state_ref,
      table_sort_state_ref,
      t,
      update_table_filter_state,
    ],
  );

  const update_regex = useCallback(
    (next_is_regex: boolean): void => {
      cancel_pending_list_view_query();
      should_select_first_visible_ref.current = false;
      visible_range_ref.current = null;
      update_table_filter_state({
        is_regex: next_is_regex,
      });
      clear_table_selection();
      void run_list_view_query(
        {
          filters: resolve_current_filters(),
          keyword: table_filter_state_ref.current.search_keyword,
          scope: table_filter_state_ref.current.search_scope,
          is_regex: next_is_regex,
          sort_state: table_sort_state_ref.current,
        },
        {
          force: true,
        },
      ).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    [
      cancel_pending_list_view_query,
      clear_table_selection,
      report_proofreading_list_error,
      resolve_current_filters,
      run_list_view_query,
      table_filter_state_ref,
      table_sort_state_ref,
      t,
      update_table_filter_state,
    ],
  );

  const apply_table_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      set_table_selection_state({
        selected_row_ids: payload.selected_row_ids,
        active_row_id: payload.active_row_id,
        anchor_row_id: payload.anchor_row_id,
      });
    },
    [set_table_selection_state],
  );

  const apply_table_sort_state = useCallback(
    (next_sort_state: AppTableSortState | null): void => {
      cancel_pending_list_view_query();
      visible_range_ref.current = null;
      set_table_sort_state(next_sort_state);
      clear_table_selection();
      void run_list_view_query(
        {
          filters: resolve_current_filters(),
          keyword: table_filter_state_ref.current.search_keyword,
          scope: table_filter_state_ref.current.search_scope,
          is_regex: table_filter_state_ref.current.is_regex,
          sort_state: next_sort_state,
        },
        {
          force: true,
        },
      ).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    [
      cancel_pending_list_view_query,
      clear_table_selection,
      report_proofreading_list_error,
      resolve_current_filters,
      run_list_view_query,
      set_table_sort_state,
      table_filter_state_ref,
      t,
    ],
  );

  const get_visible_row_at_index = useCallback(
    (index: number): ProofreadingVisibleItem | undefined => {
      const window_index = index - list_view.window_start;
      if (window_index < 0 || window_index >= visible_items.length) {
        return undefined;
      }

      return visible_items[window_index];
    },
    [list_view.window_start, visible_items],
  );

  const get_visible_row_id_at_index = useCallback(
    (index: number): string | undefined => {
      return get_visible_row_at_index(index)?.row_id;
    },
    [get_visible_row_at_index],
  );

  const resolve_visible_row_index = useCallback(
    (row_id: string): number | undefined => {
      return visible_row_index_by_id.get(row_id);
    },
    [visible_row_index_by_id],
  );

  const resolve_visible_row_index_async = useCallback(
    async (row_id: string): Promise<number | undefined> => {
      // 已加载窗口优先本地命中，未加载行才请求当前视图缓存。
      const visible_row_index = visible_row_index_by_id.get(row_id);
      if (visible_row_index !== undefined) {
        return visible_row_index;
      }

      if (list_view.view_id === "" || list_view.row_count <= 0) {
        return undefined;
      }

      return await proofreading_runtime_client_ref.current.resolve_proofreading_row_index({
        view_id: list_view.view_id,
        row_id,
      });
    },
    [list_view.row_count, list_view.view_id, visible_row_index_by_id],
  );

  const read_visible_range = useCallback(
    (range: { start: number; count: number }): void => {
      visible_range_ref.current = {
        start: range.start,
        count: range.count,
      };
      void read_list_window(range).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    [read_list_window, report_proofreading_list_error, t],
  );

  const resolve_visible_row_ids_range = useCallback(
    async (range: { start: number; count: number }): Promise<string[]> => {
      return await read_current_view_row_ids(range.start, range.count);
    },
    [read_current_view_row_ids],
  );

  const handle_table_selection_error = useCallback(
    (error: unknown): void => {
      report_proofreading_list_error(error, t("proofreading_page.feedback.selection_failed"));
    },
    [report_proofreading_list_error, t],
  );

  const open_filter_dialog = useCallback((): void => {
    if (cache_status !== "ready" || is_refreshing) {
      set_filter_dialog_open(false);
      filter_dialog_open_ref.current = false;
      return;
    }

    const next_dialog_filters = resolve_current_filters();
    set_filter_dialog_filters(next_dialog_filters);
    filter_dialog_filters_ref.current = next_dialog_filters;
    set_filter_dialog_open(true);
    filter_dialog_open_ref.current = true;
  }, [cache_status, is_refreshing, resolve_current_filters]);

  const close_filter_dialog = useCallback((): void => {
    filter_panel_query_scheduler.cancel();
    set_filter_dialog_open(false);
    filter_dialog_open_ref.current = false;
    const restored_filters = resolve_current_filters();
    set_filter_dialog_filters(restored_filters);
    filter_dialog_filters_ref.current = restored_filters;
    void run_filter_panel_query(restored_filters, {
      force: true,
      mark_loading: false,
    }).catch((error) => {
      report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
    });
  }, [
    filter_panel_query_scheduler,
    report_proofreading_list_error,
    resolve_current_filters,
    run_filter_panel_query,
    t,
  ]);

  const update_filter_dialog_filters = useCallback(
    (next_filters: ProofreadingFilterOptions): void => {
      const cloned_filters = clone_proofreading_filter_options(next_filters);
      set_filter_dialog_filters(cloned_filters);
      filter_dialog_filters_ref.current = cloned_filters;

      if (filter_dialog_open && cache_status === "ready" && sync_state_ref.current !== null) {
        filter_panel_query_scheduler.schedule(cloned_filters);
      }
    },
    [cache_status, filter_dialog_open, filter_panel_query_scheduler],
  );

  const confirm_filter_dialog_filters = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || cache_status !== "ready" || is_refreshing) {
      return;
    }

    const normalized_filters = clone_proofreading_filter_options(filter_dialog_filters_ref.current);
    preferred_row_id_ref.current = null;
    should_select_first_visible_ref.current = false;
    visible_range_ref.current = null;
    cancel_pending_list_view_query();
    filter_panel_query_scheduler.cancel();
    update_table_filter_state({
      selection: create_selected_proofreading_filter_selection(normalized_filters),
    });
    clear_table_selection();
    set_filter_dialog_filters(clone_proofreading_filter_options(normalized_filters));
    filter_dialog_filters_ref.current = clone_proofreading_filter_options(normalized_filters);

    try {
      await settle_list_view_and_filter_panel({
        filters: normalized_filters,
        keyword: table_filter_state_ref.current.search_keyword,
        scope: table_filter_state_ref.current.search_scope,
        is_regex: table_filter_state_ref.current.is_regex,
        sort_state: table_sort_state_ref.current,
        force: true,
      });
    } catch (error) {
      report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
    } finally {
      set_filter_dialog_open(false);
      filter_dialog_open_ref.current = false;
    }
  }, [
    cache_status,
    cancel_pending_list_view_query,
    clear_table_selection,
    filter_panel_query_scheduler,
    is_refreshing,
    project_snapshot.loaded,
    report_proofreading_list_error,
    settle_list_view_and_filter_panel,
    table_filter_state_ref,
    table_sort_state_ref,
    t,
    update_table_filter_state,
  ]);

  const open_edit_dialog = useCallback(
    async (row_id: string): Promise<void> => {
      const target_item = (await read_items_by_row_ids([row_id]))[0];
      if (target_item === undefined) {
        return;
      }

      set_dialog_item_snapshot(target_item);
      set_dialog_state({
        open: true,
        target_row_id: row_id,
        draft_dst: target_item.dst,
        saving: false,
      });
    },
    [read_items_by_row_ids],
  );

  const update_dialog_draft = useCallback((next_draft_dst: string): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        draft_dst: next_draft_dst,
      };
    });
  }, []);

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    if (dialog_state.target_row_id === null) {
      return;
    }

    const target_item_id = Number(dialog_state.target_row_id);
    const target_item = Number.isInteger(target_item_id)
      ? (await read_items_by_row_ids([dialog_state.target_row_id]))[0]
      : undefined;
    if (target_item === undefined) {
      set_dialog_state(create_empty_dialog_state());
      set_dialog_item_snapshot(null);
      return;
    }

    if (dialog_state.draft_dst === target_item.dst) {
      set_dialog_state(create_empty_dialog_state());
      set_dialog_item_snapshot(null);
      push_toast("success", t("app.feedback.save_success"));
      return;
    }

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        saving: true,
      };
    });

    try {
      await run_project_write({
        path: "/api/proofreading/item/save",
        plan: create_save_item_plan({
          snapshot: {
            items: [target_item],
            section_revisions: consumed_revisions,
          },
          task_snapshot,
          item_id: Number(target_item.item_id),
          next_dst: dialog_state.draft_dst,
        }),
        fallback_error_key: "proofreading_page.feedback.save_failed",
        preferred_row_id: dialog_state.target_row_id,
        success_message_builder: () => t("app.feedback.save_success"),
        close_dialog: true,
      });
    } finally {
      set_dialog_state((previous_state) => {
        if (previous_state.target_row_id !== dialog_state.target_row_id) {
          return previous_state;
        }

        return {
          ...previous_state,
          saving: false,
        };
      });
    }
  }, [
    consumed_revisions,
    dialog_state,
    push_toast,
    read_items_by_row_ids,
    run_project_write,
    task_snapshot,
    t,
  ]);

  const replace_next_visible_match = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_writing) {
      return;
    }

    const trimmed_keyword = search_keyword.trim();
    if (trimmed_keyword === "") {
      push_toast("warning", t("proofreading_page.feedback.no_match"));
      return;
    }

    let search_pattern: CompiledTextPattern;
    try {
      const compiled_pattern = create_search_pattern(trimmed_keyword, is_regex);
      if (compiled_pattern === null) {
        push_toast("warning", t("proofreading_page.feedback.no_match"));
        return;
      }
      search_pattern = compiled_pattern;
    } catch (error) {
      push_toast(
        "error",
        `${t("proofreading_page.feedback.regex_invalid")}: ${resolve_visible_error_message(error, t, "")}`,
      );
      return;
    }

    if (list_view.view_id === "") {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let target_index = -1;
    let target_item: ProofreadingItem | null = null;
    for (
      let scan_start = replace_cursor_ref.current;
      scan_start < list_view.row_count;
      scan_start += PROOFREADING_REPLACE_SCAN_CHUNK_ROWS
    ) {
      const target_window =
        await proofreading_runtime_client_ref.current.read_proofreading_list_window({
          view_id: list_view.view_id,
          start: scan_start,
          count: PROOFREADING_REPLACE_SCAN_CHUNK_ROWS,
        });
      const matched_index = target_window.rows.findIndex((row) => {
        return matches_search_pattern(row.item.dst, search_pattern, trimmed_keyword);
      });
      if (matched_index >= 0) {
        target_index = target_window.start + matched_index;
        target_item = target_window.rows[matched_index]?.item ?? null;
        break;
      }
    }

    if (target_item === null || target_index < 0) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    const replaced_result = replace_first_visible_match(
      target_item.dst,
      search_pattern,
      replace_text,
      is_regex,
    );
    if (!replaced_result.replaced) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    await run_project_write({
      path: "/api/proofreading/item/save",
      plan: create_save_item_plan({
        snapshot: {
          items: [target_item],
          section_revisions: consumed_revisions,
        },
        task_snapshot,
        item_id: Number(target_item.item_id),
        next_dst: replaced_result.text,
      }),
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: build_proofreading_row_id(target_item.item_id),
      pending_replace_cursor: target_index + 1,
    });
  }, [
    is_writing,
    is_refreshing,
    is_regex,
    consumed_revisions,
    push_toast,
    readonly,
    replace_text,
    run_project_write,
    search_keyword,
    task_snapshot,
    t,
    list_view.view_id,
  ]);

  const replace_all_visible_matches = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_writing) {
      return;
    }

    const trimmed_keyword = search_keyword.trim();
    if (trimmed_keyword === "") {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let search_pattern: CompiledTextPattern;
    try {
      const compiled_pattern = create_search_pattern(trimmed_keyword, is_regex);
      if (compiled_pattern === null) {
        push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
        return;
      }
      search_pattern = compiled_pattern;
    } catch (error) {
      push_toast(
        "error",
        `${t("proofreading_page.feedback.regex_invalid")}: ${resolve_visible_error_message(error, t, "")}`,
      );
      return;
    }

    const target_row_ids = await read_current_view_row_ids(0, list_view.row_count);
    const target_items = (await read_items_by_row_ids(target_row_ids)).filter((item) => {
      return matches_search_pattern(item.dst, search_pattern, trimmed_keyword);
    });

    if (target_items.length === 0) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    const replace_plan = create_replace_all_plan({
      snapshot: {
        items: target_items,
        section_revisions: consumed_revisions,
      },
      task_snapshot,
      item_ids: target_items.map((item) => Number(item.item_id)),
      search_text: trimmed_keyword,
      replace_text,
      is_regex,
    });

    await run_project_write({
      path: "/api/proofreading/items/replace-all",
      plan: replace_plan,
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: active_row_id_ref.current,
      pending_replace_cursor: 0,
      success_message_builder: (changed_count) => {
        return t("proofreading_page.feedback.replace_done").replace(
          "{N}",
          changed_count.toString(),
        );
      },
      empty_warning_message: t("proofreading_page.feedback.replace_no_change"),
      close_dialog: true,
    });
  }, [
    is_writing,
    is_refreshing,
    is_regex,
    consumed_revisions,
    push_toast,
    readonly,
    replace_text,
    run_project_write,
    search_keyword,
    task_snapshot,
    t,
    list_view.row_count,
    read_current_view_row_ids,
    read_items_by_row_ids,
  ]);

  useEffect(() => {
    // 校对页首刷可能较久，刷新态用模态进度提示阻止用户误以为页面卡死。
    if (!project_snapshot.loaded || !loading_toast_visible) {
      const toast_id = loading_toast_id_ref.current;
      if (toast_id !== null) {
        loading_toast_id_ref.current = null;
        dismiss_toast(toast_id);
      }
      return;
    }

    if (loading_toast_id_ref.current !== null) {
      return;
    }

    const toast_id = push_progress_toast({
      message: t("proofreading_page.feedback.loading_toast"),
      presentation: "modal",
    });
    loading_toast_id_ref.current = toast_id;
  }, [dismiss_toast, loading_toast_visible, project_snapshot.loaded, push_progress_toast, t]);

  useEffect(() => {
    return () => {
      const toast_id = loading_toast_id_ref.current;
      if (toast_id === null) {
        return;
      }

      loading_toast_id_ref.current = null;
      dismiss_toast(toast_id);
    };
  }, [dismiss_toast]);

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      if (previous_project_loaded || previous_project_path !== "") {
        clear_transient_state_for_new_project();
        clear_cache_state();
        set_cache_status("idle");
      }
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      const restored_ui_state = restored_ui_state_ref.current;
      if (!restored_ui_state) {
        clear_transient_state_for_new_project();
      }
      restored_ui_state_ref.current = false;
      clear_cache_state();
      set_cache_status("refreshing");
      pending_reset_filters_ref.current = !restored_ui_state;
      previous_proofreading_change_seq_ref.current =
        proofreading_change_signal?.seq ?? previous_proofreading_change_seq_ref.current;
      void refresh_snapshot();
    }
  }, [
    clear_cache_state,
    clear_transient_state_for_new_project,
    project_snapshot.loaded,
    project_snapshot.path,
    proofreading_change_signal,
    refresh_snapshot,
  ]);

  useEffect(() => {
    const previous_seq = previous_proofreading_change_seq_ref.current;

    if (!project_snapshot.loaded || proofreading_change_signal === null) {
      return;
    }

    if (previous_seq !== proofreading_change_signal.seq) {
      previous_proofreading_change_seq_ref.current = proofreading_change_signal.seq;
      void refresh_snapshot();
    }
  }, [project_snapshot.loaded, proofreading_change_signal, refresh_snapshot]);

  useEffect(() => {
    if (proofreading_lookup_intent === null) {
      return;
    }

    should_select_first_visible_ref.current = false;
    visible_range_ref.current = null;
    cancel_pending_list_view_query();
    update_table_filter_state({
      search_keyword: proofreading_lookup_intent.keyword,
      search_scope: "all",
      is_regex: proofreading_lookup_intent.is_regex,
    });
    clear_table_selection();
    void run_list_view_query(
      {
        filters: resolve_current_filters(),
        keyword: proofreading_lookup_intent.keyword,
        scope: "all",
        is_regex: proofreading_lookup_intent.is_regex,
        sort_state: table_sort_state_ref.current,
      },
      {
        force: true,
      },
    ).catch((error) => {
      report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
    });
    clear_proofreading_lookup_intent();
  }, [
    clear_proofreading_lookup_intent,
    cancel_pending_list_view_query,
    clear_table_selection,
    proofreading_lookup_intent,
    report_proofreading_list_error,
    resolve_current_filters,
    run_list_view_query,
    table_sort_state_ref,
    t,
    update_table_filter_state,
  ]);

  useEffect(() => {
    if (pending_replace_cursor_ref.current !== null) {
      replace_cursor_ref.current = pending_replace_cursor_ref.current;
      pending_replace_cursor_ref.current = null;
      return;
    }

    replace_cursor_ref.current = 0;
  }, [current_filter_signature, is_regex, search_keyword, search_scope, sort_signature]);

  useEffect(() => {
    const preferred_row_id = preferred_row_id_ref.current;

    if (preferred_row_id !== null) {
      preferred_row_id_ref.current = null;
      apply_preferred_row_focus(preferred_row_id);
      return;
    }

    if (should_select_first_visible_ref.current && visible_row_ids.length > 0) {
      should_select_first_visible_ref.current = false;
      const first_visible_row_id = visible_row_ids[0] ?? null;
      if (first_visible_row_id !== null) {
        set_table_selection_state({
          selected_row_ids: [first_visible_row_id],
          active_row_id: first_visible_row_id,
          anchor_row_id: first_visible_row_id,
        });
        return;
      }
    }
  }, [apply_preferred_row_focus, set_table_selection_state, visible_row_ids]);

  return useMemo<UseProofreadingPageStateResult>(() => {
    return {
      cache_status,
      consumed_revisions,
      required_sections: PROOFREADING_REQUIRED_SECTIONS,
      settled_project_path,
      is_refreshing,
      is_writing,
      readonly,
      search_keyword,
      replace_text,
      search_scope,
      is_regex,
      invalid_regex_message,
      current_filters,
      filter_dialog_filters,
      filter_panel,
      filter_panel_loading,
      visible_items,
      visible_row_count: list_view.row_count,
      sort_state,
      selected_row_ids,
      active_row_id,
      anchor_row_id,
      restore_scroll_row_id,
      preserve_scroll_anchor,
      retranslating_row_ids,
      filter_dialog_open,
      dialog_state,
      dialog_item,
      pending_confirmation,
      refresh_snapshot,
      update_search_keyword,
      update_replace_text,
      update_search_scope,
      update_regex,
      apply_table_selection,
      apply_table_sort_state,
      get_visible_row_at_index,
      get_visible_row_id_at_index,
      resolve_visible_row_index,
      resolve_visible_row_index_async,
      resolve_visible_row_ids_range,
      read_visible_range,
      handle_table_selection_error,
      open_filter_dialog,
      close_filter_dialog,
      update_filter_dialog_filters,
      confirm_filter_dialog_filters,
      open_edit_dialog,
      request_close_dialog,
      update_dialog_draft,
      save_dialog_entry,
      replace_next_visible_match,
      replace_all_visible_matches,
      request_retranslate_row_ids,
      request_clear_translation_row_ids,
      request_set_translation_status_row_ids,
      confirm_pending_confirmation,
      close_pending_confirmation,
    };
  }, [
    active_row_id,
    anchor_row_id,
    apply_table_selection,
    apply_table_sort_state,
    cache_status,
    consumed_revisions,
    close_filter_dialog,
    close_pending_confirmation,
    confirm_filter_dialog_filters,
    confirm_pending_confirmation,
    current_filters,
    dialog_item,
    dialog_state,
    filter_dialog_filters,
    filter_dialog_open,
    filter_panel,
    filter_panel_loading,
    get_visible_row_at_index,
    get_visible_row_id_at_index,
    handle_table_selection_error,
    invalid_regex_message,
    is_writing,
    is_refreshing,
    is_regex,
    open_edit_dialog,
    open_filter_dialog,
    pending_confirmation,
    preserve_scroll_anchor,
    readonly,
    retranslating_row_ids,
    refresh_snapshot,
    read_visible_range,
    resolve_visible_row_ids_range,
    resolve_visible_row_index_async,
    replace_all_visible_matches,
    replace_next_visible_match,
    replace_text,
    request_close_dialog,
    request_clear_translation_row_ids,
    request_retranslate_row_ids,
    request_set_translation_status_row_ids,
    resolve_visible_row_index,
    restore_scroll_row_id,
    save_dialog_entry,
    search_keyword,
    search_scope,
    selected_row_ids,
    settled_project_path,
    sort_state,
    update_dialog_draft,
    update_filter_dialog_filters,
    update_regex,
    update_replace_text,
    update_search_keyword,
    update_search_scope,
    visible_items,
    list_view.row_count,
  ]);
}
