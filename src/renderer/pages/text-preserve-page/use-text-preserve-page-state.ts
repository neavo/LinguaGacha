import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import {
  type ProjectMutationOperation,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-project-mutation";
import { useProjectPagesBarrier } from "@/app/page-runtime/project-pages-context";
import { useAppNavigation } from "@/app/navigation/navigation-context";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import {
  buildProofreadingLookupQuery,
  getQualityRuleSlice,
} from "@/project/quality/quality-runtime";
import {
  isQualityStatisticsCacheReady,
  isQualityStatisticsCacheRunning,
  type QualityStatisticsCacheSnapshot,
} from "@/project/quality/quality-statistics-store";
import type { SettingsSnapshotPayload } from "@/app/desktop/desktop-runtime-context";
import { useQualityStatistics } from "@/project/quality/quality-statistics-context";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { is_task_mutation_locked } from "@/project/tasks/task-lock";
import { useDesktopToast } from "@/app/ui-runtime/toast/use-desktop-toast";
import { resolve_visible_error_message } from "@/app/ui-runtime/error-message";
import { useI18n, type LocaleKey } from "@/app/locale/locale-provider";
import {
  build_text_preserve_filter_result,
  has_active_text_preserve_filters,
  resolve_text_preserve_statistics_badge_kind,
  sort_text_preserve_entries,
} from "@/pages/text-preserve-page/filtering";
import {
  PRESERVE_RESULT_VIEW_SOURCE_UPDATE,
  REBUILD_RESULT_VIEW_SOURCE_UPDATE,
  create_result_view_snapshot,
  is_result_view_source_update_ready,
  materialize_result_view_snapshot,
  reconcile_result_view_snapshot,
  type ResultViewSourceUpdateRequest,
  type ResultViewSourceUpdatePolicy,
  type ResultViewSnapshot,
} from "@/pages/result-view-snapshot";
import { create_project_section_result_view_source_update_request } from "@/pages/project-section-result-view-source-update";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "@/project/quality/quality-rule-entry-id";
import { useQualityRuleImportConfirmation } from "@/project/quality/quality-rule-import-confirmation";
import {
  are_text_preserve_entry_ids_equal,
  build_text_preserve_entry_id,
  reorder_text_preserve_selected_group,
} from "@/pages/text-preserve-page/selection";
import type {
  TextPreserveConfirmState,
  TextPreserveDialogState,
  TextPreserveEntry,
  TextPreserveEntryId,
  TextPreserveFilterScope,
  TextPreserveFilterState,
  TextPreserveMode,
  TextPreservePresetInputState,
  TextPreservePresetItem,
  TextPreserveStatisticsBadgeState,
  TextPreserveStatisticsState,
  TextPreserveVisibleEntry,
  UseTextPreservePageStateResult,
} from "@/pages/text-preserve-page/types";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import { normalize_text_preserve_mode } from "@base/quality";
import { QualityRuleImportRuleTypeValue } from "@shared/quality/importer";

type TextPreservePresetPayload = {
  builtin_presets: TextPreservePresetItem[];
  user_presets: TextPreservePresetItem[];
};

type TextPreserveResultViewQuery = {
  filter_state: TextPreserveFilterState;
  sort_state: AppTableSortState | null;
};

// TEXT PRESERVE DEFAULT PRESET SETTINGS KEY 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY = "text_preserve_default_preset";
// TEXT PRESERVE RULE TYPE 是模块级稳定契约，集中维护避免调用点散落魔术值。
const TEXT_PRESERVE_RULE_TYPE = "text_preserve";
// TEXT PRESERVE TITLE KEY 是持久化或快捷键契约，集中保存避免调用点散落魔术字符串。
const TEXT_PRESERVE_TITLE_KEY: LocaleKey = "text_preserve_page.title";
// TEXT PRESERVE EXPORT FILE NAME 是模块级稳定契约，集中维护避免调用点散落魔术值。
const TEXT_PRESERVE_EXPORT_FILE_NAME = "text_preserve.json";
// DEFAULT MODE 是默认快照事实，调用方只读取副本不临时拼装。
const DEFAULT_MODE: TextPreserveMode = "off";
// TEXT PRESERVE MODE REFRESH TIMEOUT MS 是运行时节流或容量阈值，集中保存便于评估性能影响。
const TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS = 15000;
// MODAL PROGRESS TIMEOUT MESSAGE 是运行时节流或容量阈值，集中保存便于评估性能影响。
const MODAL_PROGRESS_TIMEOUT_MESSAGE = "模态进度通知等待超时。";
// 保留文本页分别标记条目保存和模式保存，诊断名由页面领域拥有。
const TEXT_PRESERVE_ENTRIES_SAVE_MUTATION: ProjectMutationOperation = "text_preserve.entries_save";
// TEXT PRESERVE MODE UPDATE MUTATION 是模块级稳定契约，集中维护避免调用点散落魔术值。
const TEXT_PRESERVE_MODE_UPDATE_MUTATION: ProjectMutationOperation = "text_preserve.mode_update";

// EMPTY ENTRY 是默认快照事实，调用方只读取副本不临时拼装。
const EMPTY_ENTRY: TextPreserveEntry = {
  src: "",
  info: "",
};

// clone_entry 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function clone_entry(entry: TextPreserveEntry): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    info: entry.info,
  };
}

// normalize_entry 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_entry(entry: Partial<TextPreserveEntry>): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: String(entry.src ?? "").trim(),
    info: String(entry.info ?? "").trim(),
  };
}

// normalize_imported_entry 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_imported_entry(entry: Record<string, unknown>): TextPreserveEntry {
  return normalize_entry({
    src: String(entry.src ?? ""),
    info: String(entry.info ?? ""),
  });
}

