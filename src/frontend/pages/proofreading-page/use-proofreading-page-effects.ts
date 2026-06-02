import { useEffect, type MutableRefObject, type SetStateAction } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import type { ProofreadingViewFilterState } from "@frontend/pages/proofreading-page/proofreading-filter-state";
import {
  resolve_list_view_window_bounds,
  type ProofreadingListQueryInput,
  type ProofreadingListWindowBounds,
  type ProofreadingRefreshSignal,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import type {
  ProofreadingFilterOptions,
  ProofreadingListView,
  ProofreadingSearchScope,
} from "@shared/proofreading/proofreading-types";

type DesktopToastId = string | number;

type ProgressToastOptions = {
  message: string;
  progress_percent?: number;
  presentation?: "inline" | "modal";
};

type ProofreadingLookupIntent = {
  keyword: string;
  is_regex: boolean;
};

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type TableSelectionState = {
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
};

type UseProofreadingPageEffectsOptions = {
  current_filter_signature: string;
  filter_dialog_filters: ProofreadingFilterOptions;
  filter_dialog_open: boolean;
  is_regex: boolean;
  list_view: ProofreadingListView;
  loading_toast_visible: boolean;
  project_loaded: boolean;
  project_path: string;
  proofreading_change_signal: ProofreadingRefreshSignal | null;
  proofreading_lookup_intent: ProofreadingLookupIntent | null;
  refresh_retry_nonce: number;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  sort_signature: string;
  visible_row_ids: string[];
  consumed_refresh_retry_nonce_ref: MutableRefObject<number>;
  filter_dialog_filters_ref: MutableRefObject<ProofreadingFilterOptions>;
  filter_dialog_open_ref: MutableRefObject<boolean>;
  filter_panel_request_id_ref: MutableRefObject<number>;
  list_view_ref: MutableRefObject<ProofreadingListView>;
  list_view_request_id_ref: MutableRefObject<number>;
  list_window_bounds_ref: MutableRefObject<ProofreadingListWindowBounds>;
  list_window_request_id_ref: MutableRefObject<number>;
  loading_toast_id_ref: MutableRefObject<DesktopToastId | null>;
  pending_replace_cursor_ref: MutableRefObject<number | null>;
  pending_reset_filters_ref: MutableRefObject<boolean>;
  preferred_row_id_ref: MutableRefObject<string | null>;
  previous_project_loaded_ref: MutableRefObject<boolean>;
  previous_project_path_ref: MutableRefObject<string>;
  previous_proofreading_change_seq_ref: MutableRefObject<number>;
  proofreading_runtime_client_ref: MutableRefObject<ProofreadingApiClient>;
  replace_cursor_ref: MutableRefObject<number>;
  restored_ui_state_ref: MutableRefObject<boolean>;
  should_select_first_visible_ref: MutableRefObject<boolean>;
  table_sort_state_ref: MutableRefObject<AppTableSortState | null>;
  visible_range_ref: MutableRefObject<ProofreadingListWindowBounds | null>;
  apply_preferred_row_focus: (preferred_row_id: string) => void;
  cancel_pending_list_view_query: () => void;
  clear_cache_state: () => void;
  clear_proofreading_lookup_intent: () => void;
  clear_table_selection: () => void;
  clear_transient_state_for_new_project: () => void;
  dismiss_toast: (toast_id?: DesktopToastId) => void;
  push_progress_toast: (options: ProgressToastOptions) => DesktopToastId;
  refresh_snapshot: () => Promise<void>;
  report_proofreading_list_error: (error: unknown, fallback_message: string) => boolean;
  resolve_current_filters: () => ProofreadingFilterOptions;
  resolve_disposable_project_id: () => string | null;
  run_list_view_query: (
    args: ProofreadingListQueryInput,
    options?: { force?: boolean },
  ) => Promise<ProofreadingListView | null>;
  set_cache_status: (value: SetStateAction<"idle" | "refreshing" | "ready" | "error">) => void;
  set_table_selection_state: (payload: TableSelectionState) => void;
  update_table_filter_state: (
    patch: Partial<ProofreadingViewFilterState>,
    options?: { persist?: boolean },
  ) => void;
  t: LocaleTextResolver;
};

export function useProofreadingPageEffects(options: UseProofreadingPageEffectsOptions): void {
  const {
    current_filter_signature,
    filter_dialog_filters,
    filter_dialog_open,
    is_regex,
    list_view,
    loading_toast_visible,
    project_loaded,
    project_path,
    proofreading_change_signal,
    proofreading_lookup_intent,
    refresh_retry_nonce,
    search_keyword,
    search_scope,
    sort_signature,
    visible_row_ids,
    consumed_refresh_retry_nonce_ref,
    filter_dialog_filters_ref,
    filter_dialog_open_ref,
    filter_panel_request_id_ref,
    list_view_ref,
    list_view_request_id_ref,
    list_window_bounds_ref,
    list_window_request_id_ref,
    loading_toast_id_ref,
    pending_replace_cursor_ref,
    pending_reset_filters_ref,
    preferred_row_id_ref,
    previous_project_loaded_ref,
    previous_project_path_ref,
    previous_proofreading_change_seq_ref,
    proofreading_runtime_client_ref,
    replace_cursor_ref,
    restored_ui_state_ref,
    should_select_first_visible_ref,
    table_sort_state_ref,
    visible_range_ref,
    apply_preferred_row_focus,
    cancel_pending_list_view_query,
    clear_cache_state,
    clear_proofreading_lookup_intent,
    clear_table_selection,
    clear_transient_state_for_new_project,
    dismiss_toast,
    push_progress_toast,
    refresh_snapshot,
    report_proofreading_list_error,
    resolve_current_filters,
    resolve_disposable_project_id,
    run_list_view_query,
    set_cache_status,
    set_table_selection_state,
    update_table_filter_state,
    t,
  } = options;

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
  }, [
    filter_panel_request_id_ref,
    list_view_request_id_ref,
    list_window_request_id_ref,
    proofreading_runtime_client_ref,
    resolve_disposable_project_id,
  ]);

  useEffect(() => {
    filter_dialog_filters_ref.current = filter_dialog_filters;
  }, [filter_dialog_filters, filter_dialog_filters_ref]);

  useEffect(() => {
    filter_dialog_open_ref.current = filter_dialog_open;
  }, [filter_dialog_open, filter_dialog_open_ref]);

  useEffect(() => {
    list_view_ref.current = list_view;
    list_window_bounds_ref.current = resolve_list_view_window_bounds(list_view);
  }, [list_view, list_view_ref, list_window_bounds_ref]);

  // refresh_retry_nonce effect 负责把 catch 分支里的重试信号接回刷新主链路。
  useEffect(() => {
    if (
      refresh_retry_nonce === 0 ||
      refresh_retry_nonce === consumed_refresh_retry_nonce_ref.current ||
      !project_loaded
    ) {
      return;
    }

    consumed_refresh_retry_nonce_ref.current = refresh_retry_nonce;
    void refresh_snapshot();
  }, [consumed_refresh_retry_nonce_ref, project_loaded, refresh_retry_nonce, refresh_snapshot]);

  useEffect(() => {
    // 校对页首刷可能较久，刷新态用模态进度提示阻止用户误以为页面卡死。
    if (!project_loaded || !loading_toast_visible) {
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
  }, [
    dismiss_toast,
    loading_toast_id_ref,
    loading_toast_visible,
    project_loaded,
    push_progress_toast,
    t,
  ]);

  useEffect(() => {
    return () => {
      const toast_id = loading_toast_id_ref.current;
      if (toast_id === null) {
        return;
      }

      loading_toast_id_ref.current = null;
      dismiss_toast(toast_id);
    };
  }, [dismiss_toast, loading_toast_id_ref]);

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_loaded;
    previous_project_path_ref.current = project_path;

    if (!project_loaded) {
      if (previous_project_loaded || previous_project_path !== "") {
        clear_transient_state_for_new_project();
        clear_cache_state();
        set_cache_status("idle");
      }
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_path) {
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
    pending_reset_filters_ref,
    previous_project_loaded_ref,
    previous_project_path_ref,
    previous_proofreading_change_seq_ref,
    project_loaded,
    project_path,
    proofreading_change_signal,
    refresh_snapshot,
    restored_ui_state_ref,
    set_cache_status,
  ]);

  useEffect(() => {
    const previous_seq = previous_proofreading_change_seq_ref.current;

    if (!project_loaded || proofreading_change_signal === null) {
      return;
    }

    if (previous_seq !== proofreading_change_signal.seq) {
      previous_proofreading_change_seq_ref.current = proofreading_change_signal.seq;
      void refresh_snapshot();
    }
  }, [
    previous_proofreading_change_seq_ref,
    project_loaded,
    proofreading_change_signal,
    refresh_snapshot,
  ]);

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
    cancel_pending_list_view_query,
    clear_proofreading_lookup_intent,
    clear_table_selection,
    proofreading_lookup_intent,
    report_proofreading_list_error,
    resolve_current_filters,
    run_list_view_query,
    should_select_first_visible_ref,
    table_sort_state_ref,
    t,
    update_table_filter_state,
    visible_range_ref,
  ]);

  useEffect(() => {
    if (pending_replace_cursor_ref.current !== null) {
      replace_cursor_ref.current = pending_replace_cursor_ref.current;
      pending_replace_cursor_ref.current = null;
      return;
    }

    replace_cursor_ref.current = 0;
  }, [
    current_filter_signature,
    is_regex,
    pending_replace_cursor_ref,
    replace_cursor_ref,
    search_keyword,
    search_scope,
    sort_signature,
  ]);

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
      }
    }
  }, [
    apply_preferred_row_focus,
    preferred_row_id_ref,
    set_table_selection_state,
    should_select_first_visible_ref,
    visible_row_ids,
  ]);
}
