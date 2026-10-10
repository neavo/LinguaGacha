import {
  push_error_toast,
  dismiss_toast,
  push_progress_toast,
  push_toast,
} from "@frontend/app/feedback/desktop-toast";
import {
  clone_content_filters,
  type ProofreadingContentFilters,
  create_empty_filter_options,
  create_empty_proofreading_view_filter_state,
  create_proofreading_view_filter_state,
  materialize_proofreading_filters,
  clone_proofreading_view_filter_state,
  type ProofreadingViewFilterState,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  ProjectWriteOperation,
  ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  INPUT_QUERY_DEBOUNCE_MS,
  useDebouncedCallback,
} from "@frontend/widgets/interactions/use-debounce";
import {
  useDesktopState,
  useProjectChangeSignal,
  useRuntimeSnapshot,
  useSyncBatchTranslationSnapshot,
  useBatchTranslationSnapshot,
} from "@frontend/app/state/use-desktop-state";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";

import { useI18n } from "@frontend/app/locale/locale-context";
import { useProjectSessionTableUiState } from "@frontend/app/session/project-session-ui-state-context";
import { useProofreadingBatchActions } from "@frontend/pages/proofreading-page/use-proofreading-batch-actions";
import { useProofreadingCacheActions } from "@frontend/pages/proofreading-page/use-proofreading-cache-actions";
import { useProofreadingDialogActions } from "@frontend/pages/proofreading-page/use-proofreading-dialog-actions";
import { useProofreadingPageEffects } from "@frontend/pages/proofreading-page/use-proofreading-page-effects";
import { useProofreadingReplaceActions } from "@frontend/pages/proofreading-page/use-proofreading-replace-actions";
import { useProofreadingTableActions } from "@frontend/pages/proofreading-page/use-proofreading-table-actions";
import { createProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";
import {
  PROOFREADING_REQUIRED_SECTIONS,
  normalize_proofreading_sort_state,
  type UseProofreadingPageStateResult,
  type ProofreadingProjectWriteRunner,
} from "@frontend/pages/proofreading-page/proofreading-page-state-contract";

import {
  PROOFREADING_INITIAL_WINDOW_ROWS,
  build_proofreading_list_query_intent_key,
  resolve_proofreading_refresh_signal,
  resolve_proofreading_list_query,
  type ProofreadingListSnapshot,
  type ProofreadingListWindowBounds,
  type ProofreadingResolvedListQuery,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";
import type { ProofreadingSyncState } from "@shared/proofreading/proofreading-reader";
import type {
  AppTableScrollAnchor,
  AppTableScrollTarget,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

import type { ProjectDataSectionRevisions } from "@shared/project-event";
import {
  build_proofreading_row_id,
  PROOFREADING_OUTCOME_GROUPS,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingClientItem,
  type ProofreadingContextItem,
  type ProofreadingFilterOptions,
  type ProofreadingFileSelection,
} from "@shared/proofreading/proofreading-types";

// 校对页所有保存动作共享同一业务 operation，具体 item 范围留在写入 context。
const PROOFREADING_WRITE: ProjectWriteOperation = "proofreading.write";

// 用户查询变化只携带稳定候选行与是否重建，不复制筛选或排序状态。
type ListQueryChange = {
  target_row_id: string | null;
  rebuild?: boolean;
};

/**
 * 聚合校对页 session 状态、后端 query、写入动作与生命周期，向页面暴露单一公开状态。
 */
export function useProofreadingPageState(): UseProofreadingPageStateResult {
  const { t } = useI18n();

  const { proofreading_lookup_intent, clear_proofreading_lookup_intent } = useAppNavigation();
  const { settings_snapshot, project_snapshot, commit_project_write, refresh_batch_translation } =
    useDesktopState();
  const task_snapshot = useBatchTranslationSnapshot();
  const runtime_snapshot = useRuntimeSnapshot();
  const sync_task_snapshot = useSyncBatchTranslationSnapshot();
  const project_change_signal = useProjectChangeSignal();
  const table_ui_state = useProjectSessionTableUiState<
    ProofreadingViewFilterState,
    AppTableSortState | null
  >({
    key: "proofreading",
    create_default_filter_state: create_empty_proofreading_view_filter_state,
    create_default_sort_state: () => null,
    clone_filter_state: clone_proofreading_view_filter_state,
    normalize_sort_state: normalize_proofreading_sort_state,
  });
  // 保存后端当前默认筛选，只在执行查询或打开筛选弹窗时按 session 意图物化。
  const defaultFiltersRef = useRef(create_empty_filter_options());
  const search_keyword = table_ui_state.filter_state.search_keyword;
  const search_scope = table_ui_state.filter_state.search_scope;
  const is_regex = table_ui_state.filter_state.is_regex;
  const sort_state = table_ui_state.sort_state;
  const selected_row_ids = table_ui_state.selected_row_ids;
  const active_row_id = table_ui_state.active_row_id;
  const anchor_row_id = table_ui_state.anchor_row_id;
  const restore_scroll_row_id = table_ui_state.restore_scroll_row_id;
  const table_filter_state_ref = table_ui_state.filter_state_ref;
  const table_sort_state_ref = table_ui_state.sort_state_ref;
  const selected_row_ids_ref = table_ui_state.selected_row_ids_ref;
  const active_row_id_ref = table_ui_state.active_row_id_ref;
  const anchor_row_id_ref = table_ui_state.anchor_row_id_ref;
  const set_table_filter_state = table_ui_state.set_filter_state;
  const set_table_sort_state = table_ui_state.set_sort_state;
  const set_table_selection_state = table_ui_state.set_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
  const [list_snapshot, set_list_snapshot] = useState<ProofreadingListSnapshot>(() => {
    return {
      query_intent_key: "",
      view: create_empty_proofreading_list_view(),
      scroll_to_row: null,
    };
  });
  const list_view = list_snapshot.view;
  const [filter_dialog_filters, set_filter_dialog_filters] = useState<ProofreadingContentFilters>(
    () =>
      clone_content_filters(
        materialize_proofreading_filters(
          table_ui_state.filter_state.selection,
          defaultFiltersRef.current,
        ),
      ),
  );
  const [filter_panel, set_filter_panel] = useState(() => {
    return create_empty_proofreading_filter_panel_state();
  });
  const [filter_panel_loading, set_filter_panel_loading] = useState(false);
  const [is_refreshing, set_is_refreshing] = useState(false);
  const [cache_status, set_cache_status] = useState<"idle" | "refreshing" | "ready" | "error">(
    "idle",
  );
  const [list_revisions, set_list_revisions] = useState<ProjectDataSectionRevisions>({}); // 列表可见事实锁
  const [settled_project_path, set_settled_project_path] = useState("");
  const [is_writing, set_is_writing] = useState(false);
  // preserve_scroll_anchor 通知 AppTable 在数据刷新前后保持当前窗口视觉偏移。
  const [preserve_scroll_anchor, set_preserve_scroll_anchor] = useState<AppTableScrollAnchor>({
    row_id: null,
    revision: 0,
  });
  const [replace_text, set_replace_text] = useState("");
  const [filter_dialog_open, set_filter_dialog_open] = useState(false);
  const refresh_generation_ref = useRef(0);
  const list_view_request_id_ref = useRef(0);
  const list_window_request_id_ref = useRef(0);
  const filter_panel_request_id_ref = useRef(0);
  const filter_dialog_filters_ref = useRef(filter_dialog_filters);
  const sync_state_ref = useRef<ProofreadingSyncState | null>(null);
  const proofreading_runtime_client_ref = useRef(createProofreadingApiClient());
  // 记录 AppTable 最新可见范围，delta 刷新优先复用这个窗口。
  const visible_range_ref = useRef<ProofreadingListWindowBounds | null>(null);
  // 保存当前已预取窗口，首屏刷新时没有可见范围也能复用。
  const list_window_bounds_ref = useRef<ProofreadingListWindowBounds>({
    start: 0,
    count: PROOFREADING_INITIAL_WINDOW_ROWS,
  });
  const pending_write_focus_row_id_ref = useRef<string | null>(null);
  // 缓存失效回调声明早于查询调度器，用 ref 连接两者并避免引入第二套状态机。
  const cancel_pending_list_query_change_ref = useRef<() => void>(() => undefined);
  const replace_cursor_ref = useRef(0);
  const pending_replace_cursor_ref = useRef<number | null>(null);
  const filter_dialog_open_ref = useRef(filter_dialog_open);
  // 给每次刷新锚点发布单调版本，避免 AppTable 重复消费。
  const preserve_scroll_anchor_revision_ref = useRef(0);
  // 标记项目身份切换后的首轮 sync 需要回到最新默认筛选。
  const pending_reset_filters_ref = useRef(false);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  // 标记本轮进入页面是否来自 session 恢复，决定是否套用默认筛选。
  const restored_ui_state_ref = useRef(table_ui_state.initial_ui_state !== null);
  // 记录当前模态 loading toast，确保刷新结束和卸载时能精确关闭。
  const loading_toast_id_ref = useRef<ReturnType<typeof push_progress_toast> | null>(null);
  const [loading_toast_visible, set_loading_toast_visible] = useState(false);
  const previous_proofreading_change_seq_ref = useRef(0);
  const proofreading_change_signal = useMemo(
    () => resolve_proofreading_refresh_signal(project_change_signal),
    [project_change_signal],
  );
  // 避免同一 revision 和筛选参数重复请求筛选面板。
  const last_filter_panel_signature_ref = useRef("");
  const warm_filter_panel_query_ref = useRef<(filters: ProofreadingFilterOptions) => void>(
    () => undefined,
  );
  // 避免虚拟列表重复读取同一预取窗口。
  const last_visible_range_signature_ref = useRef("");
  // 将 view 与创建它的查询意图绑定，避免异步刷新从平行 ref 反推身份。
  const list_snapshot_ref = useRef(list_snapshot);
  const context_navigation_ref = useRef<symbol | null>(null); // 同步互斥与迟到响应隔离共用一次导航身份
  const [is_navigating, set_is_navigating] = useState(false);

  /** 撤销目标准备并释放界面的导航忙碌态。 */
  const cancel_context_navigation = useCallback((): void => {
    context_navigation_ref.current = null;
    set_is_navigating(false);
  }, []);
  // 页面卸载撤销导航身份，让迟到查询自然结束。
  useEffect(
    () => () => {
      context_navigation_ref.current = null;
    },
    [],
  );

  const visible_items = list_view.window_rows;
  const visible_row_index_by_id = useMemo(() => {
    return new Map(
      visible_items.map((item, index) => {
        return [item.row_id, list_view.window_start + index] as const;
      }),
    );
  }, [list_view.window_start, visible_items]);
  const visible_item_by_id = useMemo(() => {
    return new Map(
      visible_items.flatMap((row) =>
        row.kind === "item" ? [[row.row_id, row.item] as const] : [],
      ),
    );
  }, [visible_items]);
  const readonly = is_runtime_busy(runtime_snapshot);
  const retranslating_row_ids = useMemo(() => {
    if (task_snapshot.operation !== "retranslate" || task_snapshot.scope.kind !== "items") {
      return [];
    }

    return task_snapshot.scope.item_ids.map((item_id) => {
      return build_proofreading_row_id(item_id);
    });
  }, [task_snapshot.operation, task_snapshot.scope]);
  const invalid_regex_message =
    list_view.invalid_regex_message === null
      ? null
      : `${t("proofreading_page.feedback.regex_invalid")}: ${list_view.invalid_regex_message}`;
  const current_query_intent_key = useMemo(() => {
    return build_proofreading_list_query_intent_key({
      filter_state: table_ui_state.filter_state,
      sort_state,
    });
  }, [sort_state, table_ui_state.filter_state]);
  const scroll_to_row: AppTableScrollTarget | null =
    list_snapshot.scroll_to_row ??
    (restore_scroll_row_id === null ? null : { row_id: restore_scroll_row_id, revision: 0 });

  const handle_api_error = useCallback(
    (error: unknown, fallback_message: string): void => {
      push_error_toast(fallback_message, error);
    },
    [t],
  );

  const report_proofreading_list_error = useCallback(
    (error: unknown, fallback_message: string): boolean => {
      push_error_toast(fallback_message, error);
      return true;
    },
    [t],
  );

  const update_table_filter_state = useCallback(
    (patch: Partial<ProofreadingViewFilterState>, options?: { persist?: boolean }): void => {
      const previous_filter_state = table_filter_state_ref.current;
      set_table_filter_state(
        create_proofreading_view_filter_state({
          selection: patch.selection ?? previous_filter_state.selection,
          search_keyword: patch.search_keyword ?? previous_filter_state.search_keyword,
          search_scope: patch.search_scope ?? previous_filter_state.search_scope,
          is_regex: patch.is_regex ?? previous_filter_state.is_regex,
        }),
        options,
      );
    },
    [set_table_filter_state, table_filter_state_ref],
  );

  const materialize_active_filters = useCallback((): ProofreadingFilterOptions => {
    return materialize_proofreading_filters(
      table_filter_state_ref.current.selection,
      defaultFiltersRef.current,
    );
  }, [table_filter_state_ref]);

  // 每次执行时从最新 ref 同时生成符号意图键和物化查询，避免调用方传入过期快照。
  const resolve_current_list_query = useCallback((): ProofreadingResolvedListQuery => {
    return resolve_proofreading_list_query({
      filter_state: table_filter_state_ref.current,
      default_filters: defaultFiltersRef.current,
      sort_state: table_sort_state_ref.current,
    });
  }, [table_filter_state_ref, table_sort_state_ref]);

  // 刷新锚点只从当前窗口选择，避免为窗口外选区追加后端定位请求。
  const resolve_refresh_scroll_anchor_row_id = useCallback((): string | null => {
    const current_view = list_snapshot_ref.current.view;
    const window_row_ids = new Set(current_view.window_rows.map((row) => row.row_id));
    const active_row_id = active_row_id_ref.current;
    if (active_row_id !== null && window_row_ids.has(active_row_id)) {
      return active_row_id;
    }

    const selected_row_id = selected_row_ids_ref.current.find((row_id) => {
      return window_row_ids.has(row_id);
    });
    return selected_row_id ?? current_view.window_rows[0]?.row_id ?? null;
  }, [active_row_id_ref, selected_row_ids_ref]);

  const publish_refresh_scroll_anchor = useCallback((): string | null => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    const row_id = resolve_refresh_scroll_anchor_row_id();
    set_preserve_scroll_anchor({
      row_id,
      revision: next_revision,
    });
    return row_id;
  }, [resolve_refresh_scroll_anchor_row_id]);

  const clear_refresh_scroll_anchor = useCallback((): void => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    set_preserve_scroll_anchor({
      row_id: null,
      revision: next_revision,
    });
  }, []);

  const apply_pending_write_focus = useCallback(
    (preferred_row_id: string): void => {
      const current_selected_row_ids = selected_row_ids_ref.current;
      if (
        current_selected_row_ids.length > 1 &&
        current_selected_row_ids.includes(preferred_row_id)
      ) {
        const current_anchor_row_id = anchor_row_id_ref.current;
        set_table_selection_state({
          selected_row_ids: current_selected_row_ids,
          active_row_id: preferred_row_id,
          anchor_row_id:
            current_anchor_row_id !== null &&
            current_selected_row_ids.includes(current_anchor_row_id)
              ? current_anchor_row_id
              : (current_selected_row_ids[0] ?? preferred_row_id),
        });
        return;
      }

      set_table_selection_state({
        selected_row_ids: [preferred_row_id],
        active_row_id: preferred_row_id,
        anchor_row_id: preferred_row_id,
      });
    },
    [anchor_row_id_ref, selected_row_ids_ref, set_table_selection_state],
  );

  // 所有校对写入通过项目唯一写入口提交，成功后的公开 change 再驱动列表刷新。
  const run_project_write = useCallback<ProofreadingProjectWriteRunner>(
    async (args) => {
      if (args.plan === null || args.plan.changed_item_ids.length === 0) {
        if (args.empty_warning_message !== undefined) {
          push_toast("warning", args.empty_warning_message);
        }
        return false;
      }
      const write_plan = args.plan;

      set_is_writing(true);

      try {
        const { write_result } = await commit_project_write({
          operation: PROOFREADING_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>(args.path, write_plan.request_body);
          },
          // 登记在回灌之前，失败的请求不会留下待应用的焦点或替换游标。
          prepare: () => {
            if (args.pending_replace_cursor !== undefined)
              pending_replace_cursor_ref.current = args.pending_replace_cursor;
            pending_write_focus_row_id_ref.current =
              args.preferred_row_id ?? active_row_id_ref.current;
          },
        });
        try {
          await refresh_batch_translation();
        } catch (error) {
          handle_api_error(error, t("app.feedback.refresh_failed"));
        }

        if (args.success_message_builder !== undefined) {
          // 成功数量只消费后端规范化事实，避免候选目标把部分变化或 no-op 计为已变更。
          const changed_item_count = new Set(
            write_result.changes.flatMap((change) =>
              change.operations.flatMap((operation) => operation.items?.changedIds ?? []),
            ),
          ).size;
          push_toast("success", args.success_message_builder(changed_item_count));
        }

        return true;
      } catch (error) {
        handle_api_error(error, t(args.fallback_error_key));
        return false;
      } finally {
        set_is_writing(false);
      }
    },
    [commit_project_write, handle_api_error, refresh_batch_translation, t],
  );

  const resolve_preferred_row_id = useCallback(
    (preferred_row_id?: string | null): string | null => {
      return preferred_row_id ?? active_row_id_ref.current;
    },
    [],
  );

  const remember_preferred_row_id = useCallback((preferred_row_id: string | null): void => {
    pending_write_focus_row_id_ref.current = preferred_row_id;
  }, []);

  const read_items_by_row_ids_ref = useRef(
    async (_row_ids: string[]): Promise<ProofreadingClientItem[]> => [],
  );
  const read_items_by_row_ids_for_batch = useCallback(
    (row_ids: string[]): Promise<ProofreadingClientItem[]> => {
      return read_items_by_row_ids_ref.current(row_ids);
    },
    [],
  );
  // 打开与保存前回读当前条目，避免使用窗口中的过期快照。
  const read_dialog_items = useCallback((row_ids: string[]): Promise<ProofreadingClientItem[]> => {
    return proofreading_runtime_client_ref.current.read_proofreading_items_by_row_ids({
      row_ids,
    });
  }, []);
  const read_dialog_context = useCallback((row_id: string): Promise<ProofreadingContextItem[]> => {
    return proofreading_runtime_client_ref.current.read_proofreading_context({ row_id });
  }, []);

  const {
    dialog_state,
    dialog_item,
    reset_dialog,
    open_edit_dialog,
    update_dialog_draft,
    open_dialog_view,
    return_to_edit,
    save_dialog_entry,
    save_dialog_draft,
    show_dialog_item,
  } = useProofreadingDialogActions({
    list_revisions,
    visible_item_by_id,
    read_items_by_row_ids: read_dialog_items,
    read_context: read_dialog_context,
    read_raw_item: (row_id) =>
      proofreading_runtime_client_ref.current.read_proofreading_raw_item({
        row_id,
        project_path: project_snapshot.path,
      }),
    run_project_write,
    t,
  });

  const {
    pending_confirmation,
    request_retranslate_row_ids,
    request_clear_translation_row_ids,
    request_set_translation_status_row_ids,
    confirm_pending_confirmation,
    close_pending_confirmation,
    clear_pending_confirmation,
  } = useProofreadingBatchActions({
    readonly,
    is_refreshing,
    is_writing,
    dialog_open: dialog_state.open,
    list_revisions,
    read_items_by_row_ids: read_items_by_row_ids_for_batch,
    sync_task_snapshot,
    run_project_write,
    set_is_writing,
    resolve_preferred_row_id,
    remember_preferred_row_id,
    close_edit_dialog: reset_dialog,
    handle_api_error,
    t,
  });

  const filter_panel_query_scheduler = useDebouncedCallback(
    (filters: ProofreadingContentFilters): void => {
      void run_filter_panel_query(filters, {
        mark_loading: true,
      }).catch((error) => {
        report_proofreading_list_error(error, t("app.feedback.refresh_failed"));
      });
    },
    INPUT_QUERY_DEBOUNCE_MS,
  );

  const cancel_pending_list_view_query = useCallback((): void => {
    cancel_pending_list_query_change_ref.current();
  }, []);

  const cancel_pending_cache_bound_queries = useCallback((): void => {
    cancel_pending_list_view_query();
    filter_panel_query_scheduler.cancel();
  }, [cancel_pending_list_view_query, filter_panel_query_scheduler]);

  const invalidate_list_view_requests = useCallback((): void => {
    list_view_request_id_ref.current += 1;
    list_window_request_id_ref.current += 1;
    last_visible_range_signature_ref.current = "";
  }, []);

  const invalidate_filter_panel_requests = useCallback((): void => {
    filter_panel_request_id_ref.current += 1;
  }, []);

  const invalidate_cache_bound_queries = useCallback((): void => {
    // cache 身份切换时，所有依赖 sync_state_ref 的待发布/在途查询都必须失效。
    cancel_pending_cache_bound_queries();
    invalidate_list_view_requests();
    invalidate_filter_panel_requests();
    last_filter_panel_signature_ref.current = "";
  }, [
    cancel_pending_cache_bound_queries,
    invalidate_filter_panel_requests,
    invalidate_list_view_requests,
  ]);

  const clear_transient_state_for_new_project = useCallback((): void => {
    cancel_context_navigation();
    clear_pending_confirmation();
    const empty_dialog_filters = clone_content_filters(create_empty_filter_options());
    reset_table_state({ persist: false });
    set_filter_dialog_filters(empty_dialog_filters);
    filter_dialog_filters_ref.current = empty_dialog_filters;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_list_revisions({});
    set_settled_project_path("");
    set_replace_text("");
    set_filter_dialog_open(false);
    filter_dialog_open_ref.current = false;
    reset_dialog();
    replace_cursor_ref.current = 0;
    pending_replace_cursor_ref.current = null;
    pending_write_focus_row_id_ref.current = null;
    clear_refresh_scroll_anchor();
    pending_reset_filters_ref.current = false;
  }, [
    cancel_context_navigation,
    clear_pending_confirmation,
    clear_refresh_scroll_anchor,
    reset_dialog,
    reset_table_state,
  ]);

  const clear_cache_state = useCallback((): void => {
    clear_pending_confirmation();
    refresh_generation_ref.current += 1;
    invalidate_cache_bound_queries();
    sync_state_ref.current = null;
    defaultFiltersRef.current = create_empty_filter_options();
    visible_range_ref.current = null;
    list_window_bounds_ref.current = {
      start: 0,
      count: PROOFREADING_INITIAL_WINDOW_ROWS,
    };
    clear_refresh_scroll_anchor();
    const empty_list_snapshot: ProofreadingListSnapshot = {
      query_intent_key: "",
      view: create_empty_proofreading_list_view(),
      scroll_to_row: null,
    };
    set_list_snapshot(empty_list_snapshot);
    list_snapshot_ref.current = empty_list_snapshot;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_list_revisions({});
    set_is_refreshing(false);
    set_cache_status("idle");
    set_is_writing(false);
  }, [clear_pending_confirmation, clear_refresh_scroll_anchor, invalidate_cache_bound_queries]);

  const {
    refresh_snapshot,
    query_list_view,
    publish_list_snapshot,
    run_filter_panel_query,
    read_list_window,
    read_items_by_row_ids,
    read_current_view_row_ids,
  } = useProofreadingCacheActions({
    cache_status,
    filter_panel,
    project_loaded: project_snapshot.loaded,
    project_path: project_snapshot.path,
    proofreading_change_signal,
    source_language: settings_snapshot.source_language,
    target_language: settings_snapshot.target_language,
    defaultFiltersRef,
    filter_dialog_filters_ref,
    filter_dialog_open_ref,
    filter_panel_request_id_ref,
    last_filter_panel_signature_ref,
    last_visible_range_signature_ref,
    list_snapshot_ref,
    list_view_request_id_ref,
    list_window_bounds_ref,
    list_window_request_id_ref,
    pending_reset_filters_ref,
    proofreading_runtime_client_ref,
    refresh_generation_ref,
    sync_state_ref,
    table_filter_state_ref,
    visible_range_ref,
    clear_cache_state,
    clear_transient_state_for_new_project,
    invalidate_cache_bound_queries,
    invalidate_list_view_requests,
    publish_refresh_scroll_anchor,
    report_proofreading_list_error,
    resolve_current_list_query,
    set_cache_status,
    set_list_revisions,
    set_filter_dialog_filters,
    set_filter_dialog_open,
    set_filter_panel,
    set_filter_panel_loading,
    set_is_refreshing,
    set_list_snapshot,
    set_loading_toast_visible,
    set_settled_project_path,
    update_table_filter_state,
    warm_filter_panel_query_ref,
    t,
  });
  read_items_by_row_ids_ref.current = read_items_by_row_ids;

  // 用户查询只在新视图接纳候选行后提交单选，否则提交空选区。
  const execute_list_query_change = useCallback(
    async (change: ListQueryChange): Promise<void> => {
      try {
        const snapshot = await query_list_view(resolve_current_list_query(), {
          ...(change.rebuild === undefined ? {} : { rebuild: change.rebuild }),
          scroll_to_row_id: change.target_row_id,
        });
        if (snapshot === null) {
          return;
        }

        const resolved_row_id = snapshot.scroll_to_row?.row_id ?? null;
        startTransition(() => {
          publish_list_snapshot(snapshot);
          set_table_selection_state({
            selected_row_ids: resolved_row_id === null ? [] : [resolved_row_id],
            active_row_id: resolved_row_id,
            anchor_row_id: resolved_row_id,
          });
        });
      } catch (error) {
        report_proofreading_list_error(error, t("app.feedback.refresh_failed"));
      }
    },
    [
      publish_list_snapshot,
      query_list_view,
      resolve_current_list_query,
      report_proofreading_list_error,
      set_table_selection_state,
      t,
    ],
  );

  const list_query_change_scheduler = useDebouncedCallback((change: ListQueryChange): void => {
    void execute_list_query_change(change);
  }, INPUT_QUERY_DEBOUNCE_MS);

  /** 新查询接管焦点与窗口，撤销旧写入的待恢复位置。 */
  const prepare_list_query_change = useCallback((): void => {
    pending_write_focus_row_id_ref.current = null;
    visible_range_ref.current = null;
  }, []);

  /** 即时查询先取消待执行的防抖意图，再读取当前查询状态。 */
  const run_list_query_change = useCallback(
    (change: ListQueryChange): Promise<void> => {
      list_query_change_scheduler.cancel();
      prepare_list_query_change();
      return execute_list_query_change(change);
    },
    [execute_list_query_change, list_query_change_scheduler, prepare_list_query_change],
  );

  /** 连续输入只保留最新查询意图，候选行身份随意图一起延后提交。 */
  const schedule_list_query_change = useCallback(
    (change: ListQueryChange): void => {
      prepare_list_query_change();
      list_query_change_scheduler.schedule(change);
    },
    [list_query_change_scheduler, prepare_list_query_change],
  );
  cancel_pending_list_query_change_ref.current = list_query_change_scheduler.cancel;

  /** 列表发布后后台补读统计，统一反馈读取失败。 */
  const warm_filter_panel_query = useCallback(
    (filters: ProofreadingFilterOptions): void => {
      void run_filter_panel_query(filters, {
        force: true,
        mark_loading: false,
      }).catch((error) => {
        report_proofreading_list_error(error, t("app.feedback.refresh_failed"));
      });
    },
    [report_proofreading_list_error, run_filter_panel_query, t],
  );
  warm_filter_panel_query_ref.current = warm_filter_panel_query;

  const {
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
  } = useProofreadingTableActions({
    cache_status,
    filter_dialog_open,
    is_refreshing,
    list_view,
    project_loaded: project_snapshot.loaded,
    visible_items,
    visible_row_index_by_id,
    filter_dialog_filters_ref,
    filter_dialog_open_ref,
    proofreading_runtime_client_ref,
    selected_row_ids_ref,
    sync_state_ref,
    visible_range_ref,
    filter_panel_query_scheduler,
    read_current_view_row_ids,
    read_list_window,
    report_proofreading_list_error,
    materialize_active_filters,
    read_file_selection: () => table_filter_state_ref.current.selection.files,
    run_filter_panel_query,
    run_list_query_change,
    schedule_list_query_change,
    set_filter_dialog_filters,
    set_filter_dialog_open,
    set_replace_text,
    set_table_filter_state: update_table_filter_state,
    set_table_selection_state,
    set_table_sort_state,
    t,
  });

  const { replace_next_visible_match, replace_all_visible_matches } = useProofreadingReplaceActions(
    {
      active_row_id_ref,
      list_revisions,
      is_refreshing,
      is_regex,
      is_writing,
      list_view,
      proofreading_runtime_client_ref,
      readonly,
      replace_cursor_ref,
      replace_text,
      search_keyword,
      push_toast,
      read_current_view_row_ids,
      read_items_by_row_ids,
      run_project_write,
      close_edit_dialog: reset_dialog,
      t,
    },
  );

  useProofreadingPageEffects({
    navigation_pending: is_navigating,
    current_query_intent_key,
    filter_dialog_filters,
    filter_dialog_open,
    list_snapshot,
    loading_toast_visible,
    project_loaded: project_snapshot.loaded,
    project_path: project_snapshot.path,
    proofreading_change_signal,
    proofreading_lookup_intent,
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
    pending_write_focus_row_id_ref,
    previous_project_loaded_ref,
    previous_project_path_ref,
    previous_proofreading_change_seq_ref,
    replace_cursor_ref,
    restored_ui_state_ref,
    apply_pending_write_focus,
    clear_cache_state,
    clear_proofreading_lookup_intent,
    clear_transient_state_for_new_project,
    dismiss_toast,
    push_progress_toast,
    refresh_snapshot,
    run_list_query_change,
    set_cache_status,
    update_table_filter_state,
    t,
  });

  // 文件选择直接更新查询意图，弹窗确认只接管内容条件。
  const update_file_selection = useCallback(
    (choice: ProofreadingFileSelection): void => {
      update_table_filter_state({
        selection: { ...table_filter_state_ref.current.selection, files: choice },
      });
      void run_list_query_change({ target_row_id: active_row_id_ref.current });
    },
    [update_table_filter_state, table_filter_state_ref, run_list_query_change, active_row_id_ref],
  );
  const file_selection = table_ui_state.filter_state.selection.files;

  /** 保存与目标准备完成后，查询意图、列表选区和弹窗一起发布。 */
  const open_context_item = useCallback(
    async (row_id: string): Promise<void> => {
      if (context_navigation_ref.current !== null || dialog_state.pending) return;
      if (row_id === dialog_state.target_row_id) {
        return_to_edit();
        return;
      }
      if (readonly || is_refreshing || is_writing || cache_status !== "ready") return;
      const request = Symbol();
      context_navigation_ref.current = request;
      set_is_navigating(true);
      list_query_change_scheduler.cancel();
      try {
        if (!(await save_dialog_draft()) || context_navigation_ref.current !== request) return;
        const filter_state = create_empty_proofreading_view_filter_state();
        filter_state.selection = {
          ...filter_state.selection,
          // 默认结果含扩展检查项，公开分组补齐默认隐藏的状态。
          outcomes: {
            mode: "selected",
            values: [
              ...new Set([
                ...defaultFiltersRef.current.outcomes,
                ...PROOFREADING_OUTCOME_GROUPS.flatMap((group) => group.outcome_codes),
              ]),
            ],
          },
          include_without_glossary_miss: true,
        };
        const query = resolve_proofreading_list_query({
          filter_state,
          default_filters: defaultFiltersRef.current,
          sort_state,
        });
        const [snapshot, items] = await Promise.all([
          query_list_view(query, { scroll_to_row_id: row_id }),
          read_dialog_items([row_id]),
        ]);
        if (context_navigation_ref.current !== request || snapshot === null) return;
        const item = items[0];
        if (item === undefined || snapshot.scroll_to_row?.row_id !== row_id)
          throw new Error("The requested entry is absent from the navigation response.");
        // 保存回灌留下的旧焦点不能在后续刷新时覆盖目标条目。
        prepare_list_query_change();
        clear_refresh_scroll_anchor();
        // 同步批量提交，导航解锁与目标切换使用同一渲染优先级。
        update_table_filter_state(filter_state);
        publish_list_snapshot(snapshot);
        set_table_selection_state({
          selected_row_ids: [row_id],
          active_row_id: row_id,
          anchor_row_id: row_id,
        });
        show_dialog_item(item);
        warm_filter_panel_query(query.query.filters);
      } catch (error) {
        if (context_navigation_ref.current === request)
          handle_api_error(error, t("app.feedback.read_failed"));
      } finally {
        if (context_navigation_ref.current === request) cancel_context_navigation();
      }
    },
    [
      cache_status,
      cancel_context_navigation,
      clear_refresh_scroll_anchor,
      return_to_edit,
      dialog_state.pending,
      dialog_state.target_row_id,
      handle_api_error,
      is_refreshing,
      is_writing,
      list_query_change_scheduler,
      prepare_list_query_change,
      publish_list_snapshot,
      query_list_view,
      read_dialog_items,
      readonly,
      save_dialog_draft,
      set_table_selection_state,
      show_dialog_item,
      sort_state,
      t,
      update_table_filter_state,
      warm_filter_panel_query,
    ],
  );

  /** 关闭编辑时同时撤销正在准备的上下文目标。 */
  const request_close_dialog = useCallback((): void => {
    cancel_context_navigation();
    reset_dialog();
  }, [cancel_context_navigation, reset_dialog]);

  return useMemo<UseProofreadingPageStateResult>(() => {
    return {
      cache_status,
      file_selection,
      files: sync_state_ref.current?.files ?? [],
      update_file_selection,
      list_revisions,
      required_sections: PROOFREADING_REQUIRED_SECTIONS,
      settled_project_path,
      is_refreshing,
      is_writing,
      readonly,
      search_keyword,
      replace_text,
      search_scope,
      is_regex,
      invalid_regex_message,
      filter_dialog_filters,
      filter_panel,
      filter_panel_loading,
      visible_items,
      visible_row_count: list_view.row_count,
      sort_state,
      selected_row_ids,
      active_row_id,
      anchor_row_id,
      scroll_to_row,
      preserve_scroll_anchor,
      retranslating_row_ids,
      filter_dialog_open,
      dialog_state: { ...dialog_state, pending: dialog_state.pending || is_navigating },
      dialog_item,
      pending_confirmation,
      refresh_snapshot,
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
      resolve_visible_row_ids_range,
      read_visible_range,
      handle_table_selection_error,
      open_filter_dialog,
      close_filter_dialog,
      update_filter_dialog_filters,
      confirm_filter_dialog_filters,
      open_edit_dialog,
      request_close_dialog,
      update_dialog_draft,
      open_dialog_view,
      open_context_item,
      return_to_edit,
      save_dialog_entry,
      replace_next_visible_match,
      replace_all_visible_matches,
      request_retranslate_row_ids,
      request_clear_translation_row_ids,
      request_set_translation_status_row_ids,
      confirm_pending_confirmation,
      close_pending_confirmation,
    };
  }, [
    file_selection,
    update_file_selection,
    active_row_id,
    anchor_row_id,
    apply_table_selection,
    apply_table_sort_state,
    cache_status,
    list_revisions,
    close_filter_dialog,
    return_to_edit,
    close_pending_confirmation,
    confirm_filter_dialog_filters,
    confirm_pending_confirmation,
    dialog_item,
    dialog_state,
    filter_dialog_filters,
    filter_dialog_open,
    filter_panel,
    filter_panel_loading,
    get_visible_row_at_index,
    get_visible_row_id_at_index,
    handle_table_selection_error,
    invalid_regex_message,
    is_writing,
    is_refreshing,
    is_regex,
    open_edit_dialog,
    open_dialog_view,
    open_context_item,
    is_navigating,
    open_filter_dialog,
    pending_confirmation,
    preserve_scroll_anchor,
    readonly,
    retranslating_row_ids,
    refresh_snapshot,
    read_visible_range,
    resolve_visible_row_ids_range,
    resolve_visible_row_index_async,
    replace_all_visible_matches,
    replace_next_visible_match,
    replace_text,
    request_close_dialog,
    request_clear_translation_row_ids,
    request_retranslate_row_ids,
    request_set_translation_status_row_ids,
    resolve_visible_row_index,
    scroll_to_row,
    save_dialog_entry,
    search_keyword,
    search_scope,
    selected_row_ids,
    settled_project_path,
    sort_state,
    update_dialog_draft,
    update_filter_dialog_filters,
    update_regex,
    update_replace_text,
    update_search_keyword,
    update_search_scope,
    visible_items,
    list_view.row_count,
  ]);
}
