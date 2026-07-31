import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import {
  useProjectSessionTableUiState,
  type ProjectSessionTableSelectionState,
} from "@frontend/app/session/project-session-ui-state-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { buildProofreadingLookupQuery } from "@shared/quality/quality-rule-proofreading-query";
import {
  query_quality_rules,
  query_quality_rule_section_revisions,
  type QualityRuleQuerySlice,
} from "@frontend/features/quality-rule-editor/quality-rule-api-client";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  build_user_preset_virtual_id,
  create_empty_preset_input_state,
  decorate_preset_items,
  has_casefold_duplicate_preset,
  normalize_preset_name,
} from "@frontend/features/preset-editor/preset-model";
import type {
  PresetInputState as TextPreservePresetInputState,
  PresetItem as TextPreservePresetItem,
} from "@frontend/features/preset-editor/preset-types";
import {
  build_text_preserve_filter_result,
  sort_text_preserve_entries,
} from "@frontend/pages/text-preserve-page/filtering";
import {
  has_active_quality_rule_filters,
  resolve_quality_rule_statistics_badge_kind,
} from "@frontend/features/quality-rule-editor/quality-rule-filtering";
import {
  PRESERVE_RESULT_REFRESH,
  REBUILD_RESULT_REFRESH,
  create_result_snapshot,
  materialize_result_snapshot,
  type ResultRefreshPolicy,
  type ResultSnapshot,
} from "@frontend/app/result/snapshot";
import { create_project_section_result_refresh } from "@frontend/app/result/refresh";
import { useResultSnapshotState } from "@frontend/app/result/hook";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "@shared/quality/quality-rule-entry-id";
import {
  create_quality_rule_duplicate_resolution_plan,
  useQualityRuleImportConfirmation,
} from "@frontend/widgets/quality-rule-import-confirm-dialog/use-quality-rule-import-confirmation";
import {
  are_quality_rule_entry_ids_equal,
  reorder_selected_quality_rule_entries,
  resolve_quality_rule_entry_id,
} from "@frontend/features/quality-rule-editor/quality-rule-selection";
import type {
  TextPreserveConfirmState,
  TextPreserveDialogState,
  TextPreserveEntry,
  TextPreserveEntryId,
  TextPreserveFilterScope,
  TextPreserveFilterState,
  TextPreserveMode,
  TextPreserveStatisticsBadgeState,
  TextPreserveStatisticsState,
  TextPreserveVisibleEntry,
  UseTextPreservePageStateResult,
} from "@frontend/pages/text-preserve-page/types";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import { normalize_text_preserve_mode } from "@domain/quality";
import { QualityRuleImportRuleTypeValue } from "@shared/quality/quality-rule-import";

type TextPreservePresetPayload = {
  builtin_presets: TextPreservePresetItem[];
  user_presets: TextPreservePresetItem[];
};

type TextPreserveResultQuery = {
  filter_state: TextPreserveFilterState;
  sort_state: AppTableSortState | null;
};

type TextPreserveQualitySlice = {
  mode: TextPreserveMode;
  entries: TextPreserveEntry[];
  section_revision: number;
};

// 设置协议中的文本保护默认预设字段。
const TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY = "text_preserve_default_preset";
// 后端质量规则 API 与统计缓存共用的规则类型。
const TEXT_PRESERVE_RULE_TYPE = "text_preserve";
const TEXT_PRESERVE_TITLE_KEY: LocaleKey = "text_preserve_page.title";
// 导出接口展示给系统保存框的默认文件名。
const TEXT_PRESERVE_EXPORT_FILE_NAME = "text_preserve.json";
// 查询完成前与坏载荷统一回落为关闭模式。
const DEFAULT_MODE: TextPreserveMode = "off";
// 首次查询前使用与后端默认语义一致的只读切片。
const DEFAULT_QUALITY_SLICE: TextPreserveQualitySlice = {
  mode: DEFAULT_MODE,
  entries: [],
  section_revision: 0,
};
// 文本保护规则事实只归 quality section 拥有，items 变化只影响统计和结果视图。
const QUALITY_RULE_REFRESH_SECTIONS = ["quality"] as const;
// 模式切换必须等项目事件回流，超时后由补偿刷新恢复权威快照。
const TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS = 15000;
// session 恢复排序的白名单，避免旧列 ID 进入当前表格。
const TEXT_PRESERVE_SORT_COLUMN_IDS = new Set(["src", "info", "statistics"]);

