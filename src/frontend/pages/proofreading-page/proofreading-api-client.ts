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
import type { ProjectItemPublicRecord } from "@domain/item";

export type ProofreadingSyncSnapshot = {
  syncState: ProofreadingSyncState; // 校对 reader 轻量运行态，只描述列表缓存身份和默认筛选
  sectionRevisions: ProjectDataSectionRevisions; // query response 顶层完整乐观锁来源
};

export type ProofreadingApiClient = {
  read_proofreading_raw_item: (input: {
    row_id: string;
    project_path: string;
  }) => Promise<ProjectItemPublicRecord>;
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
    /** 按需读取已保存的完整条目，缺失响应报错。 */
    async read_proofreading_raw_item(input) {
      const response = await api_fetch<{ item?: ProjectItemPublicRecord | null }>(
        "/api/proofreading/query",
        {
          action: "raw_item",
          ...input,
        },
      );
      if (response.item == null) throw new Error("The raw item response is absent.");
      return response.item;
    },
    /** 语言配置参与校对缓存同步，响应修订供后续保存使用。 */
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
        files: [],
      };
      return {
        syncState,
        // 旧响应没有顶层 sectionRevisions 时降级为空锁，避免前端伪造后端未返回的 revision。
        sectionRevisions: response.sectionRevisions ?? {},
      };
    },
    /** 查询意图由后端生成稳定窗口身份。 */
    async build_proofreading_list_view(input) {
      const response = await api_fetch<{ view?: ProofreadingListView }>("/api/proofreading/query", {
        action: "list",
        query: input,
      });
      return response.view ?? create_empty_proofreading_list_view();
    },
    /** 按已有窗口身份读取可见行。 */
    async read_proofreading_list_window(input) {
      const response = await api_fetch<{ window?: ProofreadingListWindow }>(
        "/api/proofreading/query",
        { action: "window", ...input },
      );
      return response.window ?? { view_id: "", start: 0, row_count: 0, rows: [] };
    },
    /** 范围操作读取完整行身份，避免受可见窗口大小限制。 */
    async read_proofreading_row_ids_range(input) {
      const response = await api_fetch<{ row_ids?: string[] }>("/api/proofreading/query", {
        action: "row_ids_range",
        ...input,
      });
      return Array.isArray(response.row_ids) ? response.row_ids : [];
    },
    /** 导航用后端索引定位目标，缺失目标保留为 `undefined`。 */
    async resolve_proofreading_row_index(input) {
      const response = await api_fetch<{ row_index?: number | null }>("/api/proofreading/query", {
        action: "row_index",
        ...input,
      });
      return typeof response.row_index === "number" ? response.row_index : undefined;
    },
    /** 打开、保存和批量操作共用当前条目的回读入口。 */
    async read_proofreading_items_by_row_ids(input) {
      const response = await api_fetch<{ rows?: ProofreadingClientItem[] }>(
        "/api/proofreading/query",
        { action: "items_by_row_ids", row_ids: input.row_ids },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
    /** 前后文独立读取，当前条目的草稿由弹窗覆盖展示。 */
    async read_proofreading_context(input) {
      const response = await api_fetch<{ rows?: ProofreadingContextItem[] }>(
        "/api/proofreading/query",
        { action: "context", row_id: input.row_id },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
    /** 筛选统计与当前内容条件保持一致。 */
    async build_proofreading_filter_panel(input) {
      const response = await api_fetch<{ filterPanel?: ProofreadingFilterPanelState }>(
        "/api/proofreading/query",
        { action: "filter_panel", filters: input.filters },
      );
      return response.filterPanel ?? create_empty_proofreading_filter_panel_state();
    },
  };
}
