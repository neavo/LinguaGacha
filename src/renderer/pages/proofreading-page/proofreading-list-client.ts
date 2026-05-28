import {
  createProofreadingListService,
  type ProofreadingFilterPanelQuery,
  type ProofreadingItemsByRowIdsQuery,
  type ProofreadingListViewQuery,
  type ProofreadingListWindow,
  type ProofreadingListWindowQuery,
  type ProofreadingRowIndexQuery,
  type ProofreadingRowIdsRangeQuery,
  type ProofreadingRuntimeDeltaInput,
  type ProofreadingRuntimeHydrationInput,
  type ProofreadingRuntimeSyncState,
} from "@/pages/proofreading-page/proofreading-list-service";
import type {
  ProofreadingClientItem,
  ProofreadingFilterPanelState,
  ProofreadingListView,
} from "@/pages/proofreading-page/types";

type ProofreadingListQueryOptions = {
  staleKey?: string | null;
};

export type ProofreadingListClient = {
  hydrate_proofreading_full: (
    input: ProofreadingRuntimeHydrationInput,
  ) => Promise<ProofreadingRuntimeSyncState>;
  apply_proofreading_item_delta: (
    input: ProofreadingRuntimeDeltaInput,
  ) => Promise<ProofreadingRuntimeSyncState>;
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
 * 创建校对列表 client；当前实现走本地 service，保留异步接口兼容页面调用节奏。
 */
export function createProofreadingListClient(): ProofreadingListClient {
  const service = createProofreadingListService();
  return {
    // 全量 hydrate 是每个项目进入校对列表时的唯一初始化入口。
    async hydrate_proofreading_full(input) {
      return service.hydrate_full(input);
    },
    // 增量只接受后端确认后的项目事件数据。
    async apply_proofreading_item_delta(input) {
      return service.apply_item_delta(input);
    },
    // 列表视图构建会生成稳定 view_id，后续窗口读取必须带回该 id。
    async build_proofreading_list_view(input, _options = {}) {
      return service.build_list_view(input);
    },
    // 窗口读取只返回已缓存视图的当前切片。
    async read_proofreading_list_window(input) {
      return service.read_list_window(input);
    },
    // 行 id 范围读取供批量操作保存选择集合。
    async read_proofreading_row_ids_range(input) {
      return service.read_row_ids_range(input);
    },
    // 行定位留在运行态内执行，避免页面复制完整 id 索引。
    async resolve_proofreading_row_index(input) {
      return service.resolve_row_index(input);
    },
    // 精确 item 回读用于编辑弹窗和批量提交前确认当前行事实。
    async read_proofreading_items_by_row_ids(input) {
      return service.read_items_by_row_ids(input);
    },
    // 筛选面板和列表视图共享同一运行态统计。
    async build_proofreading_filter_panel(input) {
      return service.build_filter_panel(input);
    },
    // 只释放身份匹配的项目缓存，避免迟到清理影响新项目。
    async dispose_project(projectId) {
      service.dispose_project(projectId);
    },
    dispose() {
      // 本地列表运行态没有独立后台资源，dispose 只保留统一接口。
    },
  };
}

/**
 * 页面默认复用单例 client，避免同一项目内重复构建列表运行态。
 */
export function getSharedProofreadingListClient(): ProofreadingListClient {
  if (shared_proofreading_list_client === null) {
    shared_proofreading_list_client = createProofreadingListClient();
  }

  return shared_proofreading_list_client;
}

/**
 * 测试重置共享 client，保证用例之间没有列表缓存串扰。
 */
export function resetSharedProofreadingListClientForTest(): void {
  shared_proofreading_list_client?.dispose();
  shared_proofreading_list_client = null;
}