/**
 * 在 session 恢复边界收窄排序状态，旧列统一回到未排序。
 */
function normalize_text_preserve_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  if (sort_state === null || !TEXT_PRESERVE_SORT_COLUMN_IDS.has(sort_state.column_id)) {
    return null;
  }

  return {
    column_id: sort_state.column_id,
    direction: sort_state.direction,
  };
}

// 切断 session 快照引用，避免页面编辑直接修改缓存对象。
function clone_text_preserve_filter_state(
  filter_state: TextPreserveFilterState,
): TextPreserveFilterState {
  return {
    keyword: filter_state.keyword,
    scope: filter_state.scope,
    is_regex: filter_state.is_regex,
  };
}

// 仅该内部哨兵错误由调用方静默补偿，真实请求错误仍需反馈给用户。
const MODAL_PROGRESS_TIMEOUT_MESSAGE = "模态进度通知等待超时。";
// 保留文本页分别标记条目保存和模式保存，诊断名由页面领域拥有。
const TEXT_PRESERVE_ENTRIES_SAVE_WRITE: ProjectWriteOperation = "text_preserve.entries_save";
const TEXT_PRESERVE_MODE_UPDATE_WRITE: ProjectWriteOperation = "text_preserve.mode_update";

// 对话框总是克隆该模板，避免复用可变草稿引用。
const EMPTY_ENTRY: TextPreserveEntry = {
  src: "",
  info: "",
};

function clone_entry(entry: TextPreserveEntry): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    info: entry.info,
  };
}

/**
 * 在保存边界裁掉文本两端空白，同时保留稳定条目 ID。
 */
function normalize_entry(entry: Partial<TextPreserveEntry>): TextPreserveEntry {
  return {
    entry_id: entry.entry_id,
    src: String(entry.src ?? "").trim(),
    info: String(entry.info ?? "").trim(),
  };
}

/**
 * 导入数据不信任外部 ID，只提取可写业务字段。
 */
function normalize_imported_entry(entry: Record<string, unknown>): TextPreserveEntry {
  return normalize_entry({
    src: String(entry.src ?? ""),
    info: String(entry.info ?? ""),
  });
}

/**
 * 将后端 quality 查询收窄为页面稳定切片，并为旧数据补齐条目 ID。
 */
function normalize_text_preserve_quality_slice(
  slice: QualityRuleQuerySlice | undefined,
  section_revision: number,
): TextPreserveQualitySlice {
  const raw_entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    mode: normalize_text_preserve_mode(slice?.mode),
    entries: ensure_quality_rule_entry_ids(
      raw_entries.map((entry) => {
        return typeof entry === "object" && entry !== null
          ? normalize_entry(entry as Partial<TextPreserveEntry>)
          : normalize_entry({});
      }),
    ),
    section_revision,
  };
}

/** 新项目或清空筛选时的完整筛选状态。 */
function create_empty_filter_state(): TextPreserveFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

/** 保持页面默认值与 AppTable 的未排序状态一致。 */
function create_empty_sort_state(): AppTableSortState | null {
  return null;
}

/** 每次关闭编辑框都重建草稿，避免跨条目残留保存态。 */
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

/** 统一清空删除、预设和导入确认共用的提交状态。 */
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

/**
 * 将命中数和子集父项关系合并成徽章的多行说明。
 */
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
    tooltip_lines.push(t("quality_editor.statistics.subset_relations"));
    tooltip_lines.push(
      ...subset_parent_labels.map((label) => {
        return t("quality_editor.statistics.relation_line")
          .replace("{CHILD}", entry.src)
          .replace("{PARENT}", label);
      }),
    );
  }

  return tooltip_lines.join("\n");
}

