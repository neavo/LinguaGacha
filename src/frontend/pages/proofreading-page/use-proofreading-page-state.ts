import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  INPUT_QUERY_DEBOUNCE_MS,
  useDebouncedCallback,
} from "@frontend/widgets/interactions/use-debounce";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import type { ProjectChangeSignal } from "@frontend/app/state/desktop-state-context";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useProjectSessionTableUiState } from "@frontend/app/session/project-session-ui-state-context";
import { type ProofreadingCommandPlan } from "@shared/proofreading/proofreading-command-planner";
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
} from "@frontend/pages/proofreading-page/proofreading-page-state-contract";
import {
  build_filter_signature,
  create_empty_filter_options,
  create_empty_proofreading_view_filter_state,
  create_proofreading_view_filter_state,
  materialize_proofreading_filters,
  clone_proofreading_view_filter_state,
  type ProofreadingViewFilterState,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import {
  PROOFREADING_INITIAL_WINDOW_ROWS,
  build_sort_signature,
  resolve_proofreading_refresh_signal,
  type ProofreadingListQueryInput,
  type ProofreadingListWindowBounds,
} from "@frontend/pages/proofreading-page/proofreading-list-query-utils";
import type { ProofreadingSyncState } from "@shared/proofreading/proofreading-list-reader";
import type {
  AppTableScrollAnchor,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

import type { ProjectDataSectionRevisions } from "@shared/project-event";
import {
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  type ProofreadingClientItem,
  type ProofreadingFilterOptions,
} from "@shared/proofreading/proofreading-types";

// 校对页所有保存动作共享同一业务 operation，具体 item 范围留在写入 context。
const PROOFREADING_WRITE: ProjectWriteOperation = "proofreading.write";

// 提示词变更不重建校对列表，但后续重翻任务必须使用最新 prompts revision。
function resolve_prompt_revision_from_change_signal(signal: ProjectChangeSignal): number | null {
  if (!signal.updated_sections.includes("prompts")) {
    return null;
  }

  const revisions = signal.results.flatMap((result) => {
    const revision = result.sectionRevisions.prompts;
    return typeof revision === "number" ? [revision] : [];
  });
  return revisions.length > 0 ? Math.max(...revisions) : null;
}

export function useProofreadingPageState(): UseProofreadingPageStateResult {
  const { t } = useI18n();
  const { dismiss_toast, push_progress_toast, push_toast } = useDesktopToast();
  const { proofreading_lookup_intent, clear_proofreading_lookup_intent } = useAppNavigation();
  const {
    settings_snapshot,
    project_snapshot,
    task_snapshot,
    sync_task_snapshot,
    project_change_signal,
    commit_project_write,
    refresh_task,
  } = useDesktopState();
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
  // 保存后端当前默认筛选，current_filters 每次渲染按 session 意图即时展开。
  const defaultFiltersRef = useRef(create_empty_filter_options());
  const current_filters = materialize_proofreading_filters(
    table_ui_state.filter_state.selection,
    defaultFiltersRef.current,
  );
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
  const clear_table_selection_state = table_ui_state.clear_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
  const [list_view, set_list_view] = useState(() => create_empty_proofreading_list_view());
  const [filter_dialog_filters, set_filter_dialog_filters] = useState<ProofreadingFilterOptions>(
    () => clone_proofreading_filter_options(current_filters),
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
  const [operation_revisions, set_operation_revisions] = useState<ProjectDataSectionRevisions>({}); // 任务命令依赖锁
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
  const preferred_row_id_ref = useRef<string | null>(null);
  const should_select_first_visible_ref = useRef(false);
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
  // refresh_retry_nonce 用递增信号触发当前过期同步的一次性重试。
  const [refresh_retry_nonce, set_refresh_retry_nonce] = useState(0);
  // 记录已消费的重试信号，避免 effect 因 refresh_snapshot 身份变化重复执行。
  const consumed_refresh_retry_nonce_ref = useRef(0);
  const previous_proofreading_change_seq_ref = useRef(0);
  const proofreading_change_signal = useMemo(
    () => resolve_proofreading_refresh_signal(project_change_signal),
    [project_change_signal],
  );
  useEffect(() => {
    const prompt_revision = resolve_prompt_revision_from_change_signal(project_change_signal);
    if (prompt_revision === null) {
      return;
    }

    set_operation_revisions((previous_revisions) => {
      if (previous_revisions.prompts === prompt_revision) {
        return previous_revisions;
      }

      return {
        ...previous_revisions,
        prompts: prompt_revision, // 只推进任务命令锁，列表刷新由校对 change signal 决定
      };
    });
  }, [project_change_signal]);
  // 去重等价列表 query，并在 delta 复用旧 view 时校验查询身份。
  const last_list_query_signature_ref = useRef("");
  // 避免同一 revision 和筛选参数重复请求筛选面板。
  const last_filter_panel_signature_ref = useRef("");
  const warm_filter_panel_query_ref = useRef<(filters: ProofreadingFilterOptions) => void>(
    () => undefined,
  );
  // 避免虚拟列表重复读取同一预取窗口。
  const last_visible_range_signature_ref = useRef("");
  // 给异步刷新路径读取最新 view，避免闭包里的旧 state 覆盖新列表。
  const list_view_ref = useRef(list_view);
  const reset_dialog_ref = useRef<() => void>(() => undefined);

  // reader identity 只来自 Backend query reader/state 同步结果。
  const resolve_disposable_project_id = useCallback((): string | null => {
    return sync_state_ref.current?.projectId ?? null;
  }, []);

  const visible_items = list_view.window_rows;
  const visible_row_ids = useMemo(() => {
    return visible_items.map((item) => item.row_id);
  }, [visible_items]);
  const visible_row_index_by_id = useMemo(() => {
    return new Map(
      visible_items.map((item, index) => {
        return [item.row_id, list_view.window_start + index] as const;
      }),
    );
  }, [list_view.window_start, visible_items]);
  const visible_item_by_id = useMemo(() => {
    return new Map(
      visible_items.map((item) => {
        return [item.row_id, item.item] as const;
      }),
    );
  }, [visible_items]);
  const readonly = is_project_write_locked(task_snapshot);
  const retranslating_row_ids = useMemo(() => {
    if (
      task_snapshot.task_type !== "translation" ||
      task_snapshot.extras.kind !== "translation" ||
      task_snapshot.extras.scope.kind !== "items"
    ) {
      return [];
    }

    return task_snapshot.extras.scope.item_ids.map((item_id) => {
      return build_proofreading_row_id(item_id);
    });
  }, [task_snapshot.extras, task_snapshot.task_type]);
  const invalid_regex_message =
    list_view.invalid_regex_message === null
      ? null
      : `${t("proofreading_page.feedback.regex_invalid")}: ${list_view.invalid_regex_message}`;
  const current_filter_signature = useMemo(() => {
    return build_filter_signature(current_filters);
  }, [current_filters]);
  const sort_signature = useMemo(() => {
    return build_sort_signature(sort_state);
  }, [sort_state]);

  const handle_api_error = useCallback(
    (error: unknown, fallback_message: string): void => {
      const message = resolve_visible_error_message(error, t, fallback_message);
      push_toast("error", message);
    },
    [push_toast, t],
  );

  const report_proofreading_list_error = useCallback(
    (error: unknown, fallback_message: string): boolean => {
      const message = resolve_visible_error_message(error, t, fallback_message);
      push_toast("error", message);
      return true;
    },
    [push_toast, t],
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

  const resolve_current_filters = useCallback((): ProofreadingFilterOptions => {
    return materialize_proofreading_filters(
      table_filter_state_ref.current.selection,
      defaultFiltersRef.current,
    );
  }, [table_filter_state_ref]);

  const resolve_refresh_scroll_anchor_row_id = useCallback((): string | null => {
    const window_row_ids = new Set(list_view_ref.current.window_rows.map((row) => row.row_id));
    const active_row_id = active_row_id_ref.current;
    if (active_row_id !== null && window_row_ids.has(active_row_id)) {
      return active_row_id;
    }

    const selected_row_id = selected_row_ids_ref.current.find((row_id) => {
      return window_row_ids.has(row_id);
    });
    return selected_row_id ?? list_view_ref.current.window_rows[0]?.row_id ?? null;
  }, [active_row_id_ref, selected_row_ids_ref]);

  const publish_refresh_scroll_anchor = useCallback((): void => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    set_preserve_scroll_anchor({
      row_id: resolve_refresh_scroll_anchor_row_id(),
      revision: next_revision,
    });
  }, [resolve_refresh_scroll_anchor_row_id]);

  const clear_refresh_scroll_anchor = useCallback((): void => {
    const next_revision = preserve_scroll_anchor_revision_ref.current + 1;
    preserve_scroll_anchor_revision_ref.current = next_revision;
    set_preserve_scroll_anchor({
      row_id: null,
      revision: next_revision,
    });
  }, []);

  const apply_preferred_row_focus = useCallback(
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
  const run_project_write = useCallback(
    async (args: {
      path: string;
      plan: ProofreadingCommandPlan | null;
      fallback_error_key:
        | "proofreading_page.feedback.save_failed"
        | "proofreading_page.feedback.replace_failed"
        | "proofreading_page.feedback.clear_translation_failed"
        | "proofreading_page.feedback.set_status_failed";
      preferred_row_id?: string | null;
      pending_replace_cursor?: number | null;
      success_message_builder?: ((changed_count: number) => string) | null;
      empty_warning_message?: string | null;
      close_dialog?: boolean;
    }): Promise<void> => {
      if (args.plan === null || args.plan.changed_item_ids.length === 0) {
        if (args.empty_warning_message !== null && args.empty_warning_message !== undefined) {
          push_toast("warning", args.empty_warning_message);
        }
        return;
      }
      const write_plan = args.plan;

      if (args.pending_replace_cursor !== undefined) {
        pending_replace_cursor_ref.current = args.pending_replace_cursor;
      }
      preferred_row_id_ref.current = args.preferred_row_id ?? active_row_id_ref.current;

      set_is_writing(true);

      try {
        await commit_project_write({
          operation: PROOFREADING_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>(args.path, write_plan.request_body);
          },
        });
        await refresh_task();

        if (args.success_message_builder !== null && args.success_message_builder !== undefined) {
          push_toast("success", args.success_message_builder(write_plan.changed_item_ids.length));
        }

        if (args.close_dialog) {
          reset_dialog_ref.current();
        }
      } catch (error) {
        handle_api_error(error, t(args.fallback_error_key));
      } finally {
        set_is_writing(false);
      }
    },
    [commit_project_write, handle_api_error, push_toast, refresh_task, t],
  );

  const resolve_preferred_row_id = useCallback(
    (preferred_row_id?: string | null): string | null => {
      return preferred_row_id ?? active_row_id_ref.current;
    },
    [],
  );

  const remember_preferred_row_id = useCallback((preferred_row_id: string | null): void => {
    preferred_row_id_ref.current = preferred_row_id;
  }, []);

  const read_items_by_row_ids_ref = useRef(
    async (_row_ids: string[]): Promise<ProofreadingClientItem[]> => [],
  );
  const read_items_by_row_ids_for_batch = useCallback(
    async (row_ids: string[]): Promise<ProofreadingClientItem[]> => {
      return await read_items_by_row_ids_ref.current(row_ids);
    },
    [],
  );

  const {
    dialog_state,
    dialog_item,
    reset_dialog,
    open_edit_dialog,
    update_dialog_draft,
    save_dialog_entry,
  } = useProofreadingDialogActions({
    list_revisions,
    visible_item_by_id,
    read_items_by_row_ids: read_items_by_row_ids_for_batch,
    run_project_write,
    push_toast,
    t,
  });
  reset_dialog_ref.current = reset_dialog;

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
    operation_revisions,
    read_items_by_row_ids: read_items_by_row_ids_for_batch,
    task_snapshot,
    sync_task_snapshot,
    run_project_write,
    set_is_writing,
    resolve_preferred_row_id,
    remember_preferred_row_id,
    close_edit_dialog: reset_dialog,
    handle_api_error,
    t,
  });

  // 主搜索和筛选面板共用输入防抖；确认、刷新等显式路径会 cancel 后即时查询。
  const search_list_view_query_scheduler = useDebouncedCallback(
    (args: ProofreadingListQueryInput): void => {
      void run_list_view_query(args).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    INPUT_QUERY_DEBOUNCE_MS,
  );

  const filter_panel_query_scheduler = useDebouncedCallback(
    (filters: ProofreadingFilterOptions): void => {
      void run_filter_panel_query(filters, {
        mark_loading: true,
      }).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
      });
    },
    INPUT_QUERY_DEBOUNCE_MS,
  );

  const cancel_pending_list_view_query = useCallback((): void => {
    search_list_view_query_scheduler.cancel();
  }, [search_list_view_query_scheduler]);

  const schedule_search_list_view_query = useCallback(
    (args: ProofreadingListQueryInput): void => {
      search_list_view_query_scheduler.schedule(args);
    },
    [search_list_view_query_scheduler],
  );

  const cancel_pending_cache_bound_queries = useCallback((): void => {
    search_list_view_query_scheduler.cancel();
    filter_panel_query_scheduler.cancel();
  }, [filter_panel_query_scheduler, search_list_view_query_scheduler]);

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
    last_list_query_signature_ref.current = "";
    last_filter_panel_signature_ref.current = "";
  }, [
    cancel_pending_cache_bound_queries,
    invalidate_filter_panel_requests,
    invalidate_list_view_requests,
  ]);

  const clear_table_selection = useCallback((): void => {
    clear_table_selection_state();
  }, [clear_table_selection_state]);

  const clear_transient_state_for_new_project = useCallback((): void => {
    clear_pending_confirmation();
    const empty_dialog_filters = create_empty_filter_options();
    reset_table_state({ persist: false });
    set_filter_dialog_filters(empty_dialog_filters);
    filter_dialog_filters_ref.current = empty_dialog_filters;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_list_revisions({});
    set_operation_revisions({});
    set_settled_project_path("");
    set_replace_text("");
    set_filter_dialog_open(false);
    filter_dialog_open_ref.current = false;
    reset_dialog();
    replace_cursor_ref.current = 0;
    pending_replace_cursor_ref.current = null;
    preferred_row_id_ref.current = null;
    should_select_first_visible_ref.current = false;
    clear_refresh_scroll_anchor();
    pending_reset_filters_ref.current = false;
  }, [clear_pending_confirmation, clear_refresh_scroll_anchor, reset_dialog, reset_table_state]);

  const clear_cache_state = useCallback((): void => {
    clear_pending_confirmation();
    refresh_generation_ref.current += 1;
    invalidate_cache_bound_queries();
    const currentProjectId = resolve_disposable_project_id();
    sync_state_ref.current = null;
    defaultFiltersRef.current = create_empty_filter_options();
    visible_range_ref.current = null;
    list_window_bounds_ref.current = {
      start: 0,
      count: PROOFREADING_INITIAL_WINDOW_ROWS,
    };
    clear_refresh_scroll_anchor();
    const empty_list_view = create_empty_proofreading_list_view();
    set_list_view(empty_list_view);
    list_view_ref.current = empty_list_view;
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_list_revisions({});
    set_operation_revisions({});
    set_is_refreshing(false);
    set_cache_status("idle");
    set_is_writing(false);
    if (currentProjectId !== null) {
      void proofreading_runtime_client_ref.current.dispose_project(currentProjectId);
    }
  }, [
    clear_pending_confirmation,
    clear_refresh_scroll_anchor,
    invalidate_cache_bound_queries,
    resolve_disposable_project_id,
  ]);

  const {
    refresh_snapshot,
    run_list_view_query,
    run_filter_panel_query,
    read_list_window,
    settle_list_view_and_filter_panel,
    read_items_by_row_ids,
    read_current_view_row_ids,
  } = useProofreadingCacheActions({
    cache_status,
    filter_panel,
    list_view,
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
    last_list_query_signature_ref,
    last_visible_range_signature_ref,
    list_view_ref,
    list_view_request_id_ref,
    list_window_bounds_ref,
    list_window_request_id_ref,
    pending_reset_filters_ref,
    proofreading_runtime_client_ref,
    refresh_generation_ref,
    sync_state_ref,
    table_filter_state_ref,
    table_sort_state_ref,
    visible_range_ref,
    clear_cache_state,
    clear_transient_state_for_new_project,
    invalidate_cache_bound_queries,
    publish_refresh_scroll_anchor,
    report_proofreading_list_error,
    resolve_current_filters,
    set_cache_status,
    set_list_revisions,
    set_operation_revisions,
    set_filter_dialog_filters,
    set_filter_dialog_open,
    set_filter_panel,
    set_filter_panel_loading,
    set_is_refreshing,
    set_list_view,
    set_loading_toast_visible,
    set_refresh_retry_nonce,
    set_settled_project_path,
    update_table_filter_state,
    warm_filter_panel_query_ref,
    t,
  });
  read_items_by_row_ids_ref.current = read_items_by_row_ids;

  const warm_filter_panel_query = useCallback(
    (filters: ProofreadingFilterOptions): void => {
      void run_filter_panel_query(filters, {
        force: true,
        mark_loading: false,
      }).catch((error) => {
        report_proofreading_list_error(error, t("proofreading_page.feedback.refresh_failed"));
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
    preferred_row_id_ref,
    proofreading_runtime_client_ref,
    should_select_first_visible_ref,
    sync_state_ref,
    table_filter_state_ref,
    table_sort_state_ref,
    visible_range_ref,
    cancel_pending_list_view_query,
    clear_table_selection,
    filter_panel_query_scheduler,
    read_current_view_row_ids,
    read_list_window,
    report_proofreading_list_error,
    resolve_current_filters,
    run_filter_panel_query,
    run_list_view_query,
    schedule_search_list_view_query,
    set_filter_dialog_filters,
    set_filter_dialog_open,
    set_replace_text,
    set_table_filter_state: update_table_filter_state,
    set_table_selection_state,
    set_table_sort_state,
    settle_list_view_and_filter_panel,
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
      t,
    },
  );

  useProofreadingPageEffects({
    current_filter_signature,
    filter_dialog_filters,
    filter_dialog_open,
    is_regex,
    list_view,
    loading_toast_visible,
    project_loaded: project_snapshot.loaded,
    project_path: project_snapshot.path,
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
  });

  return useMemo<UseProofreadingPageStateResult>(() => {
    return {
      cache_status,
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
      current_filters,
      filter_dialog_filters,
      filter_panel,
      filter_panel_loading,
      visible_items,
      visible_row_count: list_view.row_count,
      sort_state,
      selected_row_ids,
      active_row_id,
      anchor_row_id,
      restore_scroll_row_id,
      preserve_scroll_anchor,
      retranslating_row_ids,
      filter_dialog_open,
      dialog_state,
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
      request_close_dialog: reset_dialog,
      update_dialog_draft,
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
    active_row_id,
    anchor_row_id,
    apply_table_selection,
    apply_table_sort_state,
    cache_status,
    list_revisions,
    close_filter_dialog,
    close_pending_confirmation,
    confirm_filter_dialog_filters,
    confirm_pending_confirmation,
    current_filters,
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
    reset_dialog,
    request_clear_translation_row_ids,
    request_retranslate_row_ids,
    request_set_translation_status_row_ids,
    resolve_visible_row_index,
    restore_scroll_row_id,
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
