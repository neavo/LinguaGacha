import { api_fetch } from "@/app/desktop/desktop-api";
import type {
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindow,
  ProofreadingListWindowQuery,
  ProofreadingRowIndexQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingRuntimeSyncState,
} from "@shared/proofreading/proofreading-read-model";
import type {
  ProofreadingClientItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "@/pages/proofreading-page/types";

type ProofreadingListQueryOptions = {
  staleKey?: string | null;
};

export type ProofreadingListClient = {
  hydrate_proofreading_full: (input: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<ProofreadingRuntimeSyncState>;
  build_proofreading_list_view: (
    input: ProofreadingListViewQuery,
    options?: ProofreadingListQueryOptions,
  ) => Promise<ProofreadingListView>;
  read_proofreading_list_window: (
    input: ProofreadingListWindowQuery,
  ) => Promise<ProofreadingListWindow>;
  read_proofreading_row_ids_range: (input: ProofreadingRowIdsRangeQuery) => Promise<string[]>;
  resolve_proofreading_row_index: (input: ProofreadingRowIndexQuery) => Promise<number | undefined>;
  read_proofreading_items_by_row_ids: (
    input: ProofreadingItemsByRowIdsQuery,
  ) => Promise<ProofreadingClientItem[]>;
  build_proofreading_filter_panel: (
    input: ProofreadingFilterPanelQuery,
  ) => Promise<ProofreadingFilterPanelState>;
  dispose_project: (projectId: string) => Promise<void>;
  dispose: () => void;
};

let shared_proofreading_list_client: ProofreadingListClient | null = null;

/**
 * 创建校对列表 client；页面通过 Core query runtime 获取校对列表和窗口数据。
 */
export function createProofreadingListClient(): ProofreadingListClient {
  return {
    async hydrate_proofreading_full(input) {
      const response = await api_fetch<{
        syncState?: ProofreadingRuntimeSyncState;
      }>("/api/project/query/proofreading", {
        action: "sync",
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
      });
      return (
        response.syncState ?? {
          projectId: "",
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          revisions: { files: 0, items: 0, quality: 0, proofreading: 0 },
          defaultFilters: {
            warning_types: [],
            statuses: [],
            file_paths: [],
            glossary_terms: [],
            include_without_glossary_miss: true,
          },
        }
      );
    },
    async build_proofreading_list_view(input, _options = {}) {
      const response = await api_fetch<{ view?: ProofreadingListView }>(
        "/api/project/query/proofreading",
        { action: "list", query: input },
      );
      return (
        response.view ?? {
          projectId: "",
          revisions: { files: 0, items: 0, quality: 0, proofreading: 0 },
          view_id: "",
          row_count: 0,
          window_start: 0,
          window_rows: [],
          invalid_regex_message: null,
        }
      );
    },
    async read_proofreading_list_window(input) {
      const response = await api_fetch<{ window?: ProofreadingListWindow }>(
        "/api/project/query/proofreading",
        { action: "window", ...input },
      );
      return response.window ?? { view_id: input.view_id, start: 0, row_count: 0, rows: [] };
    },
    async read_proofreading_row_ids_range(input) {
      const response = await api_fetch<{ row_ids?: string[] }>("/api/project/query/proofreading", {
        action: "row_ids_range",
        ...input,
      });
      return Array.isArray(response.row_ids) ? response.row_ids : [];
    },
    async resolve_proofreading_row_index(input) {
      const response = await api_fetch<{ row_index?: number | null }>(
        "/api/project/query/proofreading",
        { action: "row_index", ...input },
      );
      return typeof response.row_index === "number" ? response.row_index : undefined;
    },
    async read_proofreading_items_by_row_ids(input) {
      const response = await api_fetch<{ rows?: ProofreadingClientItem[] }>(
        "/api/project/query/proofreading",
        { action: "items_by_row_ids", row_ids: input.row_ids },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
    async build_proofreading_filter_panel(input) {
      const response = await api_fetch<{ filterPanel?: ProofreadingFilterPanelState }>(
        "/api/project/query/proofreading",
        { action: "filter_panel", filters: input.filters },
      );
      return (
        response.filterPanel ?? {
          available_statuses: [],
          status_count_by_code: {},
          available_warning_types: [],
          warning_count_by_code: {},
          all_file_paths: [],
          available_file_paths: [],
          file_count_by_path: {},
          glossary_term_entries: [],
          without_glossary_miss_count: 0,
        }
      );
    },
    async dispose_project(_projectId) {},
    dispose() {},
  };
}

/**
 * 页面默认复用单例 client，避免同一项目内重复创建 API client。
 */
export function getSharedProofreadingListClient(): ProofreadingListClient {
  if (shared_proofreading_list_client === null) {
    shared_proofreading_list_client = createProofreadingListClient();
  }

  return shared_proofreading_list_client;
}

/**
 * 测试重置共享 client，保证用例之间没有实例串扰。
 */
export function resetSharedProofreadingListClientForTest(): void {
  shared_proofreading_list_client?.dispose();
  shared_proofreading_list_client = null;
}