/** 以设置协议字段名构造默认预设更新载荷。 */
function build_default_preset_update_payload(value: string): Record<string, string> {
  return {
    [TEXT_PRESERVE_DEFAULT_PRESET_SETTINGS_KEY]: value,
  };
}

/** 识别等待事件回流的内部超时，不吞掉真实后端错误。 */
function is_modal_progress_timeout_error(error: unknown): boolean {
  return error instanceof Error && error.message === MODAL_PROGRESS_TIMEOUT_MESSAGE;
}

/**
 * 将会话级统计缓存投影为页面只读状态，不复制规则事实。
 */
function build_text_preserve_statistics_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): TextPreserveStatisticsState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改文本保护规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    completed_snapshot: statistics_cache.completed_snapshot,
    completed_entry_ids: statistics_cache.completed_entry_ids,
    matched_count_by_entry_id: statistics_cache.matched_count_by_entry_id,
    subset_parent_labels_by_entry_id: statistics_cache.subset_parent_labels_by_entry_id,
  };
}

/**
 * 聚合文本保护页面的项目快照、筛选状态、统计缓存与唯一写入口。
 *
 * 页面组件只消费该 Hook 暴露的快照和意图，避免绕过项目写锁直接修改后端状态。
 */
export function useTextPreservePageState(): UseTextPreservePageStateResult {
  const { t } = useI18n();
  const { push_toast, run_modal_progress_toast } = useDesktopToast();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const {
    project_snapshot,
    project_change_signal,
    project_session_status = "ready",
    settings_snapshot,
    apply_settings_snapshot,
    commit_project_write,
    task_snapshot,
  } = useDesktopState();
  const [quality_slice, set_quality_slice] =
    useState<TextPreserveQualitySlice>(DEFAULT_QUALITY_SLICE);
  const [quality_loaded, set_quality_loaded] = useState(false);
  const mode = project_snapshot.loaded ? quality_slice.mode : DEFAULT_MODE;
  const entries = project_snapshot.loaded ? quality_slice.entries : [];
  const [mode_updating, set_mode_updating] = useState(false);
  const [preset_items, set_preset_items] = useState<TextPreservePresetItem[]>([]);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const table_ui_state = useProjectSessionTableUiState<
    TextPreserveFilterState,
    AppTableSortState | null
  >({
    key: "quality:text_preserve",
    create_default_filter_state: create_empty_filter_state,
    create_default_sort_state: create_empty_sort_state,
    clone_filter_state: clone_text_preserve_filter_state,
    normalize_sort_state: normalize_text_preserve_sort_state,
  });
  // table_ui_state 是保留文本页跨路由保留筛选、排序和选区的唯一 session 状态入口。
  const filter_state = table_ui_state.filter_state;
  const sort_state = table_ui_state.sort_state;
  const selected_entry_ids = table_ui_state.selected_row_ids as TextPreserveEntryId[];
  const active_entry_id = table_ui_state.active_row_id as TextPreserveEntryId | null;
  const selection_anchor_entry_id = table_ui_state.anchor_row_id as TextPreserveEntryId | null;
  const restore_scroll_entry_id =
    table_ui_state.restore_scroll_row_id as TextPreserveEntryId | null;
  const set_table_filter_state = table_ui_state.set_filter_state;
  const set_table_sort_state = table_ui_state.set_sort_state;
  const set_table_selection_state = table_ui_state.set_selection_state;
  const restore_table_selection_state = table_ui_state.restore_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
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
  const entries_ref = useRef(entries);
  const statistics_cache = useQualityRuleStatistics(TEXT_PRESERVE_RULE_TYPE);
  const statistics_state = useMemo<TextPreserveStatisticsState>(() => {
    return build_text_preserve_statistics_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const statistics_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  // 区分同组件内项目身份切换，避免旧项目状态污染新项目。
  const project_view_identity_ref = useRef(project_snapshot.loaded ? project_snapshot.path : "");

  const refresh_quality_rule_snapshot = useCallback(async (): Promise<TextPreserveQualitySlice> => {
    if (
      !project_snapshot.loaded ||
      project_snapshot.path === "" ||
      project_session_status !== "ready"
    ) {
      set_quality_slice(DEFAULT_QUALITY_SLICE);
      set_quality_loaded(false);
      return DEFAULT_QUALITY_SLICE;
    }

    const response = await query_quality_rules(TEXT_PRESERVE_RULE_TYPE);
    if (response.projectPath !== project_snapshot.path) {
      return quality_slice;
    }
    const next_slice = normalize_text_preserve_quality_slice(
      response.qualityRule,
      response.sectionRevisions?.quality ?? 0,
    );
    set_quality_slice(next_slice);
    set_quality_loaded(true);
    return next_slice;
  }, [project_session_status, project_snapshot.loaded, project_snapshot.path, quality_slice]);

  // 保持规则读取 effect 只响应 quality 变化，翻译批次保留当前规则表格主体。
  const quality_rule_change_seq = useProjectChangeSeqForSections(
    project_change_signal,
    QUALITY_RULE_REFRESH_SECTIONS,
  );

  useEffect(() => {
    if (
      !project_snapshot.loaded ||
      project_snapshot.path === "" ||
      project_session_status !== "ready"
    ) {
      set_quality_slice(DEFAULT_QUALITY_SLICE);
      set_quality_loaded(false);
      return;
    }

    let cancelled = false;
    void query_quality_rules(TEXT_PRESERVE_RULE_TYPE).then((response) => {
      if (cancelled || response.projectPath !== project_snapshot.path) {
        return;
      }
      set_quality_slice(
        normalize_text_preserve_quality_slice(
          response.qualityRule,
          response.sectionRevisions?.quality ?? 0,
        ),
      );
      set_quality_loaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [
    quality_rule_change_seq,
    project_session_status,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);

  useEffect(() => {
    mode_ref.current = mode;
  }, [mode]);

  useEffect(() => {
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

  useEffect(() => {
    entries_ref.current = entries;
  }, [entries]);

  const entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return entries.map((entry, index) => {
      return resolve_quality_rule_entry_id(entry, index);
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

  const build_result_snapshot = useCallback(
    (
      next_filter_state: TextPreserveFilterState,
      next_sort_state: AppTableSortState | null,
    ): ResultSnapshot<TextPreserveResultQuery, TextPreserveEntryId> => {
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

      return create_result_snapshot({
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
  const build_current_result_snapshot = useCallback(() => {
    return build_result_snapshot(filter_state, sort_state);
  }, [build_result_snapshot, filter_state, sort_state]);
  const has_active_filters = has_active_quality_rule_filters(filter_state);
  const { result_snapshot, set_result_snapshot, set_pending_result_refresh } =
    useResultSnapshotState({
      project_path: project_snapshot.path,
      section: "quality",
      section_revision: quality_slice.section_revision,
      has_active_query: has_active_filters,
      valid_ids: entry_ids,
      build_snapshot: build_current_result_snapshot,
    });
  // 筛选控件状态即时更新；结果快照延迟刷新，显式 action 会 cancel 后立即重建。
  const debounced_result_snapshot = useDebouncedCallback(
    (
      next_filter_state: TextPreserveFilterState,
      next_sort_state: AppTableSortState | null,
    ): void => {
      set_result_snapshot(build_result_snapshot(next_filter_state, next_sort_state));
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
    if (result_snapshot !== null) {
      return materialize_result_snapshot({
        snapshot: result_snapshot,
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
    result_snapshot,
    sort_state,
    statistics_ready,
    statistics_state,
  ]);

  const visible_entry_ids = useMemo<TextPreserveEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id);
  }, [filtered_entries]);

  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids);
  }, [visible_entry_ids]);

  const readonly = is_project_write_locked(task_snapshot);
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

      const kind = resolve_quality_rule_statistics_badge_kind(
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

  const clear_selection_state = table_ui_state.clear_selection_state;

  const push_action_error_toast = useCallback(
    (error: unknown): void => {
      push_toast("error", resolve_visible_error_message(error, t, unknown_error_message));
    },
    [push_toast, unknown_error_message],
  );

  const save_entries_snapshot = useCallback(
    async (
      next_entries: TextPreserveEntry[],
      result_refresh: ResultRefreshPolicy = PRESERVE_RESULT_REFRESH,
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_entries = ensure_quality_rule_entry_ids(
        next_entries.map((entry) => {
          return normalize_entry(entry);
        }),
      );

      try {
        const section_revisions = await query_quality_rule_section_revisions();
        await commit_project_write({
          operation: TEXT_PRESERVE_ENTRIES_SAVE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update", {
              rule_type: TEXT_PRESERVE_RULE_TYPE,
              expected_section_revisions: {
                quality: section_revisions.quality ?? 0,
              },
              entries: normalized_entries,
            });
          },
          prepare: ({ write_result }) => {
            set_pending_result_refresh(
              create_project_section_result_refresh({
                write_result,
                policy: result_refresh,
                section: "quality",
              }),
            );
          },
        });
        await refresh_quality_rule_snapshot();
        return true;
      } catch (error) {
        set_pending_result_refresh(null);
        push_action_error_toast(error);
        return false;
      }
    },
    [commit_project_write, push_action_error_toast, readonly, refresh_quality_rule_snapshot],
  );

  const apply_import_entries = useCallback(
    async (
      next_entries: TextPreserveEntry[],
      options: {
        close_preset_menu: boolean;
      },
    ): Promise<boolean> => {
      const saved = await save_entries_snapshot(next_entries, REBUILD_RESULT_REFRESH);
      if (!saved) {
        return false;
      }

      clear_selection_state();
      push_toast("success", t("quality_editor.feedback.import_success"));

      if (options.close_preset_menu) {
        set_preset_menu_open(false);
      }

      return true;
    },
    [clear_selection_state, push_toast, save_entries_snapshot, t],
  );

  const get_import_existing_entries = useCallback((): TextPreserveEntry[] => {
    return entries_ref.current.map((entry) => clone_entry(entry));
  }, []);
  const import_confirmation = useQualityRuleImportConfirmation<TextPreserveEntry>({
    rule_type: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
    apply_entries: apply_import_entries,
  });
  const {
    import_confirm_state,
    persist_entries_with_duplicate_resolution,
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
    // 项目身份变化时页面计算视图和 session 表格状态必须一起重置。
    const next_project_identity = project_snapshot.loaded ? project_snapshot.path : "";
    set_result_snapshot(null);
    set_pending_result_refresh(null);
    if (project_view_identity_ref.current === next_project_identity) {
      return;
    }

    project_view_identity_ref.current = next_project_identity;
    reset_table_state({ persist: false });
  }, [project_snapshot.loaded, project_snapshot.path, reset_table_state]);

  useEffect(() => {
    if (statistics_ready || sort_state?.column_id !== "statistics") {
      return;
    }

    set_table_sort_state(null);
    set_result_snapshot(build_result_snapshot(filter_state, null));
  }, [build_result_snapshot, filter_state, set_table_sort_state, sort_state, statistics_ready]);

  useEffect(() => {
    if (!quality_loaded) {
      return;
    }
    // 可见结果变化会让旧选区失去操作上下文，必须同步裁剪 session 选区。
    const next_selected_entry_ids = selected_entry_ids.filter((entry_id) => {
      return entry_index_by_id.has(entry_id) && visible_entry_id_set.has(entry_id);
    });
    const next_active_entry_id =
      active_entry_id !== null && visible_entry_id_set.has(active_entry_id)
        ? active_entry_id
        : null;
    const next_anchor_entry_id =
      selection_anchor_entry_id !== null && visible_entry_id_set.has(selection_anchor_entry_id)
        ? selection_anchor_entry_id
        : null;
    const selection_changed = !are_quality_rule_entry_ids_equal(
      selected_entry_ids,
      next_selected_entry_ids,
    );

    if (
      selection_changed ||
      active_entry_id !== next_active_entry_id ||
      selection_anchor_entry_id !== next_anchor_entry_id
    ) {
      set_table_selection_state({
        selected_row_ids: next_selected_entry_ids,
        active_row_id: next_active_entry_id,
        anchor_row_id: next_anchor_entry_id,
      });
    }
  }, [
    active_entry_id,
    entry_index_by_id,
    quality_loaded,
    selected_entry_ids,
    selection_anchor_entry_id,
    set_table_selection_state,
    visible_entry_id_set,
  ]);

  const update_filter_keyword = useCallback(
    (next_keyword: string): void => {
      const next_filter_state = {
        ...filter_state,
        keyword: next_keyword,
      };
      // 首次快照尚未落地时，先冻结旧查询结果，再让输入防抖决定何时应用新查询。
      set_result_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_snapshot(filter_state, sort_state);
      });
      set_table_filter_state(next_filter_state);
      debounced_result_snapshot.schedule(next_filter_state, sort_state);
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      filter_state,
      set_table_filter_state,
      sort_state,
    ],
  );

  const update_filter_scope = useCallback(
    (next_scope: TextPreserveFilterScope): void => {
      const next_filter_state = {
        ...filter_state,
        scope: next_scope,
      };
      set_result_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_snapshot(filter_state, sort_state);
      });
      set_table_filter_state(next_filter_state);
      debounced_result_snapshot.schedule(next_filter_state, sort_state);
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      filter_state,
      set_table_filter_state,
      sort_state,
    ],
  );

  const update_filter_regex = useCallback(
    (next_is_regex: boolean): void => {
      const next_filter_state = {
        ...filter_state,
        is_regex: next_is_regex,
      };
      set_result_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_snapshot(filter_state, sort_state);
      });
      set_table_filter_state(next_filter_state);
      debounced_result_snapshot.schedule(next_filter_state, sort_state);
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      filter_state,
      set_table_filter_state,
      sort_state,
    ],
  );

  const apply_table_sort_state = useCallback(
    (next_sort_state: AppTableSortState | null): void => {
      debounced_result_snapshot.cancel();
      set_table_sort_state(next_sort_state);
      set_result_snapshot(build_result_snapshot(filter_state, next_sort_state));
    },
    [build_result_snapshot, debounced_result_snapshot, filter_state, set_table_sort_state],
  );

  const apply_table_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      set_table_selection_state(payload);
    },
    [set_table_selection_state],
  );

  const update_mode = useCallback(
    async (next_mode: TextPreserveMode): Promise<void> => {
      const previous_mode = mode_ref.current;
      if (readonly || mode_update_in_flight_ref.current || previous_mode === next_mode) {
        return;
      }

      mode_update_in_flight_ref.current = true;
      set_mode_updating(true);
      let snapshot_committed = false;

      try {
        await run_modal_progress_toast({
          message: t("text_preserve_page.mode.loading_toast"),
          timeout_ms: TEXT_PRESERVE_MODE_REFRESH_TIMEOUT_MS,
          task: async () => {
            const section_revisions = await query_quality_rule_section_revisions();
            await commit_project_write({
              operation: TEXT_PRESERVE_MODE_UPDATE_WRITE,
              run: async () => {
                return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update", {
                  rule_type: TEXT_PRESERVE_RULE_TYPE,
                  expected_section_revisions: {
                    quality: section_revisions.quality ?? 0,
                  },
                  meta: {
                    mode: next_mode,
                  },
                });
              },
            });
            await refresh_quality_rule_snapshot();
            snapshot_committed = true;
          },
        });
        push_toast(
          "success",
          t("app.feedback.feature_state_changed", {
            TITLE: t("text_preserve_page.title"),
            STATE: t(`text_preserve_page.mode.options.${next_mode}`),
          }),
        );
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
      commit_project_write,
      push_toast,
      push_action_error_toast,
      refresh_quality_rule_snapshot,
      readonly,
      run_modal_progress_toast,
      t,
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
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];

      if (target_entry === null || target_entry === undefined) {
        return;
      }

      set_table_selection_state({
        selected_row_ids: [entry_id],
        active_row_id: entry_id,
        anchor_row_id: entry_id,
      });
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
    [entries, entry_index_by_id, set_table_selection_state],
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
      const previous_selection_state: ProjectSessionTableSelectionState = {
        selected_row_ids: selected_entry_ids,
        active_row_id: active_entry_id,
        anchor_row_id: selection_anchor_entry_id,
      };
      const next_entries = entries.filter((_entry, index) => {
        return !target_set.has(entry_ids[index] ?? "");
      });

      clear_selection_state();

      const saved = await save_entries_snapshot(next_entries);
      if (!saved) {
        restore_table_selection_state(previous_selection_state);
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
      restore_table_selection_state,
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

      const next_entries = reorder_selected_quality_rule_entries(
        entries,
        entry_ids,
        selected_entry_ids,
        current_active_entry_id,
        over_entry_id,
      );

      await save_entries_snapshot(next_entries, REBUILD_RESULT_REFRESH);
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
      debounced_result_snapshot.cancel();
      set_table_filter_state(next_filter_state);
      set_table_sort_state(null);
      set_result_snapshot(build_result_snapshot(next_filter_state, null));
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      entries,
      entry_index_by_id,
      set_table_filter_state,
      set_table_sort_state,
    ],
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

        await persist_entries_with_duplicate_resolution(
          () => {
            return create_quality_rule_duplicate_resolution_plan({
              existing_entries: get_import_existing_entries(),
              incoming_entries: imported_entries,
            });
          },
          { close_preset_menu: false },
        );
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [
      get_import_existing_entries,
      persist_entries_with_duplicate_resolution,
      push_action_error_toast,
      push_toast,
      readonly,
      t,
    ],
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
      push_toast("success", t("quality_editor.feedback.export_success"));
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
        const incoming_entries = payload.entries.map((entry) => {
          return normalize_imported_entry(entry);
        });
        await persist_entries_with_duplicate_resolution(
          () => {
            return create_quality_rule_duplicate_resolution_plan({
              existing_entries: get_import_existing_entries(),
              incoming_entries,
            });
          },
          { close_preset_menu: true },
        );
      } catch (error) {
        push_action_error_toast(error);
      }
    },
    [
      get_import_existing_entries,
      persist_entries_with_duplicate_resolution,
      push_action_error_toast,
      readonly,
    ],
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
        push_toast("success", t("quality_editor.feedback.preset_saved"));
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
        push_toast("success", t("quality_editor.feedback.preset_renamed"));
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
        push_toast("success", t("quality_editor.feedback.default_preset_set"));
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
        void new RegExp(entry.src, "iu");
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return `${t("quality_editor.feedback.regex_invalid")}: ${detail}`;
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
      dialog_state.mode === "create" ? REBUILD_RESULT_REFRESH : PRESERVE_RESULT_REFRESH,
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
      push_toast("warning", t("quality_editor.feedback.preset_exists"));
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

    const saved = await save_entries_snapshot([], REBUILD_RESULT_REFRESH);
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
          push_toast("success", t("quality_editor.feedback.preset_deleted"));
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
    invalid_filter_message: result_snapshot?.invalid_message ?? filter_result.invalid_regex_message,
    readonly,
    drag_disabled,
    statistics_state,
    statistics_ready,
    statistics_badge_by_entry_id,
    preset_items,
    selected_entry_ids,
    active_entry_id,
    selection_anchor_entry_id,
    restore_scroll_entry_id,
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