// create_empty_filter_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_empty_filter_state(): TextPreserveFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

// create_empty_dialog_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_empty_dialog_state(): TextPreserveDialogState {
  return {
    open: false,
    mode: "create",
    target_entry_id: null,
    insert_after_entry_id: null,
    draft_entry: clone_entry(EMPTY_ENTRY),
    saving: false,
    validation_message: null,
  };
}

// create_empty_confirm_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_empty_confirm_state(): TextPreserveConfirmState {
  return {
    open: false,
    kind: null,
    selection_count: 0,
    preset_name: "",
    preset_input_value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

// create_empty_preset_input_state 构造跨层载荷，保证字段形状在一个入口维护。
function create_empty_preset_input_state(): TextPreservePresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

// build_user_preset_virtual_id 构造跨层载荷，保证字段形状在一个入口维护。
function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.json`;
}

// normalize_preset_name 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_preset_name(name: string): string {
  return name.trim();
}

// has_casefold_duplicate_preset 集中表达布尔判定口径，避免调用方按局部字段猜测。
function has_casefold_duplicate_preset(
  preset_items: TextPreservePresetItem[],
  target_virtual_id: string,
  current_virtual_id: string | null,
): boolean {
  const target_key = target_virtual_id.toLocaleLowerCase();

  return preset_items.some((item) => {
    if (item.type !== "user") {
      return false;
    }

    if (current_virtual_id !== null && item.virtual_id === current_virtual_id) {
      return false;
    }

    return item.virtual_id.toLocaleLowerCase() === target_key;
  });
}

// decorate_preset_items 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function decorate_preset_items(
  builtin_presets: TextPreservePresetItem[],
  user_presets: TextPreservePresetItem[],
  default_virtual_id: string,
): TextPreservePresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => {
    return {
      ...item,
      is_default: item.virtual_id === default_virtual_id,
    };
  });
}

// build_statistics_badge_tooltip 构造跨层载荷，保证字段形状在一个入口维护。
function build_statistics_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: TextPreserveEntry,
  matched_count: number,
  subset_parent_labels: string[],
): string {
  const tooltip_lines = [
    t("text_preserve_page.statistics.hit_count").replace("{COUNT}", matched_count.toString()),
  ];

  if (subset_parent_labels.length > 0) {
    tooltip_lines.push(t("text_preserve_page.statistics.subset_relations"));
    tooltip_lines.push(
      ...subset_parent_labels.map((label) => {
        return t("text_preserve_page.statistics.relation_line")
          .replace("{CHILD}", entry.src)
          .replace("{PARENT}", label);
      }),
    );
  }

  return tooltip_lines.join("\n");
}

// build_default_preset_update_payload 构造跨层载荷，保证字段形状在一个入口维护。
function build_default_preset_update_payload(value: string): Record<string, string> {
  return {
    [TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY]: value,
  };
}

// is_modal_progress_timeout_error 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_modal_progress_timeout_error(error: unknown): boolean {
  return error instanceof Error && error.message === MODAL_PROGRESS_TIMEOUT_MESSAGE;
}

// build_text_preserve_statistics_state_from_cache 构造跨层载荷，保证字段形状在一个入口维护。
function build_text_preserve_statistics_state_from_cache(
  statistics_cache: QualityStatisticsCacheSnapshot,
): TextPreserveStatisticsState {
  // 页面只从质量统计缓存派生展示状态，不持有也不修改文本保护规则事实。
  return {
    running: isQualityStatisticsCacheRunning(statistics_cache),
    completed_snapshot: statistics_cache.completed_snapshot,
    completed_entry_ids: statistics_cache.completed_entry_ids,
    matched_count_by_entry_id: statistics_cache.matched_count_by_entry_id,
    subset_parent_labels_by_entry_id: statistics_cache.subset_parent_labels_by_entry_id,
  };
}

// useTextPreservePageState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useTextPreservePageState(): UseTextPreservePageStateResult {
  const { t } = useI18n();
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectPagesBarrier();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const {
    project_snapshot,
    project_store,
    settings_snapshot,
    apply_settings_snapshot,
    commit_project_mutation,
    task_snapshot,
  } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );

  const preserve_slice = useMemo(() => {
    return getQualityRuleSlice(project_store_state.quality, TEXT_PRESERVE_RULE_TYPE);
  }, [project_store_state.quality]);
  const mode = project_snapshot.loaded
    ? normalize_text_preserve_mode(preserve_slice.mode)
    : DEFAULT_MODE;
  const entries = useMemo<TextPreserveEntry[]>(() => {
    if (!project_snapshot.loaded) {
      return [];
    }

    return ensure_quality_rule_entry_ids(
      preserve_slice.entries.map((entry) => {
        return normalize_entry(entry);
      }),
    );
  }, [preserve_slice.entries, project_snapshot.loaded]);
  const [mode_updating, set_mode_updating] = useState(false);
  const [preset_items, set_preset_items] = useState<TextPreservePresetItem[]>([]);
  const [selected_entry_ids, set_selected_entry_ids] = useState<TextPreserveEntryId[]>([]);
  const [active_entry_id, set_active_entry_id] = useState<TextPreserveEntryId | null>(null);
  const [selection_anchor_entry_id, set_selection_anchor_entry_id] =
    useState<TextPreserveEntryId | null>(null);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const [filter_state, set_filter_state] = useState<TextPreserveFilterState>(() => {
    return create_empty_filter_state();
  });
  const [sort_state, set_sort_state] = useState<AppTableSortState | null>(null);
  const [result_view_snapshot, set_result_view_snapshot] = useState<ResultViewSnapshot<
    TextPreserveResultViewQuery,
    TextPreserveEntryId
  > | null>(null);
  // 保存类 action 返回的项目 section 事实源负责跨越 HTTP / SSE 先后到达的竞态。
  const [pending_result_view_source_update, set_pending_result_view_source_update] =
    useState<ResultViewSourceUpdateRequest | null>(null);
  const [dialog_state, set_dialog_state] = useState<TextPreserveDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [confirm_state, set_confirm_state] = useState<TextPreserveConfirmState>(() => {
    return create_empty_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<TextPreservePresetInputState>(
    () => {
      return create_empty_preset_input_state();
    },
  );
  const unknown_error_message = t("text_preserve_page.feedback.unknown_error");
  const mode_ref = useRef(mode);
  const mode_update_in_flight_ref = useRef(false);
  const dialog_state_ref = useRef(dialog_state);
  const statistics_cache = useQualityStatistics(TEXT_PRESERVE_RULE_TYPE);
  const statistics_state = useMemo<TextPreserveStatisticsState>(() => {
    return build_text_preserve_statistics_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const statistics_ready = isQualityStatisticsCacheReady(statistics_cache);

  useEffect(() => {
    mode_ref.current = mode;
  }, [mode]);

  useEffect(() => {
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

  const entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return entries.map((entry, index) => {
      return build_text_preserve_entry_id(entry, index);
    });
  }, [entries]);

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]));
  }, [entry_ids]);

  const resolve_create_insert_after_entry_id = useCallback((): TextPreserveEntryId | null => {
    if (active_entry_id !== null && entry_index_by_id.has(active_entry_id)) {
      return active_entry_id;
    }

    for (let index = selected_entry_ids.length - 1; index >= 0; index -= 1) {
      const selected_entry_id = selected_entry_ids[index];
      if (selected_entry_id !== undefined && entry_index_by_id.has(selected_entry_id)) {
        return selected_entry_id;
      }
    }

    return null;
  }, [active_entry_id, entry_index_by_id, selected_entry_ids]);
  const completed_statistics_entry_id_set = useMemo<ReadonlySet<TextPreserveEntryId>>(() => {
    return new Set(statistics_state.completed_entry_ids);
  }, [statistics_state.completed_entry_ids]);

  const build_result_view_snapshot = useCallback(
    (
      next_filter_state: TextPreserveFilterState,
      next_sort_state: AppTableSortState | null,
    ): ResultViewSnapshot<TextPreserveResultViewQuery, TextPreserveEntryId> => {
      const result = build_text_preserve_filter_result({
        entries,
        entry_ids,
        filter_state: next_filter_state,
      });
      const visible_entries = sort_text_preserve_entries(
        result.visible_entries,
        next_sort_state,
        statistics_ready,
        statistics_state,
      );

      return create_result_view_snapshot({
        applied_query: {
          filter_state: next_filter_state,
          sort_state: next_sort_state,
        },
        ordered_ids: visible_entries.map((entry) => entry.entry_id),
        invalid_message: result.invalid_regex_message,
      });
    },
    [entries, entry_ids, statistics_ready, statistics_state],
  );
  // 筛选控件状态即时更新；结果视图快照延迟刷新，显式 action 会 cancel 后立即重建。
  const debounced_result_view_snapshot = useDebouncedCallback(
    (
      next_filter_state: TextPreserveFilterState,
      next_sort_state: AppTableSortState | null,
    ): void => {
      set_result_view_snapshot(build_result_view_snapshot(next_filter_state, next_sort_state));
    },
  );

  const filter_result = useMemo(() => {
    return build_text_preserve_filter_result({
      entries,
      entry_ids,
      filter_state,
    });
  }, [entries, entry_ids, filter_state]);

  const filtered_entries = useMemo<TextPreserveVisibleEntry[]>(() => {
    if (result_view_snapshot !== null) {
      return materialize_result_view_snapshot({
        snapshot: result_view_snapshot,
        item_by_id: new Map(
          entries.flatMap((entry, source_index) => {
            const entry_id = entry_ids[source_index];
            return entry_id === undefined ? [] : [[entry_id, { entry, entry_id, source_index }]];
          }),
        ),
      });
    }

    return sort_text_preserve_entries(
      filter_result.visible_entries,
      sort_state,
      statistics_ready,
      statistics_state,
    );
  }, [
    entries,
    entry_ids,
    filter_result.visible_entries,
    result_view_snapshot,
    sort_state,
    statistics_ready,
    statistics_state,
  ]);

  useEffect(() => {
    const should_rebuild_from_source = is_result_view_source_update_ready({
      request: pending_result_view_source_update,
      current_source_checkpoint: {
        projectPath: project_store_state.project.path,
        sections: project_store_state.revisions.sections,
      },
    });
    set_result_view_snapshot((previous_snapshot) => {
      const valid_entry_id_set = new Set(entry_ids);
      return reconcile_result_view_snapshot({
        previous_snapshot,
        current_snapshot: build_result_view_snapshot(filter_state, sort_state),
        valid_id_set: valid_entry_id_set,
        source_update_policy: should_rebuild_from_source
          ? pending_result_view_source_update?.policy
          : PRESERVE_RESULT_VIEW_SOURCE_UPDATE,
      });
    });
    if (should_rebuild_from_source) {
      set_pending_result_view_source_update(null);
    }
  }, [
    build_result_view_snapshot,
    entry_ids,
    filter_state,
    project_store_state.project.path,
    project_store_state.revisions.sections,
    pending_result_view_source_update,
    sort_state,
  ]);

  const visible_entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id);
  }, [filtered_entries]);

  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids);
  }, [visible_entry_ids]);

  const has_active_filters = has_active_text_preserve_filters(filter_state);
  const readonly = is_task_mutation_locked(task_snapshot);
  const drag_disabled = readonly || has_active_filters || sort_state !== null;

  const statistics_badge_by_entry_id = useMemo<
    Record<TextPreserveEntryId, TextPreserveStatisticsBadgeState>
  >(() => {
    const next_badge_by_entry_id: Record<TextPreserveEntryId, TextPreserveStatisticsBadgeState> =
      {};
    if (!statistics_ready && statistics_state.completed_snapshot === null) {
      return next_badge_by_entry_id;
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index];
      if (entry_id === undefined) {
        return;
      }

      const kind = resolve_text_preserve_statistics_badge_kind(
        entry_id,
        statistics_state,
        completed_statistics_entry_id_set,
      );
      if (kind === null) {
        return;
      }

      const matched_count = statistics_state.matched_count_by_entry_id[entry_id] ?? 0;
      const subset_parent_labels =
        statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? [];

      next_badge_by_entry_id[entry_id] = {
        kind,
        matched_count,
        subset_parent_labels,
        tooltip: build_statistics_badge_tooltip(t, entry, matched_count, subset_parent_labels),
      };
    });

    return next_badge_by_entry_id;
  }, [
    completed_statistics_entry_id_set,
    entries,
    entry_ids,
    statistics_ready,
    statistics_state,
    t,
  ]);

  const clear_selection_state = useCallback((): void => {
    set_selected_entry_ids([]);
    set_active_entry_id(null);
    set_selection_anchor_entry_id(null);
  }, []);

  const push_action_error_toast = useCallback(
    (error: unknown): void => {
      push_toast("error", resolve_visible_error_message(error, t, unknown_error_message));
    },
    [push_toast, unknown_error_message],
  );

  const save_entries_snapshot = useCallback(
    async (
      next_entries: TextPreserveEntry[],
      result_view_update: ResultViewSourceUpdatePolicy = PRESERVE_RESULT_VIEW_SOURCE_UPDATE,
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const current_state = project_store.getState();
      const normalized_entries = ensure_quality_rule_entry_ids(
        next_entries.map((entry) => {
          return normalize_entry(entry);
        }),
      );

      try {
        await commit_project_mutation({
          operation: TEXT_PRESERVE_ENTRIES_SAVE_MUTATION,
          run: async () => {
            return await api_fetch<ProjectMutationResultPayload>(
              "/api/quality/rules/save-entries",
              {
                rule_type: TEXT_PRESERVE_RULE_TYPE,
                expected_section_revisions: {
                  quality: current_state.revisions.sections.quality ?? 0,
                },
                entries: normalized_entries,
              },
            );
          },
          prepare: ({ mutation_result }) => {
            set_pending_result_view_source_update(
              create_project_section_result_view_source_update_request({
                mutation_result,
                policy: result_view_update,
                section: "quality",
              }),
            );
          },
        });
        return true;
      } catch (error) {
        set_pending_result_view_source_update(null);
        push_action_error_toast(error);
        return false;
      }
    },
    [commit_project_mutation, project_store, push_action_error_toast, readonly],
  );

  const apply_import_entries = useCallback(
    async (
      next_entries: TextPreserveEntry[],
      options: {
        close_preset_menu: boolean;
      },
    ): Promise<boolean> => {
      const saved = await save_entries_snapshot(next_entries, REBUILD_RESULT_VIEW_SOURCE_UPDATE);
      if (!saved) {
        return false;
      }

      clear_selection_state();
      push_toast("success", t("text_preserve_page.feedback.import_success"));

      if (options.close_preset_menu) {
        set_preset_menu_open(false);
      }

      return true;
    },
    [clear_selection_state, push_toast, save_entries_snapshot, t],
  );

  const get_import_existing_entries = useCallback((): TextPreserveEntry[] => {
    const current_preserve_slice = getQualityRuleSlice(
      project_store.getState().quality,
      TEXT_PRESERVE_RULE_TYPE,
    );
    return current_preserve_slice.entries as TextPreserveEntry[];
  }, [project_store]);
  const import_confirmation = useQualityRuleImportConfirmation<TextPreserveEntry>({
    rule_type: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
    get_existing_entries: get_import_existing_entries,
    apply_entries: apply_import_entries,
  });
  const {
    import_confirm_state,
    persist_import_entries,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
  } = import_confirmation;

  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<TextPreservePresetPayload>(
      "/api/quality/rules/presets",
      {
        rule_type: TEXT_PRESERVE_RULE_TYPE,
      },
    );
    const default_virtual_id = String(
      settings_snapshot[TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY] ?? "",
    );

    set_preset_items(
      decorate_preset_items(
        preset_payload.builtin_presets,
        preset_payload.user_presets,
        default_virtual_id,
      ),
    );
  }, [settings_snapshot]);

  useEffect(() => {
    set_result_view_snapshot(null);
    set_pending_result_view_source_update(null);
  }, [project_snapshot.loaded, project_snapshot.path]);

  useEffect(() => {
    if (statistics_ready || sort_state?.column_id !== "statistics") {
      return;
    }

    set_sort_state(null);
    set_result_view_snapshot(build_result_view_snapshot(filter_state, null));
  }, [build_result_view_snapshot, filter_state, sort_state, statistics_ready]);

  useEffect(() => {
    set_selected_entry_ids((previous_ids) => {
      return previous_ids.filter((entry_id) => {
        return entry_index_by_id.has(entry_id) && visible_entry_id_set.has(entry_id);
      });
    });

    if (active_entry_id !== null && !visible_entry_id_set.has(active_entry_id)) {
      set_active_entry_id(null);
    }

    if (
      selection_anchor_entry_id !== null &&
      !visible_entry_id_set.has(selection_anchor_entry_id)
    ) {
      set_selection_anchor_entry_id(null);
    }
  }, [active_entry_id, entry_index_by_id, selection_anchor_entry_id, visible_entry_id_set]);

  const update_filter_keyword = useCallback(
    (next_keyword: string): void => {
      const next_filter_state = {
        ...filter_state,
        keyword: next_keyword,
      };
      // 首次快照尚未落地时，先冻结旧查询结果，再让输入防抖决定何时应用新查询。
      set_result_view_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_view_snapshot(filter_state, sort_state);
      });
      set_filter_state(next_filter_state);
      debounced_result_view_snapshot.schedule(next_filter_state, sort_state);
    },
    [build_result_view_snapshot, debounced_result_view_snapshot, filter_state, sort_state],
  );

  const update_filter_scope = useCallback(
    (next_scope: TextPreserveFilterScope): void => {
      const next_filter_state = {
        ...filter_state,
        scope: next_scope,
      };
      set_result_view_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_view_snapshot(filter_state, sort_state);
      });
      set_filter_state(next_filter_state);
      debounced_result_view_snapshot.schedule(next_filter_state, sort_state);
    },
    [build_result_view_snapshot, debounced_result_view_snapshot, filter_state, sort_state],
  );

  const update_filter_regex = useCallback(
    (next_is_regex: boolean): void => {
      const next_filter_state = {
        ...filter_state,
        is_regex: next_is_regex,
      };
      set_result_view_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_view_snapshot(filter_state, sort_state);
      });
      set_filter_state(next_filter_state);
      debounced_result_view_snapshot.schedule(next_filter_state, sort_state);
    },
    [build_result_view_snapshot, debounced_result_view_snapshot, filter_state, sort_state],
  );

  const apply_table_sort_state = useCallback(
    (next_sort_state: AppTableSortState | null): void => {
      debounced_result_view_snapshot.cancel();
      set_sort_state(next_sort_state);
      set_result_view_snapshot(build_result_view_snapshot(filter_state, next_sort_state));
    },
    [build_result_view_snapshot, debounced_result_view_snapshot, filter_state],
  );

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_entry_ids((previous_ids) => {
      return are_text_preserve_entry_ids_equal(previous_ids, payload.selected_row_ids)
        ? previous_ids
        : payload.selected_row_ids;
    });
    set_active_entry_id((previous_entry_id) => {
      return previous_entry_id === payload.active_row_id
        ? previous_entry_id
        : payload.active_row_id;
    });
    set_selection_anchor_entry_id((previous_entry_id) => {
      return previous_entry_id === payload.anchor_row_id
        ? previous_entry_id
        : payload.anchor_row_id;
    });
  }, []);

  const update_mode = useCallback(
    async (next_mode: TextPreserveMode): Promise<void> => {
      const previous_mode = mode_ref.current;
      if (readonly || mode_update_in_flight_ref.current || previous_mode === next_mode) {
        return;
      }

      mode_update_in_flight_ref.current = true;
      set_mode_updating(true);
      const barrier_checkpoint = create_barrier_checkpoint();
      let snapshot_committed = false;

      try {
        await run_modal_progress_toast({
          message: t("text_preserve_page.mode.loading_toast"),
          timeout_ms: TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS,
          task: async () => {
            const current_state = project_store.getState();
            await commit_project_mutation({
              operation: TEXT_PRESERVE_MODE_UPDATE_MUTATION,
              run: async () => {
                return await api_fetch<ProjectMutationResultPayload>(
                  "/api/quality/rules/update-meta",
                  {
                    rule_type: TEXT_PRESERVE_RULE_TYPE,
                    expected_section_revisions: {
                      quality: current_state.revisions.sections.quality ?? 0,
                    },
                    meta: {
                      mode: next_mode,
                    },
                  },
                );
              },
            });
            snapshot_committed = true;

            await wait_for_barrier("proofreading_cache_refresh", {
              checkpoint: barrier_checkpoint,
            });
          },
        });
      } catch (error) {
        if (snapshot_committed && is_modal_progress_timeout_error(error)) {
          push_toast("warning", t("text_preserve_page.feedback.mode_refresh_pending"));
        } else {
          push_action_error_toast(error);
        }
      } finally {
        mode_update_in_flight_ref.current = false;
        set_mode_updating(false);
      }
    },
    [
      commit_project_mutation,
      create_barrier_checkpoint,
      project_store,
      push_toast,
      push_action_error_toast,
      readonly,
      run_modal_progress_toast,
      t,
      wait_for_barrier,
    ],
  );

  const open_create_dialog = useCallback((): void => {
    if (readonly) {
      return;
    }

    const insert_after_entry_id = resolve_create_insert_after_entry_id();

    clear_selection_state();
    set_dialog_state({
      open: true,
      mode: "create",
      target_entry_id: null,
      insert_after_entry_id,
      draft_entry: clone_entry(EMPTY_ENTRY),
      saving: false,
      validation_message: null,
    });
  }, [clear_selection_state, readonly, resolve_create_insert_after_entry_id]);

  const open_edit_dialog = useCallback(
    (entry_id: TextPreserveEntryId): void => {
      if (readonly) {
        return;
      }

      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];

      if (target_entry === null || target_entry === undefined) {
        return;
      }

      set_active_entry_id(entry_id);
      set_selected_entry_ids([entry_id]);
      set_selection_anchor_entry_id(entry_id);
      set_dialog_state({
        open: true,
        mode: "edit",
        target_entry_id: entry_id,
        insert_after_entry_id: null,
        draft_entry: clone_entry(target_entry),
        saving: false,
        validation_message: null,
      });
    },
    [entries, entry_index_by_id, readonly],
  );

  const update_dialog_draft = useCallback((patch: Partial<TextPreserveEntry>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        validation_message: null,
        draft_entry: {
          ...previous_state.draft_entry,
          ...patch,
        },
      };
    });
  }, []);

  const commit_remove_entry_ids = useCallback(
    async (target_entry_ids: TextPreserveEntryId[]): Promise<boolean> => {
      if (target_entry_ids.length === 0) {
        return true;
      }

      const target_set = new Set(target_entry_ids);
      const previous_selected_entry_ids = selected_entry_ids;
      const previous_active_entry_id = active_entry_id;
      const previous_anchor_entry_id = selection_anchor_entry_id;
      const next_entries = entries.filter((_entry, index) => {
        return !target_set.has(entry_ids[index] ?? "");
      });

      clear_selection_state();

      const saved = await save_entries_snapshot(next_entries);
      if (!saved) {
        set_selected_entry_ids(previous_selected_entry_ids);
        set_active_entry_id(previous_active_entry_id);
        set_selection_anchor_entry_id(previous_anchor_entry_id);
        return false;
      }

      set_dialog_state(create_empty_dialog_state());
      return true;
    },
    [
      active_entry_id,
      clear_selection_state,
      entries,
      entry_ids,
      save_entries_snapshot,
      selected_entry_ids,
      selection_anchor_entry_id,
    ],
  );

  const delete_selected_entries = useCallback(async (): Promise<void> => {
    if (readonly || selected_entry_ids.length === 0) {
      return;
    }

    set_confirm_state({
      open: true,
      kind: "delete-selection",
      selection_count: selected_entry_ids.length,
      preset_name: "",
      preset_input_value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, [readonly, selected_entry_ids]);

  const reorder_selected_entries = useCallback(
    async (
      current_active_entry_id: TextPreserveEntryId,
      over_entry_id: TextPreserveEntryId,
    ): Promise<void> => {
      if (drag_disabled || current_active_entry_id === over_entry_id) {
        return;
      }

      const next_entries = reorder_text_preserve_selected_group(
        entries,
        entry_ids,
        selected_entry_ids,
        current_active_entry_id,
        over_entry_id,
      );

      await save_entries_snapshot(next_entries, REBUILD_RESULT_VIEW_SOURCE_UPDATE);
    },
    [drag_disabled, entries, entry_ids, save_entries_snapshot, selected_entry_ids],
  );

  const query_entry_source = useCallback(
    async (entry_id: TextPreserveEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            entry: normalize_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [
      entries,
      entry_index_by_id,
      navigate_to_route,
      push_proofreading_lookup_intent,
      push_action_error_toast,
    ],
  );

  const search_entry_relations_from_statistics = useCallback(
    (entry_id: TextPreserveEntryId): void => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      const next_filter_state = {
        keyword: target_entry.src,
        scope: "src" as const,
        is_regex: false,
      };
      debounced_result_view_snapshot.cancel();
      set_filter_state(next_filter_state);
      set_sort_state(null);
      set_result_view_snapshot(build_result_view_snapshot(next_filter_state, null));
    },
    [build_result_view_snapshot, debounced_result_view_snapshot, entries, entry_index_by_id],
  );

  const import_entries_from_path = useCallback(
    async (path: string): Promise<void> => {
      try {
        if (readonly || path.trim() === "") {
          return;
        }

        const payload = await api_fetch<{ entries?: Array<Record<string, unknown>> }>(
          "/api/quality/rules/import",
          {
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            path,
          },
        );
        const imported_entries = Array.isArray(payload.entries)
          ? payload.entries.map((entry) => {
              return normalize_imported_entry(entry);
            })
          : [];
        if (imported_entries.length === 0) {
          push_toast("warning", t("app.feedback.no_valid_data"));
          return;
        }

        await persist_import_entries(imported_entries, { close_preset_menu: false });
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [persist_import_entries, push_action_error_toast, push_toast, readonly, t],
  );

  const import_entries_from_picker = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    const pick_result = await window.desktopApp.pickGlossaryImportFilePath();
    const selected_path = pick_result.paths[0] ?? null;
    if (pick_result.canceled || selected_path === null) {
      return;
    }

    await import_entries_from_path(selected_path);
  }, [import_entries_from_path, readonly]);

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickGlossaryExportPath(
        TEXT_PRESERVE_EXPORT_FILE_NAME,
      );
      const selected_path = pick_result.paths[0] ?? null;
      if (pick_result.canceled || selected_path === null) {
        return;
      }

      await api_fetch("/api/quality/rules/export", {
        rule_type: TEXT_PRESERVE_RULE_TYPE,
        path: selected_path,
        entries: entries.map((entry) => {
          return normalize_entry(entry);
        }),
      });
      push_toast("success", t("text_preserve_page.feedback.export_success"));
    } catch (error) {
      push_action_error_toast(error);
    }
  }, [entries, push_action_error_toast, push_toast, t]);

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
      set_preset_menu_open(true);
    } catch (error) {
      set_preset_menu_open(false);
      push_action_error_toast(error);
    }
  }, [push_action_error_toast, refresh_preset_menu]);

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<{ entries: Array<Record<string, unknown>> }>(
          "/api/quality/rules/presets/read",
          {
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            virtual_id,
          },
        );
        await persist_import_entries(
          payload.entries.map((entry) => {
            return normalize_imported_entry(entry);
          }),
          { close_preset_menu: true },
        );
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [persist_import_entries, push_action_error_toast, readonly],
  );

  const request_reset_entries = useCallback((): void => {
    if (readonly) {
      return;
    }

    set_confirm_state({
      open: true,
      kind: "reset",
      selection_count: 0,
      preset_name: "",
      preset_input_value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, [readonly]);

  const request_save_preset = useCallback((): void => {
    if (readonly) {
      return;
    }

    set_preset_input_state({
      open: true,
      mode: "save",
      value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, [readonly]);

  const request_rename_preset = useCallback(
    (preset_item: TextPreservePresetItem): void => {
      if (readonly) {
        return;
      }

      set_preset_input_state({
        open: true,
        mode: "rename",
        value: preset_item.name,
        submitting: false,
        target_virtual_id: preset_item.virtual_id,
      });
    },
    [readonly],
  );

  const request_delete_preset = useCallback(
    (preset_item: TextPreservePresetItem): void => {
      if (readonly) {
        return;
      }

      set_confirm_state({
        open: true,
        kind: "delete-preset",
        selection_count: 0,
        preset_name: preset_item.name,
        preset_input_value: "",
        submitting: false,
        target_virtual_id: preset_item.virtual_id,
      });
    },
    [readonly],
  );

  const save_preset = useCallback(
    async (name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("text_preserve_page.feedback.preset_name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/rules/presets/save", {
          rule_type: TEXT_PRESERVE_RULE_TYPE,
          name: normalized_name,
          entries: entries
            .map((entry) => {
              return normalize_entry(entry);
            })
            .filter((entry) => entry.src !== ""),
        });
        await refresh_preset_menu();
        push_toast("success", t("text_preserve_page.feedback.preset_saved"));
        return true;
      } catch (error) {
        push_action_error_toast(error);
        return false;
      }
    },
    [entries, push_action_error_toast, push_toast, readonly, refresh_preset_menu, t],
  );

  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("text_preserve_page.feedback.preset_name_required"));
        return false;
      }

      try {
        const payload = await api_fetch<{ item?: TextPreservePresetItem }>(
          "/api/quality/rules/presets/rename",
          {
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            virtual_id,
            new_name: normalized_name,
          },
        );
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            build_default_preset_update_payload(String(payload.item?.virtual_id ?? "")),
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        push_toast("success", t("text_preserve_page.feedback.preset_renamed"));
        return true;
      } catch (error) {
        push_action_error_toast(error);
        return false;
      }
    },
    [
      preset_items,
      push_action_error_toast,
      push_toast,
      refresh_preset_menu,
      readonly,
      apply_settings_snapshot,
      t,
    ],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>(
          "/api/settings/update",
          build_default_preset_update_payload(virtual_id),
        );
        apply_settings_snapshot(payload);
        await refresh_preset_menu();
        push_toast("success", t("text_preserve_page.feedback.default_preset_set"));
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [
      apply_settings_snapshot,
      push_action_error_toast,
      push_toast,
      readonly,
      refresh_preset_menu,
      t,
    ],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        "/api/settings/update",
        build_default_preset_update_payload(""),
      );
      apply_settings_snapshot(payload);
      await refresh_preset_menu();
      push_toast("success", t("text_preserve_page.feedback.default_preset_cleared"));
    } catch (error) {
      push_action_error_toast(error);
    }
  }, [
    push_action_error_toast,
    push_toast,
    readonly,
    refresh_preset_menu,
    apply_settings_snapshot,
    t,
  ]);

  const validate_entry = useCallback(
    (entry: TextPreserveEntry): string | null => {
      if (entry.src === "") {
        return null;
      }

      try {
        void new RegExp(entry.src, "i");
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return `${t("text_preserve_page.feedback.regex_invalid")}: ${detail}`;
      }
    },
    [t],
  );

  const persist_dialog_entry = useCallback(async (): Promise<boolean> => {
    if (readonly) {
      return false;
    }

    const current_dialog_state = dialog_state;
    const normalized_entry = {
      ...normalize_entry(dialog_state.draft_entry),
      entry_id: dialog_state.draft_entry.entry_id ?? create_quality_rule_entry_id(),
    };
    const validation_message = validate_entry(normalized_entry);
    if (validation_message !== null) {
      set_dialog_state((previous_state) => {
        return {
          ...previous_state,
          validation_message,
        };
      });
      push_toast("error", validation_message);
      return false;
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: true,
      validation_message: null,
    }));

    const next_entries =
      dialog_state.mode === "create"
        ? (() => {
            const insert_after_index =
              dialog_state.insert_after_entry_id === null
                ? -1
                : entry_ids.findIndex(
                    (entry_id) => entry_id === dialog_state.insert_after_entry_id,
                  );
            const insert_index = insert_after_index < 0 ? entries.length : insert_after_index + 1;
            const draft_entries = [...entries];

            draft_entries.splice(insert_index, 0, normalized_entry);
            return draft_entries;
          })()
        : entries.map((entry, index) => {
            return entry_ids[index] === dialog_state.target_entry_id
              ? {
                  ...entry,
                  ...normalized_entry,
                }
              : entry;
          });

    const reopen_dialog_state: TextPreserveDialogState = {
      ...current_dialog_state,
      saving: false,
      validation_message: null,
    };
    set_dialog_state(create_empty_dialog_state());

    const saved = await save_entries_snapshot(
      next_entries,
      dialog_state.mode === "create"
        ? REBUILD_RESULT_VIEW_SOURCE_UPDATE
        : PRESERVE_RESULT_VIEW_SOURCE_UPDATE,
    );
    if (saved) {
      push_toast("success", t("app.feedback.save_success"));
      return true;
    }

    if (!dialog_state_ref.current.open) {
      set_dialog_state(reopen_dialog_state);
    }
    return false;
  }, [
    dialog_state,
    entries,
    entry_ids,
    push_toast,
    readonly,
    save_entries_snapshot,
    t,
    validate_entry,
  ]);

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    await persist_dialog_entry();
  }, [persist_dialog_entry]);

  const request_close_dialog = useCallback(async (): Promise<void> => {
    set_dialog_state(create_empty_dialog_state());
  }, []);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_confirm_state());
  }, []);

  const close_preset_input_dialog = useCallback((): void => {
    set_preset_input_state(create_empty_preset_input_state());
  }, []);

  const update_preset_input_value = useCallback((next_value: string): void => {
    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        value: next_value,
      };
    });
  }, []);

  const submit_preset_input = useCallback(async (): Promise<void> => {
    if (readonly || !preset_input_state.open || preset_input_state.mode === null) {
      return;
    }

    const normalized_name = normalize_preset_name(preset_input_state.value);
    if (normalized_name === "") {
      push_toast("warning", t("text_preserve_page.feedback.preset_name_required"));
      return;
    }

    const next_virtual_id = build_user_preset_virtual_id(normalized_name);
    if (
      preset_input_state.mode === "save" &&
      has_casefold_duplicate_preset(preset_items, next_virtual_id, null)
    ) {
      set_confirm_state({
        open: true,
        kind: "overwrite-preset",
        selection_count: 0,
        preset_name: normalized_name,
        preset_input_value: normalized_name,
        submitting: false,
        target_virtual_id: null,
      });
      return;
    }

    if (
      preset_input_state.mode === "rename" &&
      has_casefold_duplicate_preset(
        preset_items,
        next_virtual_id,
        preset_input_state.target_virtual_id,
      )
    ) {
      push_toast("warning", t("text_preserve_page.feedback.preset_exists"));
      return;
    }

    set_preset_input_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      };
    });

    const succeeded =
      preset_input_state.mode === "save"
        ? await save_preset(normalized_name)
        : preset_input_state.target_virtual_id === null
          ? false
          : await rename_preset(preset_input_state.target_virtual_id, normalized_name);

    if (succeeded) {
      set_preset_input_state(create_empty_preset_input_state());
    } else {
      set_preset_input_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [preset_input_state, preset_items, push_toast, readonly, rename_preset, save_preset, t]);

  const reset_entries = useCallback(async (): Promise<boolean> => {
    if (readonly) {
      return false;
    }

    const saved = await save_entries_snapshot([], REBUILD_RESULT_VIEW_SOURCE_UPDATE);
    if (!saved) {
      return false;
    }

    clear_selection_state();
    push_toast("success", t("text_preserve_page.feedback.reset_success"));
    set_preset_menu_open(false);
    return true;
  }, [clear_selection_state, push_toast, readonly, save_entries_snapshot, t]);

  const confirm_pending_action = useCallback(async (): Promise<void> => {
    if (readonly || !confirm_state.open || confirm_state.kind === null) {
      return;
    }

    set_confirm_state((previous_state) => {
      return {
        ...previous_state,
        submitting: true,
      };
    });

    let succeeded = false;

    if (confirm_state.kind === "delete-selection") {
      succeeded = await commit_remove_entry_ids(selected_entry_ids);
    } else if (confirm_state.kind === "reset") {
      succeeded = await reset_entries();
    } else if (confirm_state.kind === "delete-preset") {
      try {
        if (confirm_state.target_virtual_id !== null) {
          await api_fetch("/api/quality/rules/presets/delete", {
            rule_type: TEXT_PRESERVE_RULE_TYPE,
            virtual_id: confirm_state.target_virtual_id,
          });

          const target_preset = preset_items.find((item) => {
            return item.virtual_id === confirm_state.target_virtual_id;
          });
          if (target_preset?.is_default) {
            const settings_payload = await api_fetch<SettingsSnapshotPayload>(
              "/api/settings/update",
              build_default_preset_update_payload(""),
            );
            apply_settings_snapshot(settings_payload);
          }
          await refresh_preset_menu();
          push_toast("success", t("text_preserve_page.feedback.preset_deleted"));
          succeeded = true;
        }
      } catch (error) {
        push_action_error_toast(error);
      }
    } else if (confirm_state.kind === "overwrite-preset") {
      succeeded = await save_preset(confirm_state.preset_input_value);
      if (succeeded) {
        set_preset_input_state(create_empty_preset_input_state());
      }
    }

    if (succeeded) {
      set_confirm_state(create_empty_confirm_state());
    } else {
      set_confirm_state((previous_state) => {
        return {
          ...previous_state,
          submitting: false,
        };
      });
    }
  }, [
    commit_remove_entry_ids,
    confirm_state,
    preset_items,
    push_toast,
    push_action_error_toast,
    refresh_preset_menu,
    reset_entries,
    readonly,
    save_preset,
    selected_entry_ids,
    apply_settings_snapshot,
    t,
  ]);

  return {
    title_key: TEXT_PRESERVE_TITLE_KEY,
    mode,
    mode_updating,
    filtered_entries,
    filter_state,
    sort_state,
    invalid_filter_message:
      result_view_snapshot?.invalid_message ?? filter_result.invalid_regex_message,
    readonly,
    drag_disabled,
    statistics_state,
    statistics_ready,
    statistics_badge_by_entry_id,
    preset_items,
    selected_entry_ids,
    active_entry_id,
    selection_anchor_entry_id,
    preset_menu_open,
    dialog_state,
    confirm_state,
    import_confirm_state,
    preset_input_state,
    update_filter_keyword,
    update_filter_scope,
    update_filter_regex,
    apply_table_sort_state,
    apply_table_selection,
    update_mode,
    open_create_dialog,
    open_edit_dialog,
    update_dialog_draft,
    import_entries_from_path,
    import_entries_from_picker,
    export_entries_from_picker,
    open_preset_menu,
    apply_preset,
    request_reset_entries,
    request_save_preset,
    request_rename_preset,
    request_delete_preset,
    set_default_preset,
    cancel_default_preset,
    delete_selected_entries,
    reorder_selected_entries,
    query_entry_source,
    search_entry_relations_from_statistics,
    save_dialog_entry,
    request_close_dialog,
    confirm_pending_action,
    close_confirm_dialog,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
    update_preset_input_value,
    submit_preset_input,
    close_preset_input_dialog,
    set_preset_menu_open,
  };
}
