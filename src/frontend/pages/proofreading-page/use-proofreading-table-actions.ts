import { useCallback, type MutableRefObject } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import {
  clone_proofreading_filter_options,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingListView,
  type ProofreadingSearchScope,
  type ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";
import type { ProofreadingSyncState } from "@shared/proofreading/proofreading-list-reader";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import {
  resolve_proofreading_filter_selection_from_filters,
  type ProofreadingViewFilterState,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import type { ProofreadingListQueryInput } from "@frontend/pages/proofreading-page/proofreading-list-query-utils";

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type QueryScheduler<TArgs> = {
  cancel: () => void;
  schedule: (args: TArgs) => void;
};

type UseProofreadingTableActionsOptions = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  filter_dialog_open: boolean;
  is_refreshing: boolean;
  list_view: ProofreadingListView;
  project_loaded: boolean;
  visible_items: ProofreadingVisibleItem[];
  visible_row_index_by_id: Map<string, number>;
  filter_dialog_filters_ref: MutableRefObject<ProofreadingFilterOptions>;
  filter_dialog_open_ref: MutableRefObject<boolean>;
  preferred_row_id_ref: MutableRefObject<string | null>;
  proofreading_runtime_client_ref: MutableRefObject<ProofreadingApiClient>;
  should_select_first_visible_ref: MutableRefObject<boolean>;
  sync_state_ref: MutableRefObject<ProofreadingSyncState | null>;
  table_filter_state_ref: MutableRefObject<ProofreadingViewFilterState>;
  table_sort_state_ref: MutableRefObject<AppTableSortState | null>;
  visible_range_ref: MutableRefObject<{ start: number; count: number } | null>;
  cancel_pending_list_view_query: () => void;
  clear_table_selection: () => void;
  filter_panel_query_scheduler: QueryScheduler<ProofreadingFilterOptions>;
  read_current_view_row_ids: (start: number, count: number) => Promise<string[]>;
  read_list_window: (range: { start: number; count: number }) => Promise<unknown>;
  report_proofreading_list_error: (error: unknown, fallback_message: string) => boolean;
  resolve_current_filters: () => ProofreadingFilterOptions;
  run_filter_panel_query: (
    filters: ProofreadingFilterOptions,
    options?: { force?: boolean; mark_loading?: boolean },
  ) => Promise<ProofreadingFilterPanelState | null>;
  run_list_view_query: (
    args: ProofreadingListQueryInput,
    options?: { force?: boolean },
  ) => Promise<ProofreadingListView | null>;
  schedule_search_list_view_query: (args: ProofreadingListQueryInput) => void;
  set_filter_dialog_filters: (filters: ProofreadingFilterOptions) => void;
  set_filter_dialog_open: (open: boolean) => void;
  set_replace_text: (text: string) => void;
  set_table_filter_state: (
    patch: Partial<ProofreadingViewFilterState>,
    options?: { persist?: boolean },
  ) => void;
  set_table_selection_state: (payload: {
    selected_row_ids: string[];
    active_row_id: string | null;
    anchor_row_id: string | null;
  }) => void;
  set_table_sort_state: (sort_state: AppTableSortState | null) => void;
  settle_list_view_and_filter_panel: (args: {
    filters: ProofreadingFilterOptions;
    keyword: string;
    scope: ProofreadingSearchScope;
    is_regex: boolean;
    sort_state: AppTableSortState | null;
    force?: boolean;
  }) => Promise<boolean>;
  t: LocaleTextResolver;
};

type UseProofreadingTableActionsResult = {
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
  read_visible_range: (range: { start: number; count: number }) => void;
  resolve_visible_row_ids_range: (range: { start: number; count: number }) => Promise<string[]>;
  handle_table_selection_error: (error: unknown) => void;
  open_filter_dialog: () => void;
  close_filter_dialog: () => void;
  update_filter_dialog_filters: (next_filters: ProofreadingFilterOptions) => void;
  confirm_filter_dialog_filters: () => Promise<void>;
};

export function useProofreadingTableActions(
  options: UseProofreadingTableActionsOptions,
): UseProofreadingTableActionsResult {
  const update_search_keyword = useCallback(
    (next_keyword: string): void => {
      options.should_select_first_visible_ref.current = false;
      options.visible_range_ref.current = null;
      options.set_table_filter_state({
        search_keyword: next_keyword,
      });
      options.clear_table_selection();
      options.schedule_search_list_view_query({
        filters: options.resolve_current_filters(),
        keyword: next_keyword,
        scope: options.table_filter_state_ref.current.search_scope,
        is_regex: options.table_filter_state_ref.current.is_regex,
        sort_state: options.table_sort_state_ref.current,
      });
    },
    [options],
  );

  const update_replace_text = useCallback(
    (next_replace_text: string): void => {
      options.set_replace_text(next_replace_text);
    },
    [options],
  );

  const update_search_scope = useCallback(
    (next_scope: ProofreadingSearchScope): void => {
      options.cancel_pending_list_view_query();
      options.should_select_first_visible_ref.current = false;
      options.visible_range_ref.current = null;
      options.set_table_filter_state({
        search_scope: next_scope,
      });
      options.clear_table_selection();
      void options
        .run_list_view_query(
          {
            filters: options.resolve_current_filters(),
            keyword: options.table_filter_state_ref.current.search_keyword,
            scope: next_scope,
            is_regex: options.table_filter_state_ref.current.is_regex,
            sort_state: options.table_sort_state_ref.current,
          },
          {
            force: true,
          },
        )
        .catch((error) => {
          options.report_proofreading_list_error(
            error,
            options.t("proofreading_page.feedback.refresh_failed"),
          );
        });
    },
    [options],
  );

  const update_regex = useCallback(
    (next_is_regex: boolean): void => {
      options.cancel_pending_list_view_query();
      options.should_select_first_visible_ref.current = false;
      options.visible_range_ref.current = null;
      options.set_table_filter_state({
        is_regex: next_is_regex,
      });
      options.clear_table_selection();
      void options
        .run_list_view_query(
          {
            filters: options.resolve_current_filters(),
            keyword: options.table_filter_state_ref.current.search_keyword,
            scope: options.table_filter_state_ref.current.search_scope,
            is_regex: next_is_regex,
            sort_state: options.table_sort_state_ref.current,
          },
          {
            force: true,
          },
        )
        .catch((error) => {
          options.report_proofreading_list_error(
            error,
            options.t("proofreading_page.feedback.refresh_failed"),
          );
        });
    },
    [options],
  );

  const apply_table_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      options.set_table_selection_state({
        selected_row_ids: payload.selected_row_ids,
        active_row_id: payload.active_row_id,
        anchor_row_id: payload.anchor_row_id,
      });
    },
    [options],
  );

  const apply_table_sort_state = useCallback(
    (next_sort_state: AppTableSortState | null): void => {
      options.cancel_pending_list_view_query();
      options.visible_range_ref.current = null;
      options.set_table_sort_state(next_sort_state);
      options.clear_table_selection();
      void options
        .run_list_view_query(
          {
            filters: options.resolve_current_filters(),
            keyword: options.table_filter_state_ref.current.search_keyword,
            scope: options.table_filter_state_ref.current.search_scope,
            is_regex: options.table_filter_state_ref.current.is_regex,
            sort_state: next_sort_state,
          },
          {
            force: true,
          },
        )
        .catch((error) => {
          options.report_proofreading_list_error(
            error,
            options.t("proofreading_page.feedback.refresh_failed"),
          );
        });
    },
    [options],
  );

  const get_visible_row_at_index = useCallback(
    (index: number): ProofreadingVisibleItem | undefined => {
      const window_index = index - options.list_view.window_start;
      if (window_index < 0 || window_index >= options.visible_items.length) {
        return undefined;
      }

      return options.visible_items[window_index];
    },
    [options],
  );

  const get_visible_row_id_at_index = useCallback(
    (index: number): string | undefined => {
      return get_visible_row_at_index(index)?.row_id;
    },
    [get_visible_row_at_index],
  );

  const resolve_visible_row_index = useCallback(
    (row_id: string): number | undefined => {
      return options.visible_row_index_by_id.get(row_id);
    },
    [options],
  );

  const resolve_visible_row_index_async = useCallback(
    async (row_id: string): Promise<number | undefined> => {
      const visible_row_index = options.visible_row_index_by_id.get(row_id);
      if (visible_row_index !== undefined) {
        return visible_row_index;
      }

      if (options.list_view.view_id === "" || options.list_view.row_count <= 0) {
        return undefined;
      }

      return await options.proofreading_runtime_client_ref.current.resolve_proofreading_row_index({
        view_id: options.list_view.view_id,
        row_id,
      });
    },
    [options],
  );

  const read_visible_range = useCallback(
    (range: { start: number; count: number }): void => {
      options.visible_range_ref.current = {
        start: range.start,
        count: range.count,
      };
      void options.read_list_window(range).catch((error) => {
        options.report_proofreading_list_error(
          error,
          options.t("proofreading_page.feedback.refresh_failed"),
        );
      });
    },
    [options],
  );

  const resolve_visible_row_ids_range = useCallback(
    async (range: { start: number; count: number }): Promise<string[]> => {
      return await options.read_current_view_row_ids(range.start, range.count);
    },
    [options],
  );

  const handle_table_selection_error = useCallback(
    (error: unknown): void => {
      options.report_proofreading_list_error(
        error,
        options.t("proofreading_page.feedback.selection_failed"),
      );
    },
    [options],
  );

  const open_filter_dialog = useCallback((): void => {
    if (options.cache_status !== "ready" || options.is_refreshing) {
      options.set_filter_dialog_open(false);
      options.filter_dialog_open_ref.current = false;
      return;
    }

    const next_dialog_filters = options.resolve_current_filters();
    options.set_filter_dialog_filters(next_dialog_filters);
    options.filter_dialog_filters_ref.current = next_dialog_filters;
    options.set_filter_dialog_open(true);
    options.filter_dialog_open_ref.current = true;
  }, [options]);

  const close_filter_dialog = useCallback((): void => {
    options.filter_panel_query_scheduler.cancel();
    options.set_filter_dialog_open(false);
    options.filter_dialog_open_ref.current = false;
    const restored_filters = options.resolve_current_filters();
    options.set_filter_dialog_filters(restored_filters);
    options.filter_dialog_filters_ref.current = restored_filters;
    void options
      .run_filter_panel_query(restored_filters, {
        force: true,
        mark_loading: false,
      })
      .catch((error) => {
        options.report_proofreading_list_error(
          error,
          options.t("proofreading_page.feedback.refresh_failed"),
        );
      });
  }, [options]);

  const update_filter_dialog_filters = useCallback(
    (next_filters: ProofreadingFilterOptions): void => {
      const cloned_filters = clone_proofreading_filter_options(next_filters);
      options.set_filter_dialog_filters(cloned_filters);
      options.filter_dialog_filters_ref.current = cloned_filters;

      if (
        options.filter_dialog_open &&
        options.cache_status === "ready" &&
        options.sync_state_ref.current !== null
      ) {
        options.filter_panel_query_scheduler.schedule(cloned_filters);
      }
    },
    [options],
  );

  const confirm_filter_dialog_filters = useCallback(async (): Promise<void> => {
    const sync_state = options.sync_state_ref.current;
    if (
      !options.project_loaded ||
      options.cache_status !== "ready" ||
      options.is_refreshing ||
      sync_state === null
    ) {
      return;
    }

    const normalized_filters = clone_proofreading_filter_options(
      options.filter_dialog_filters_ref.current,
    );
    // 筛选弹窗只编辑物化后的勾选值，确认时要恢复意图，未改动维度继续跟随默认筛选。
    const next_filter_selection = resolve_proofreading_filter_selection_from_filters({
      filters: normalized_filters,
      default_filters: sync_state.defaultFilters,
    });
    options.preferred_row_id_ref.current = null;
    options.should_select_first_visible_ref.current = false;
    options.visible_range_ref.current = null;
    options.cancel_pending_list_view_query();
    options.filter_panel_query_scheduler.cancel();
    options.set_table_filter_state({
      selection: next_filter_selection,
    });
    options.clear_table_selection();
    options.set_filter_dialog_filters(clone_proofreading_filter_options(normalized_filters));
    options.filter_dialog_filters_ref.current =
      clone_proofreading_filter_options(normalized_filters);

    try {
      await options.settle_list_view_and_filter_panel({
        filters: normalized_filters,
        keyword: options.table_filter_state_ref.current.search_keyword,
        scope: options.table_filter_state_ref.current.search_scope,
        is_regex: options.table_filter_state_ref.current.is_regex,
        sort_state: options.table_sort_state_ref.current,
        force: true,
      });
    } catch (error) {
      options.report_proofreading_list_error(
        error,
        options.t("proofreading_page.feedback.refresh_failed"),
      );
    } finally {
      options.set_filter_dialog_open(false);
      options.filter_dialog_open_ref.current = false;
    }
  }, [options]);

  return {
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
    read_visible_range,
    resolve_visible_row_ids_range,
    handle_table_selection_error,
    open_filter_dialog,
    close_filter_dialog,
    update_filter_dialog_filters,
    confirm_filter_dialog_filters,
  };
}
