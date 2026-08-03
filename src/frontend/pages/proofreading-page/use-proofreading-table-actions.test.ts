import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import { useProofreadingTableActions } from "@frontend/pages/proofreading-page/use-proofreading-table-actions";
import type { ProofreadingFilterOptions } from "@shared/proofreading/proofreading-types";

type TableActions = ReturnType<typeof useProofreadingTableActions>;
type TableActionsOptions = Parameters<typeof useProofreadingTableActions>[0];

// 公开动作测试只需一份空筛选事实，避免复制页面状态夹具。
function create_filters(): ProofreadingFilterOptions {
  return {
    warning_types: [],
    statuses: [],
    file_paths: [],
    glossary_entry_ids: [],
    include_without_glossary_miss: true,
  };
}

// 构造 Hook 的最小协作者集合；测试按公开回调观察最终意图。
function create_options(): TableActionsOptions {
  const filters = create_filters();
  return {
    cache_status: "ready",
    filter_dialog_open: false,
    is_refreshing: false,
    list_view: {
      projectId: "E:/demo/sample.lg",
      revisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
      view_id: "view-1",
      row_count: 2,
      window_start: 0,
      window_rows: [],
      invalid_regex_message: null,
    },
    project_loaded: true,
    visible_items: [],
    visible_row_index_by_id: new Map([["local", 1]]),
    filter_dialog_filters_ref: { current: filters },
    filter_dialog_open_ref: { current: false },
    preferred_row_id_ref: { current: null },
    proofreading_runtime_client_ref: {
      current: {
        ...createProofreadingApiClient(),
        resolve_proofreading_row_index: vi.fn(async () => 7),
      },
    },
    should_select_first_visible_ref: { current: true },
    sync_state_ref: {
      current: {
        projectId: "E:/demo/sample.lg",
        sourceLanguage: "ja",
        targetLanguage: "zh-CN",
        revisions: { files: 1, items: 2, quality: 3, proofreading: 4 },
        defaultFilters: filters,
      },
    },
    visible_range_ref: { current: { start: 0, count: 20 } },
    cancel_pending_list_view_query: vi.fn(),
    clear_table_selection: vi.fn(),
    filter_panel_query_scheduler: { cancel: vi.fn(), schedule: vi.fn() },
    read_current_view_row_ids: vi.fn(async () => []),
    read_list_window: vi.fn(async () => undefined),
    report_proofreading_list_error: vi.fn(() => true),
    materialize_active_filters: () => filters,
    run_filter_panel_query: vi.fn(async () => null),
    run_list_view_query: vi.fn(async () => null),
    schedule_search_list_view_query: vi.fn(),
    set_filter_dialog_filters: vi.fn(),
    set_filter_dialog_open: vi.fn(),
    set_replace_text: vi.fn(),
    set_table_filter_state: vi.fn(),
    set_table_selection_state: vi.fn(),
    set_table_sort_state: vi.fn(),
    t: (key) => key,
  };
}

describe("useProofreadingTableActions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_actions: TableActions | null = null;
  let options = create_options();

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    latest_actions = null;
    options = create_options();
  });

  // 最小探针只暴露 Hook 的公开动作。
  function TableActionsProbe(): null {
    latest_actions = useProofreadingTableActions(options);
    return null;
  }

  async function render_hook(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(TableActionsProbe)));
  }

  it("更新搜索意图时重置窗口和选择并调度新查询", async () => {
    await render_hook();

    act(() => latest_actions?.update_search_keyword("HP"));

    expect(options.should_select_first_visible_ref.current).toBe(false);
    expect(options.visible_range_ref.current).toBeNull();
    expect(options.set_table_filter_state).toHaveBeenCalledWith({ search_keyword: "HP" });
    expect(options.clear_table_selection).toHaveBeenCalledOnce();
    expect(options.schedule_search_list_view_query).toHaveBeenCalledOnce();
  });

  it("优先解析本地行索引，缺失时回退当前 reader 视图", async () => {
    await render_hook();

    expect(latest_actions?.resolve_visible_row_index("local")).toBe(1);
    await expect(latest_actions?.resolve_visible_row_index_async("remote")).resolves.toBe(7);
    expect(
      options.proofreading_runtime_client_ref.current.resolve_proofreading_row_index,
    ).toHaveBeenCalledWith({ view_id: "view-1", row_id: "remote" });
  });
});
