import { useEffect, type MutableRefObject, type SetStateAction } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { ProofreadingLookupIntent } from "@frontend/app/navigation/types";
import type { ProofreadingViewFilterState } from "@frontend/pages/proofreading-page/proofreading-filter-state";
import { create_default_proofreading_filter_selection } from "@frontend/pages/proofreading-page/proofreading-filter-state";
import {
  resolve_list_view_window_bounds,
  type ProofreadingListSnapshot,
  type ProofreadingListWindowBounds,
  type ProofreadingRefreshSignal,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";
import type {
  ProofreadingFilterOptions,
  ProofreadingListView,
} from "@shared/proofreading/proofreading-types";

type DesktopToastId = string | number;

type ProgressToastOptions = {
  message: string;
  progress_percent?: number;
  presentation?: "inline" | "modal";
};

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type TableSelectionState = {
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
};

type UseProofreadingPageEffectsOptions = {
  current_query_intent_key: string;
  filter_dialog_filters: ProofreadingFilterOptions;
  filter_dialog_open: boolean;
  list_snapshot: ProofreadingListSnapshot;
  loading_toast_visible: boolean;
  project_loaded: boolean;
  project_path: string;
  proofreading_change_signal: ProofreadingRefreshSignal | null;
  proofreading_lookup_intent: ProofreadingLookupIntent | null;
  visible_row_ids: string[];
  filter_dialog_filters_ref: MutableRefObject<ProofreadingFilterOptions>;
  filter_dialog_open_ref: MutableRefObject<boolean>;
  filter_panel_request_id_ref: MutableRefObject<number>;
  list_snapshot_ref: MutableRefObject<ProofreadingListSnapshot>;
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
  replace_cursor_ref: MutableRefObject<number>;
  restored_ui_state_ref: MutableRefObject<boolean>;
  should_select_first_visible_ref: MutableRefObject<boolean>;
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
  run_list_view_query: (options?: { rebuild?: boolean }) => Promise<ProofreadingListView | null>;
  set_cache_status: (value: SetStateAction<"idle" | "refreshing" | "ready" | "error">) => void;
  set_table_selection_state: (payload: TableSelectionState) => void;
  update_table_filter_state: (
    patch: Partial<ProofreadingViewFilterState>,
    options?: { persist?: boolean },
  ) => void;
  t: LocaleTextResolver;
};

/**
 * 绑定校对页的项目生命周期、外部变更、导航意图和一次性 UI 恢复副作用。
 */
export function useProofreadingPageEffects(options: UseProofreadingPageEffectsOptions): void {
  const {
    current_query_intent_key,
    filter_dialog_filters,
    filter_dialog_open,
    list_snapshot,
    loading_toast_visible,
    project_loaded,
    project_path,
    proofreading_change_signal,
    proofreading_lookup_intent,
    visible_row_ids,
    filter_dialog_filters_ref,
    filter_dialog_open_ref,
    filter_panel_request_id_ref,
    list_snapshot_ref,
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
    replace_cursor_ref,
    restored_ui_state_ref,
    should_select_first_visible_ref,
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
    run_list_view_query,
    set_cache_status,
    set_table_selection_state,
    update_table_filter_state,
    t,
  } = options;

  // 页面卸载时失效在途请求，防止旧响应回写下一次页面实例。
  useEffect(() => {
    return () => {
      list_view_request_id_ref.current += 1;
      list_window_request_id_ref.current += 1;
      filter_panel_request_id_ref.current += 1;
    };
  }, [filter_panel_request_id_ref, list_view_request_id_ref, list_window_request_id_ref]);

  // 异步查询读取 ref；state 提交后同步最新筛选草稿。
  useEffect(() => {
    filter_dialog_filters_ref.current = filter_dialog_filters;
  }, [filter_dialog_filters, filter_dialog_filters_ref]);

  // 异步刷新读取 ref；弹窗开关必须与渲染态保持一致。
  useEffect(() => {
    filter_dialog_open_ref.current = filter_dialog_open;
  }, [filter_dialog_open, filter_dialog_open_ref]);

  // view 与查询意图必须作为同一快照同步，窗口边界也从该快照派生。
  useEffect(() => {
    list_snapshot_ref.current = list_snapshot;
    list_window_bounds_ref.current = resolve_list_view_window_bounds(list_snapshot.view);
  }, [list_snapshot, list_snapshot_ref, list_window_bounds_ref]);

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

  // 独立清理 toast，覆盖页面卸载早于刷新 finally 的路径。
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

  // 项目身份切换负责清空旧缓存；session 恢复时保留用户查询意图。
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

  // 同一项目内只按单调 change seq 消费刷新信号。
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

  // 导航查找意图先写入共享表格状态，再由统一 list query 读取最新 ref。
  useEffect(() => {
    if (proofreading_lookup_intent === null) {
      return;
    }

    should_select_first_visible_ref.current = false;
    visible_range_ref.current = null;
    cancel_pending_list_view_query();
    update_table_filter_state({
      selection: create_default_proofreading_filter_selection(),
      search_keyword: proofreading_lookup_intent.keyword,
      search_scope: proofreading_lookup_intent.scope,
      is_regex: proofreading_lookup_intent.is_regex,
    });
    clear_table_selection();
    void run_list_view_query().catch((error) => {
      report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
    });
    clear_proofreading_lookup_intent();
  }, [
    cancel_pending_list_view_query,
    clear_proofreading_lookup_intent,
    clear_table_selection,
    proofreading_lookup_intent,
    report_proofreading_list_error,
    run_list_view_query,
    should_select_first_visible_ref,
    t,
    update_table_filter_state,
    visible_range_ref,
  ]);

  // 只有用户查询意图改变才重置替换游标；delta 内容刷新继续当前扫描位置。
  useEffect(() => {
    if (pending_replace_cursor_ref.current !== null) {
      replace_cursor_ref.current = pending_replace_cursor_ref.current;
      pending_replace_cursor_ref.current = null;
      return;
    }

    replace_cursor_ref.current = 0;
  }, [current_query_intent_key, pending_replace_cursor_ref, replace_cursor_ref]);

  // 写入恢复焦点优先于“查询后选中首行”，且两者都只消费一次。
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
