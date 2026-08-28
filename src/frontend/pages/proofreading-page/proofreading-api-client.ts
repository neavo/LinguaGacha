import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  ProofreadingContextQuery,
  ProofreadingFilterPanelQuery,
  ProofreadingItemsByRowIdsQuery,
  ProofreadingListViewQuery,
  ProofreadingListWindow,
  ProofreadingListWindowQuery,
  ProofreadingRowIndexQuery,
  ProofreadingRowIdsRangeQuery,
  ProofreadingSyncState,
} from "@shared/proofreading/proofreading-reader";
import {
  create_empty_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingClientItem,
  type ProofreadingContextItem,
  type ProofreadingFilterPanelState,
  type ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import type { ProjectDataSectionRevisions } from "@shared/project-event";

export type ProofreadingSyncSnapshot = {
  syncState: ProofreadingSyncState; // 校对 reader 轻量运行态，只描述列表缓存身份和默认筛选
  sectionRevisions: ProjectDataSectionRevisions; // query response 顶层完整乐观锁来源
};

export type ProofreadingApiClient = {
  sync_proofreading_cache: (input: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<ProofreadingSyncSnapshot>;
  build_proofreading_list_view: (input: ProofreadingListViewQuery) => Promise<ProofreadingListView>;
  read_proofreading_list_window: (
    input: ProofreadingListWindowQuery,
  ) => Promise<ProofreadingListWindow>;
  read_proofreading_row_ids_range: (input: ProofreadingRowIdsRangeQuery) => Promise<string[]>;
  resolve_proofreading_row_index: (input: ProofreadingRowIndexQuery) => Promise<number | undefined>;
  read_proofreading_items_by_row_ids: (
    input: ProofreadingItemsByRowIdsQuery,
  ) => Promise<ProofreadingClientItem[]>;
  read_proofreading_context: (
    input: ProofreadingContextQuery,
  ) => Promise<ProofreadingContextItem[]>;
  build_proofreading_filter_panel: (
    input: ProofreadingFilterPanelQuery,
  ) => Promise<ProofreadingFilterPanelState>;
};

/**
 * 创建校对页 API client；页面通过后端 query reader/state 获取校对列表和窗口数据。
 */
export function createProofreadingApiClient(): ProofreadingApiClient {
  return {
    async sync_proofreading_cache(input) {
      const response = await api_fetch<{
        syncState?: ProofreadingSyncState;
        sectionRevisions?: ProjectDataSectionRevisions;
      }>("/api/proofreading/query", {
        action: "sync",
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
      });
      const syncState = response.syncState ?? {
        projectId: "",
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        revisions: { files: 0, items: 0, quality: 0, proofreading: 0 },
        defaultFilters: create_empty_proofreading_filter_options(),
      };
      return {
        syncState,
        // 旧响应没有顶层 sectionRevisions 时降级为空锁，避免前端伪造后端未返回的 revision。
        sectionRevisions: response.sectionRevisions ?? {},
      };
    },
    async build_proofreading_list_view(input) {
      const response = await api_fetch<{ view?: ProofreadingListView }>("/api/proofreading/query", {
        action: "list",
        query: input,
      });
      return response.view ?? create_empty_proofreading_list_view();
    },
    async read_proofreading_list_window(input) {
      const response = await api_fetch<{ window?: ProofreadingListWindow }>(
        "/api/proofreading/query",
        { action: "window", ...input },
      );
      return response.window ?? { view_id: input.view_id, start: 0, row_count: 0, rows: [] };
    },
    async read_proofreading_row_ids_range(input) {
      const response = await api_fetch<{ row_ids?: string[] }>("/api/proofreading/query", {
        action: "row_ids_range",
        ...input,
      });
      return Array.isArray(response.row_ids) ? response.row_ids : [];
    },
    async resolve_proofreading_row_index(input) {
      const response = await api_fetch<{ row_index?: number | null }>("/api/proofreading/query", {
        action: "row_index",
        ...input,
      });
      return typeof response.row_index === "number" ? response.row_index : undefined;
    },
    async read_proofreading_items_by_row_ids(input) {
      const response = await api_fetch<{ rows?: ProofreadingClientItem[] }>(
        "/api/proofreading/query",
        { action: "items_by_row_ids", row_ids: input.row_ids },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
    async read_proofreading_context(input) {
      const response = await api_fetch<{ rows?: ProofreadingContextItem[] }>(
        "/api/proofreading/query",
        { action: "context", row_id: input.row_id },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
    async build_proofreading_filter_panel(input) {
      const response = await api_fetch<{ filterPanel?: ProofreadingFilterPanelState }>(
        "/api/proofreading/query",
        { action: "filter_panel", filters: input.filters },
      );
      return response.filterPanel ?? create_empty_proofreading_filter_panel_state();
    },
  };
}
