import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import { useProofreadingCacheActions } from "@frontend/pages/proofreading-page/use-proofreading-cache-actions";
import {
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import {
  create_empty_filter_options,
  create_empty_proofreading_view_filter_state,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";

type CacheActionState = ReturnType<typeof useProofreadingCacheActions>;

// 构造刷新后列表 query 返回的最小稳定视图。
function create_list_view(): ProofreadingListView {
  return {
    projectId: "E:/demo/sample.lg",
    revisions: {
      files: 2,
      items: 7,
      quality: 3,
      proofreading: 5,
    },
    view_id: "proofreading-view",
    row_count: 0,
    window_start: 0,
    window_rows: [],
    invalid_regex_message: null,
  };
}

describe("useProofreadingCacheActions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: CacheActionState | null = null;
  const set_list_revisions = vi.fn(); // 接收列表 reader revision
  const set_operation_revisions = vi.fn(); // 接收 query 顶层操作 revision
  const sync_state_ref = { current: null }; // 校对 sync 运行态引用
  const list_view_ref = { current: create_empty_proofreading_list_view() }; // 当前列表视图引用

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    set_list_revisions.mockReset();
    set_operation_revisions.mockReset();
    sync_state_ref.current = null;
    list_view_ref.current = create_empty_proofreading_list_view();
  });

  // 暴露 hook 返回值，刷新依赖通过 options 的公开边界注入。
  function CacheActionProbe(): null {
    latest_state = useProofreadingCacheActions({
      cache_status: "idle",
      filter_panel: create_empty_proofreading_filter_panel_state(),
      list_view: create_empty_proofreading_list_view(),
      project_loaded: true,
      project_path: "E:/demo/sample.lg",
      proofreading_change_signal: null,
      source_language: "JA",
      target_language: "ZH",
      defaultFiltersRef: { current: create_empty_filter_options() },
      filter_dialog_filters_ref: { current: create_empty_filter_options() },
      filter_dialog_open_ref: { current: false },
      filter_panel_request_id_ref: { current: 0 },
      last_filter_panel_signature_ref: { current: "" },
      last_list_query_signature_ref: { current: "" },
      last_visible_range_signature_ref: { current: "" },
      list_view_ref,
      list_view_request_id_ref: { current: 0 },
      list_window_bounds_ref: { current: { start: 0, count: 50 } },
      list_window_request_id_ref: { current: 0 },
      pending_reset_filters_ref: { current: false },
      proofreading_runtime_client_ref: {
        current: {
          sync_proofreading_cache: vi.fn(async () => {
            const syncState = {
              projectId: "E:/demo/sample.lg",
              sourceLanguage: "JA",
              targetLanguage: "ZH",
              revisions: {
                files: 2,
                items: 7,
                quality: 3,
                proofreading: 5,
              },
              defaultFilters: create_empty_filter_options(),
            };
            return {
              syncState,
              sectionRevisions: {
                items: 7,
                quality: 3,
                proofreading: 5,
                prompts: 9,
              },
            };
          }),
          build_proofreading_list_view: vi.fn(async () => create_list_view()),
          build_proofreading_filter_panel: vi.fn(),
          read_proofreading_list_window: vi.fn(),
          read_proofreading_row_ids_range: vi.fn(),
          resolve_proofreading_row_index: vi.fn(),
          read_proofreading_items_by_row_ids: vi.fn(),
          dispose_project: vi.fn(),
          dispose: vi.fn(),
        } satisfies ProofreadingApiClient,
      },
      refresh_generation_ref: { current: 0 },
      sync_state_ref,
      table_filter_state_ref: {
        current: create_empty_proofreading_view_filter_state(),
      },
      table_sort_state_ref: { current: null },
      visible_range_ref: { current: null },
      clear_cache_state: vi.fn(),
      clear_transient_state_for_new_project: vi.fn(),
      invalidate_cache_bound_queries: vi.fn(),
      publish_refresh_scroll_anchor: vi.fn(),
      report_proofreading_list_error: vi.fn(() => true),
      resolve_current_filters: () => create_empty_filter_options(),
      set_cache_status: vi.fn(),
      set_list_revisions,
      set_operation_revisions,
      set_filter_dialog_filters: vi.fn(),
      set_filter_dialog_open: vi.fn(),
      set_filter_panel: vi.fn(),
      set_filter_panel_loading: vi.fn(),
      set_is_refreshing: vi.fn(),
      set_list_view: vi.fn(),
      set_loading_toast_visible: vi.fn(),
      set_refresh_retry_nonce: vi.fn(),
      set_settled_project_path: vi.fn(),
      update_table_filter_state: vi.fn(),
      warm_filter_panel_query_ref: { current: vi.fn() },
      t: (key) => key,
    });
    return null;
  }

  // 渲染最小 hook 探针，复用同一个 React root。
  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(CacheActionProbe));
    });
  }

  it("刷新缓存时分别发布列表 revision 和操作 revision", async () => {
    await render_hook();

    await act(async () => {
      await latest_state?.refresh_snapshot();
    });

    expect(set_list_revisions).toHaveBeenCalledWith({
      files: 2,
      items: 7,
      quality: 3,
      proofreading: 5,
    });
    expect(set_operation_revisions).toHaveBeenCalledWith({
      items: 7,
      quality: 3,
      proofreading: 5,
      prompts: 9,
    });
  });
});
