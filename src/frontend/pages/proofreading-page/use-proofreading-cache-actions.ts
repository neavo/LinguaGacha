import {
  startTransition,
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import {
  clone_proofreading_filter_options,
  type ProofreadingClientItem,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingListView,
  type ProofreadingSearchScope,
} from "@shared/proofreading/proofreading-types";
import type {
  ProofreadingListWindow,
  ProofreadingSyncState,
} from "@shared/proofreading/proofreading-list-reader";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import {
  clone_proofreading_filter_selection,
  create_default_proofreading_filter_selection,
  materialize_proofreading_filters,
  type ProofreadingViewFilterState,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import {
  PROOFREADING_INITIAL_WINDOW_ROWS,
  build_filter_panel_signature,
  build_list_query_signature,
  build_refreshed_proofreading_list_view,
  build_sync_list_query_signature,
  is_missing_refreshed_list_window,
  resolve_list_view_window_bounds,
  resolve_prefetched_list_window_bounds,
  resolve_requested_sync_mode,
  type ProofreadingListQueryInput,
  type ProofreadingListWindowBounds,
  type ProofreadingRefreshSignal,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type UseProofreadingCacheActionsOptions = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  filter_panel: ProofreadingFilterPanelState;
  list_view: ProofreadingListView;
  project_loaded: boolean;
  project_path: string;
  proofreading_change_signal: ProofreadingRefreshSignal | null;
  source_language: string;
  target_language: string;
  defaultFiltersRef: MutableRefObject<ProofreadingFilterOptions>;
  filter_dialog_filters_ref: MutableRefObject<ProofreadingFilterOptions>;
  filter_dialog_open_ref: MutableRefObject<boolean>;
  filter_panel_request_id_ref: MutableRefObject<number>;
  last_filter_panel_signature_ref: MutableRefObject<string>;
  last_list_query_signature_ref: MutableRefObject<string>;
  last_visible_range_signature_ref: MutableRefObject<string>;
  list_view_ref: MutableRefObject<ProofreadingListView>;
  list_view_request_id_ref: MutableRefObject<number>;
  list_window_bounds_ref: MutableRefObject<ProofreadingListWindowBounds>;
  list_window_request_id_ref: MutableRefObject<number>;
  pending_reset_filters_ref: MutableRefObject<boolean>;
  proofreading_runtime_client_ref: MutableRefObject<ProofreadingApiClient>;
  refresh_generation_ref: MutableRefObject<number>;
  sync_state_ref: MutableRefObject<ProofreadingSyncState | null>;
  table_filter_state_ref: MutableRefObject<ProofreadingViewFilterState>;
  table_sort_state_ref: MutableRefObject<AppTableSortState | null>;
  visible_range_ref: MutableRefObject<ProofreadingListWindowBounds | null>;
  clear_cache_state: () => void;
  clear_transient_state_for_new_project: () => void;
  invalidate_cache_bound_queries: () => void;
  publish_refresh_scroll_anchor: () => void;
  report_proofreading_list_error: (error: unknown, fallback_message: string) => boolean;
  resolve_current_filters: () => ProofreadingFilterOptions;
  set_cache_status: Dispatch<SetStateAction<"idle" | "refreshing" | "ready" | "error">>;
  set_list_revisions: Dispatch<SetStateAction<ProjectDataSectionRevisions>>; // 列表内写入锁
  set_operation_revisions: Dispatch<SetStateAction<ProjectDataSectionRevisions>>; // 任务命令锁
  set_filter_dialog_filters: Dispatch<SetStateAction<ProofreadingFilterOptions>>;
  set_filter_dialog_open: Dispatch<SetStateAction<boolean>>;
  set_filter_panel: Dispatch<SetStateAction<ProofreadingFilterPanelState>>;
  set_filter_panel_loading: Dispatch<SetStateAction<boolean>>;
  set_is_refreshing: Dispatch<SetStateAction<boolean>>;
  set_list_view: Dispatch<SetStateAction<ProofreadingListView>>;
  set_loading_toast_visible: Dispatch<SetStateAction<boolean>>;
  set_refresh_retry_nonce: Dispatch<SetStateAction<number>>;
  set_settled_project_path: Dispatch<SetStateAction<string>>;
  update_table_filter_state: (
    patch: Partial<ProofreadingViewFilterState>,
    options?: { persist?: boolean },
  ) => void;
  warm_filter_panel_query_ref: MutableRefObject<(filters: ProofreadingFilterOptions) => void>;
  t: LocaleTextResolver;
};

type UseProofreadingCacheActionsResult = {
  refresh_snapshot: () => Promise<void>;
  run_list_view_query: (
    args: ProofreadingListQueryInput,
    options?: {
      force?: boolean;
      stale_key?: string | null;
      window_bounds?: ProofreadingListWindowBounds;
    },
  ) => Promise<ProofreadingListView | null>;
  run_filter_panel_query: (
    filters: ProofreadingFilterOptions,
    options?: {
      force?: boolean;
      mark_loading?: boolean;
    },
  ) => Promise<ProofreadingFilterPanelState | null>;
  read_list_window: (range: {
    start: number;
    count: number;
  }) => Promise<ProofreadingListWindow | null>;
  settle_list_view_and_filter_panel: (args: {
    filters: ProofreadingFilterOptions;
    keyword: string;
    scope: ProofreadingSearchScope;
    is_regex: boolean;
    sort_state: AppTableSortState | null;
    force?: boolean;
  }) => Promise<boolean>;
  read_items_by_row_ids: (row_ids: string[]) => Promise<ProofreadingClientItem[]>;
  read_current_view_row_ids: (start: number, count: number) => Promise<string[]>;
};

function is_stale_proofreading_list_error(_error: unknown): boolean {
  return false;
}

export function useProofreadingCacheActions(
  options: UseProofreadingCacheActionsOptions,
): UseProofreadingCacheActionsResult {
  const run_list_view_query = useCallback(
    async (
      args: ProofreadingListQueryInput,
      query_options?: {
        force?: boolean;
        stale_key?: string | null;
        window_bounds?: ProofreadingListWindowBounds;
      },
    ) => {
      const sync_state = options.sync_state_ref.current;
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
      if (
        !query_options?.force &&
        query_signature === options.last_list_query_signature_ref.current
      ) {
        return options.list_view;
      }

      options.list_view_request_id_ref.current += 1;
      const request_id = options.list_view_request_id_ref.current;
      let next_list_view: ProofreadingListView;
      try {
        const list_view_query = {
          filters: args.filters,
          keyword: args.keyword,
          scope: args.scope,
          is_regex: args.is_regex,
          sort_state: args.sort_state,
          window_start: query_options?.window_bounds?.start ?? 0,
          window_count: query_options?.window_bounds?.count ?? PROOFREADING_INITIAL_WINDOW_ROWS,
        };
        next_list_view =
          query_options?.stale_key === undefined
            ? await options.proofreading_runtime_client_ref.current.build_proofreading_list_view(
                list_view_query,
              )
            : await options.proofreading_runtime_client_ref.current.build_proofreading_list_view(
                list_view_query,
                {
                  staleKey: query_options.stale_key,
                },
              );
      } catch (error) {
        if (
          request_id !== options.list_view_request_id_ref.current ||
          is_stale_proofreading_list_error(error)
        ) {
          return null;
        }

        throw error;
      }
      if (request_id !== options.list_view_request_id_ref.current) {
        return null;
      }

      options.last_list_query_signature_ref.current = query_signature;
      options.list_view_ref.current = next_list_view;
      options.list_window_bounds_ref.current = resolve_list_view_window_bounds(next_list_view);
      startTransition(() => {
        options.set_list_view(next_list_view);
      });
      return next_list_view;
    },
    [options],
  );

  const run_filter_panel_query = useCallback(
    async (
      filters: ProofreadingFilterOptions,
      query_options?: {
        force?: boolean;
        mark_loading?: boolean;
      },
    ) => {
      const sync_state = options.sync_state_ref.current;
      if (sync_state === null) {
        return null;
      }

      const query_signature = build_filter_panel_signature({
        revisions: sync_state.revisions,
        filters,
      });
      if (
        !query_options?.force &&
        query_signature === options.last_filter_panel_signature_ref.current
      ) {
        return options.filter_panel;
      }

      options.filter_panel_request_id_ref.current += 1;
      const request_id = options.filter_panel_request_id_ref.current;
      if (query_options?.mark_loading !== false) {
        options.set_filter_panel_loading(true);
      }

      try {
        let next_filter_panel: ProofreadingFilterPanelState;
        try {
          next_filter_panel =
            await options.proofreading_runtime_client_ref.current.build_proofreading_filter_panel({
              filters,
            });
        } catch (error) {
          if (
            request_id !== options.filter_panel_request_id_ref.current ||
            is_stale_proofreading_list_error(error)
          ) {
            return null;
          }

          throw error;
        }
        if (request_id !== options.filter_panel_request_id_ref.current) {
          return null;
        }

        options.last_filter_panel_signature_ref.current = query_signature;
        startTransition(() => {
          options.set_filter_panel(next_filter_panel);
        });
        return next_filter_panel;
      } finally {
        if (request_id === options.filter_panel_request_id_ref.current) {
          options.set_filter_panel_loading(false);
        }
      }
    },
    [options],
  );

  const read_list_window = useCallback(
    async (range: { start: number; count: number }): Promise<ProofreadingListWindow | null> => {
      if (
        options.list_view.view_id === "" ||
        options.list_view.row_count <= 0 ||
        range.count <= 0
      ) {
        return null;
      }

      const window_bounds = resolve_prefetched_list_window_bounds({
        range,
        row_count: options.list_view.row_count,
      });
      const range_signature = `${options.list_view.view_id}:${window_bounds.start}:${window_bounds.count}`;
      if (range_signature === options.last_visible_range_signature_ref.current) {
        return null;
      }

      options.last_visible_range_signature_ref.current = range_signature;
      options.list_window_request_id_ref.current += 1;
      const request_id = options.list_window_request_id_ref.current;
      let next_window: ProofreadingListWindow;
      try {
        next_window =
          await options.proofreading_runtime_client_ref.current.read_proofreading_list_window({
            view_id: options.list_view.view_id,
            start: window_bounds.start,
            count: window_bounds.count,
          });
      } catch (error) {
        if (is_stale_proofreading_list_error(error)) {
          if (request_id === options.list_window_request_id_ref.current) {
            options.last_visible_range_signature_ref.current = "";
          }
          return null;
        }

        if (request_id !== options.list_window_request_id_ref.current) {
          return null;
        }

        options.last_visible_range_signature_ref.current = "";
        throw error;
      }
      if (request_id !== options.list_window_request_id_ref.current) {
        return null;
      }

      if (next_window.view_id !== options.list_view.view_id) {
        return null;
      }

      options.list_view_ref.current = {
        ...options.list_view_ref.current,
        row_count: next_window.row_count,
        window_start: next_window.start,
        window_rows: next_window.rows,
      };
      startTransition(() => {
        options.set_list_view((previous_view) => {
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
      options.list_window_bounds_ref.current = {
        start: next_window.start,
        count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, next_window.rows.length),
      };
      return next_window;
    },
    [options],
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
        options.list_view.window_rows.map((visible_item) => {
          return [visible_item.row_id, visible_item.item] as const;
        }),
      );
      const missing_row_ids = row_ids.filter((row_id) => {
        return !items_by_row_id.has(row_id);
      });
      if (missing_row_ids.length > 0) {
        const fetched_items =
          await options.proofreading_runtime_client_ref.current.read_proofreading_items_by_row_ids({
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
    [options],
  );

  const read_current_view_row_ids = useCallback(
    async (start: number, count: number): Promise<string[]> => {
      if (options.list_view.view_id === "" || count <= 0) {
        return [];
      }

      return await options.proofreading_runtime_client_ref.current.read_proofreading_row_ids_range({
        view_id: options.list_view.view_id,
        start,
        count,
      });
    },
    [options],
  );

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    if (!options.project_loaded) {
      options.clear_transient_state_for_new_project();
      options.clear_cache_state();
      return;
    }

    const request_id = options.refresh_generation_ref.current + 1;
    options.refresh_generation_ref.current = request_id;
    let retry_after_stale = false;

    try {
      const previous_sync_state = options.sync_state_ref.current;
      const sync_mode = resolve_requested_sync_mode({
        cache_status: options.cache_status,
        sync_state: previous_sync_state,
        project_path: options.project_path,
        sourceLanguage: options.source_language,
        targetLanguage: options.target_language,
        signal_mode: options.proofreading_change_signal?.mode ?? "full",
      });
      let sync_state = previous_sync_state;
      if (sync_mode === "noop") {
        if (request_id !== options.refresh_generation_ref.current || sync_state === null) {
          return;
        }

        options.set_cache_status("ready");
        options.set_is_refreshing(false);
        options.set_settled_project_path(options.project_path);
        return;
      }
      const previous_list_view = options.list_view_ref.current;
      const previous_current_filters = options.resolve_current_filters();
      const previous_list_query: ProofreadingListQueryInput = {
        filters: previous_current_filters,
        keyword: options.table_filter_state_ref.current.search_keyword,
        scope: options.table_filter_state_ref.current.search_scope,
        is_regex: options.table_filter_state_ref.current.is_regex,
        sort_state: options.table_sort_state_ref.current,
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
        previous_list_query_signature === options.last_list_query_signature_ref.current;
      const can_reuse_current_view_base =
        sync_mode === "delta" &&
        options.cache_status === "ready" &&
        previous_sync_state !== null &&
        previous_sync_state.projectId === options.project_path &&
        previous_sync_state.sourceLanguage === options.source_language &&
        previous_sync_state.targetLanguage === options.target_language &&
        previous_list_view.view_id !== "";

      options.invalidate_cache_bound_queries();
      if (sync_mode === "full") {
        options.set_filter_panel_loading(false);
        options.set_filter_dialog_open(false);
        options.filter_dialog_open_ref.current = false;
      }
      options.set_is_refreshing(true);
      options.set_cache_status("refreshing");
      options.set_loading_toast_visible(sync_mode === "full");

      if (sync_mode === "full") {
        options.sync_state_ref.current = null;
      }
      const sync_snapshot =
        await options.proofreading_runtime_client_ref.current.sync_proofreading_cache({
          sourceLanguage: options.source_language,
          targetLanguage: options.target_language,
        });
      sync_state = sync_snapshot.syncState;

      if (request_id !== options.refresh_generation_ref.current || sync_state === null) {
        return;
      }

      const nextDefaultFilters = clone_proofreading_filter_options(sync_state.defaultFilters);
      const next_filter_selection = options.pending_reset_filters_ref.current
        ? create_default_proofreading_filter_selection(nextDefaultFilters)
        : clone_proofreading_filter_selection(options.table_filter_state_ref.current.selection);
      const next_current_filters = materialize_proofreading_filters(
        next_filter_selection,
        nextDefaultFilters,
      );
      const next_list_query: ProofreadingListQueryInput = {
        filters: next_current_filters,
        keyword: options.table_filter_state_ref.current.search_keyword,
        scope: options.table_filter_state_ref.current.search_scope,
        is_regex: options.table_filter_state_ref.current.is_regex,
        sort_state: options.table_sort_state_ref.current,
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
        ? options.visible_range_ref.current === null
          ? options.list_window_bounds_ref.current
          : resolve_prefetched_list_window_bounds({
              range: options.visible_range_ref.current,
              row_count: options.list_view_ref.current.row_count,
            })
        : undefined;
      if (can_reuse_current_view) {
        options.publish_refresh_scroll_anchor();
      }

      options.sync_state_ref.current = sync_state;
      options.defaultFiltersRef.current = clone_proofreading_filter_options(nextDefaultFilters);
      options.update_table_filter_state(
        {
          selection: next_filter_selection,
        },
        {
          persist: false,
        },
      );
      if (sync_mode !== "delta" || !options.filter_dialog_open_ref.current) {
        const next_dialog_filters = clone_proofreading_filter_options(next_current_filters);
        options.set_filter_dialog_filters(next_dialog_filters);
        options.filter_dialog_filters_ref.current = next_dialog_filters;
      }

      let next_list_view: ProofreadingListView | null = null;
      let should_build_list_view = true;
      if (can_reuse_current_view && refresh_window_bounds !== undefined) {
        const next_window =
          await options.proofreading_runtime_client_ref.current.read_proofreading_list_window({
            view_id: previous_list_view.view_id,
            start: refresh_window_bounds.start,
            count: refresh_window_bounds.count,
          });
        if (request_id !== options.refresh_generation_ref.current) {
          return;
        }

        if (
          next_window.view_id === previous_list_view.view_id &&
          options.list_view_ref.current.view_id === previous_list_view.view_id &&
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
          options.last_list_query_signature_ref.current = build_sync_list_query_signature({
            sync_state,
            query: next_list_query,
          });
          options.list_view_ref.current = next_list_view;
          options.list_window_bounds_ref.current = {
            start: next_window.start,
            count: Math.max(PROOFREADING_INITIAL_WINDOW_ROWS, next_window.rows.length),
          };
          options.last_visible_range_signature_ref.current = `${next_window.view_id}:${refresh_window_bounds.start}:${refresh_window_bounds.count}`;
          startTransition(() => {
            options.set_list_view((current_view) => {
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
      if (request_id !== options.refresh_generation_ref.current) {
        return;
      }

      if (next_list_view !== null) {
        options.warm_filter_panel_query_ref.current(next_current_filters);
      }
      options.set_cache_status("ready");
      // syncState.revisions 维持列表缓存身份，顶层 sectionRevisions 维持写入和任务命令锁。
      options.set_list_revisions(sync_state.revisions);
      options.set_operation_revisions(sync_snapshot.sectionRevisions);
      options.set_settled_project_path(options.project_path);
    } catch (error) {
      if (request_id !== options.refresh_generation_ref.current) {
        return;
      }

      if (is_stale_proofreading_list_error(error)) {
        retry_after_stale = options.project_loaded;
        if (retry_after_stale) {
          options.set_refresh_retry_nonce((previous_nonce) => previous_nonce + 1);
        }
        return;
      }

      const reported = options.report_proofreading_list_error(
        error,
        options.t("proofreading_page.feedback.refresh_failed"),
      );
      if (!reported) {
        return;
      }

      options.set_cache_status("error");
      options.set_settled_project_path(options.project_path);
    } finally {
      if (!retry_after_stale) {
        options.pending_reset_filters_ref.current = false;
      }
      if (request_id === options.refresh_generation_ref.current) {
        if (!retry_after_stale) {
          options.set_loading_toast_visible(false);
          options.set_is_refreshing(false);
        }
      }
    }
  }, [options, run_list_view_query]);

  return {
    refresh_snapshot,
    run_list_view_query,
    run_filter_panel_query,
    read_list_window,
    settle_list_view_and_filter_panel,
    read_items_by_row_ids,
    read_current_view_row_ids,
  };
}
