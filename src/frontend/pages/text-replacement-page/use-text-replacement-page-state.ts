import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import {
  useProjectSessionTableUiState,
  type ProjectSessionTableSelectionState,
  type ProjectSessionUiStateKey,
} from "@frontend/app/session/project-session-ui-state-context";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { buildProofreadingLookupQuery } from "@shared/quality/state";
import {
  read_text_replacement_quality_rule,
  read_text_replacement_section_revisions,
  type TextReplacementQualityRuleQuerySlice,
} from "@frontend/pages/text-replacement-page/text-replacement-api-client";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  TEXT_REPLACEMENT_VARIANT_CONFIG,
  type TextReplacementVariant,
  type TextReplacementVariantConfig,
} from "@frontend/pages/text-replacement-page/config";
import {
  build_text_replacement_filter_result,
  has_active_text_replacement_filters,
  resolve_text_replacement_statistics_badge_kind,
  sort_text_replacement_entries,
} from "@frontend/pages/text-replacement-page/filtering";
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
  are_text_replacement_entry_ids_equal,
  build_text_replacement_entry_id,
  reorder_text_replacement_selected_group,
} from "@frontend/pages/text-replacement-page/selection";
import type {
  TextReplacementConfirmState,
  TextReplacementDialogState,
  TextReplacementEntry,
  TextReplacementEntryId,
  TextReplacementFilterScope,
  TextReplacementFilterState,
  TextReplacementPresetInputState,
  TextReplacementPresetItem,
  TextReplacementStatisticsBadgeState,
  TextReplacementStatisticsState,
  TextReplacementVisibleEntry,
  UseTextReplacementPageStateResult,
} from "@frontend/pages/text-replacement-page/types";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import {
  QualityRuleImportRuleTypeValue,
  type QualityRuleImportRuleType,
} from "@shared/quality/importer";

type TextReplacementPresetPayload = {
  builtin_presets: TextReplacementPresetItem[];
  user_presets: TextReplacementPresetItem[];
};

type TextReplacementResultQuery = {
  filter_state: TextReplacementFilterState;
  sort_state: AppTableSortState | null;
};

type TextReplacementQualitySlice = {
  enabled: boolean;
  entries: TextReplacementEntry[];
  section_revision: number;
};

// TEXT REPLACEMENT SORT COLUMN IDS 是 session 恢复排序的白名单，避免跨变体列 id 污染表格。
const TEXT_REPLACEMENT_SORT_COLUMN_IDS = new Set(["src", "dst", "rule", "statistics"]);

// create_text_replacement_ui_state_key 把前后替换页隔离到各自 session UI 状态命名空间。
/**
 * 构建当前场景的稳定结果。
 */
function create_text_replacement_ui_state_key(
  rule_type: TextReplacementVariantConfig["rule_type"],
): ProjectSessionUiStateKey {
  return `quality:${rule_type}`;
}

// normalize_text_replacement_sort_state 在 session 边界收窄排序状态，坏状态统一回到默认排序。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_text_replacement_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  if (sort_state === null || !TEXT_REPLACEMENT_SORT_COLUMN_IDS.has(sort_state.column_id)) {
    return null;
  }

  return {
    column_id: sort_state.column_id,
    direction: sort_state.direction,
  };
}

// clone_text_replacement_filter_state 切断 session 快照引用，避免页面编辑直接修改缓存对象。
function clone_text_replacement_filter_state(
  filter_state: TextReplacementFilterState,
): TextReplacementFilterState {
  return {
    keyword: filter_state.keyword,
    scope: filter_state.scope,
    is_regex: filter_state.is_regex,
  };
}

// IMPORT RULE TYPE BY PUBLIC RULE TYPE 是模块级稳定契约，集中维护避免调用点散落魔术值。
const IMPORT_RULE_TYPE_BY_PUBLIC_RULE_TYPE = {
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
} as const satisfies Record<TextReplacementVariantConfig["rule_type"], QualityRuleImportRuleType>;

// 替换规则页把规则类型收窄成固定 operation，避免运行态接收临时拼接诊断名。
/**
 * 构建当前场景的稳定结果。
 */
function create_quality_rule_entries_save_write(
  rule_type: TextReplacementVariantConfig["rule_type"],
): ProjectWriteOperation {
  return rule_type === "pre_replacement"
    ? "pre_replacement.entries_save"
    : "post_replacement.entries_save";
}

// create_quality_rule_meta_update_write 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function create_quality_rule_meta_update_write(
  rule_type: TextReplacementVariantConfig["rule_type"],
): ProjectWriteOperation {
  return rule_type === "pre_replacement"
    ? "pre_replacement.meta_update"
    : "post_replacement.meta_update";
}

// EMPTY ENTRY 是默认快照事实，调用方只读取副本不临时拼装。
const EMPTY_ENTRY: TextReplacementEntry = {
  src: "",
  dst: "",
  regex: false,
  case_sensitive: false,
};
const DEFAULT_QUALITY_SLICE: TextReplacementQualitySlice = {
  enabled: true,
  entries: [],
  section_revision: 0,
};

// clone_entry 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function clone_entry(entry: TextReplacementEntry): TextReplacementEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    dst: entry.dst,
    regex: entry.regex,
    case_sensitive: entry.case_sensitive,
  };
}

// create_empty_filter_state 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_filter_state(): TextReplacementFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

// create_empty_sort_state 保持表格排序默认值与 AppTable 的无排序状态一致。
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_sort_state(): AppTableSortState | null {
  return null;
}

// create_empty_dialog_state 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_dialog_state(): TextReplacementDialogState {
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
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_confirm_state(): TextReplacementConfirmState {
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
/**
 * 构建当前场景的稳定结果。
 */
function create_empty_preset_input_state(): TextReplacementPresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

// normalize_entry 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_entry(entry: TextReplacementEntry): TextReplacementEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    regex: entry.regex,
    case_sensitive: entry.case_sensitive,
  };
}

// normalize_text_replacement_quality_slice 在后端 query 边界收窄规则事实，页面内部只消费稳定形状。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_text_replacement_quality_slice(
  slice: TextReplacementQualityRuleQuerySlice | undefined,
  section_revision: number,
): TextReplacementQualitySlice {
  const raw_entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    enabled: slice?.enabled === undefined ? true : Boolean(slice.enabled),
    entries: ensure_quality_rule_entry_ids(
      raw_entries.map((entry) => {
        const record = typeof entry === "object" && entry !== null ? entry : {};
        return normalize_entry({
          ...EMPTY_ENTRY,
          ...(record as Partial<TextReplacementEntry>),
        });
      }),
    ),
    section_revision,
  };
}

// build_user_preset_virtual_id 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.json`;
}

// normalize_preset_name 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_preset_name(name: string): string {
  return name.trim();
}

// has_casefold_duplicate_preset 集中表达布尔判定口径，避免调用方按局部字段猜测。
/**
 * 判断当前值是否满足业务条件。
 */
function has_casefold_duplicate_preset(
  preset_items: TextReplacementPresetItem[],
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
  builtin_presets: TextReplacementPresetItem[],
  user_presets: TextReplacementPresetItem[],
  default_virtual_id: string,
): TextReplacementPresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => {
    return {
      ...item,
      is_default: item.virtual_id === default_virtual_id,
    };
  });
}

// build_statistics_badge_tooltip 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function build_statistics_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: TextReplacementEntry,
  matched_count: number,
  subset_parent_labels: string[],
): string {
  const tooltip_lines = [
    t("text_replacement_page.statistics.hit_count").replace("{COUNT}", matched_count.toString()),
  ];

  if (subset_parent_labels.length > 0) {
    tooltip_lines.push(t("text_replacement_page.statistics.subset_relations"));
    tooltip_lines.push(
      ...subset_parent_labels.map((label) => {
        return t("text_replacement_page.statistics.relation_line")
          .replace("{CHILD}", entry.src)
          .replace("{PARENT}", label);
      }),
    );
  }

  return tooltip_lines.join("\n");
}

// build_default_preset_update_payload 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function build_default_preset_update_payload(
  config: TextReplacementVariantConfig,
  value: string,
): Record<string, string> {
  return {
    [config.default_preset_settings_key]: value,
  };
}

// build_text_replacement_statistics_state_from_cache 构造跨层载荷，保证字段形状在一个入口维护。
/**
 * 构建当前场景的稳定结果。
 */
function build_text_replacement_statistics_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): TextReplacementStatisticsState {
  // 页面只从质量统计缓存派生展示状态，不持有也不修改替换规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    completed_snapshot: statistics_cache.completed_snapshot,
    completed_entry_ids: statistics_cache.completed_entry_ids,
    matched_count_by_entry_id: statistics_cache.matched_count_by_entry_id,
    subset_parent_labels_by_entry_id: statistics_cache.subset_parent_labels_by_entry_id,
  };
}

// useTextReplacementPageState 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function useTextReplacementPageState(
  variant: TextReplacementVariant,
): UseTextReplacementPageStateResult {
  const config = TEXT_REPLACEMENT_VARIANT_CONFIG[variant];
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  // ui_state_key 用公开 rule_type 隔离前后替换页的 session 表格状态。
  const ui_state_key = create_text_replacement_ui_state_key(config.rule_type);
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
    useState<TextReplacementQualitySlice>(DEFAULT_QUALITY_SLICE);
  const [quality_loaded, set_quality_loaded] = useState(false);
  const enabled = project_snapshot.loaded ? quality_slice.enabled : true;
  const entries = project_snapshot.loaded ? quality_slice.entries : [];
  const [preset_items, set_preset_items] = useState<TextReplacementPresetItem[]>([]);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const table_ui_state = useProjectSessionTableUiState<
    TextReplacementFilterState,
    AppTableSortState | null
  >({
    key: ui_state_key,
    create_default_filter_state: create_empty_filter_state,
    create_default_sort_state: create_empty_sort_state,
    clone_filter_state: clone_text_replacement_filter_state,
    normalize_sort_state: normalize_text_replacement_sort_state,
  });
  // table_ui_state 是文本替换页跨路由保留筛选、排序和选区的唯一 session 状态入口。
  const filter_state = table_ui_state.filter_state;
  const sort_state = table_ui_state.sort_state;
  const selected_entry_ids = table_ui_state.selected_row_ids as TextReplacementEntryId[];
  const active_entry_id = table_ui_state.active_row_id as TextReplacementEntryId | null;
  const selection_anchor_entry_id = table_ui_state.anchor_row_id as TextReplacementEntryId | null;
  const restore_scroll_entry_id =
    table_ui_state.restore_scroll_row_id as TextReplacementEntryId | null;
  const set_table_filter_state = table_ui_state.set_filter_state;
  const set_table_sort_state = table_ui_state.set_sort_state;
  const set_table_selection_state = table_ui_state.set_selection_state;
  const restore_table_selection_state = table_ui_state.restore_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
  const [dialog_state, set_dialog_state] = useState<TextReplacementDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [confirm_state, set_confirm_state] = useState<TextReplacementConfirmState>(() => {
    return create_empty_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<TextReplacementPresetInputState>(
    () => {
      return create_empty_preset_input_state();
    },
  );
  const dialog_state_ref = useRef(dialog_state);
  const entries_ref = useRef(entries);
  const statistics_cache = useQualityRuleStatistics(config.rule_type);
  const statistics_state = useMemo<TextReplacementStatisticsState>(() => {
    return build_text_replacement_statistics_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const statistics_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  // project_view_identity_ref 区分同组件内项目身份切换，避免旧项目状态污染新项目。
  const project_view_identity_ref = useRef(project_snapshot.loaded ? project_snapshot.path : "");

  const refresh_quality_rule_snapshot =
    useCallback(async (): Promise<TextReplacementQualitySlice> => {
      if (
        !project_snapshot.loaded ||
        project_snapshot.path === "" ||
        project_session_status !== "ready"
      ) {
        set_quality_slice(DEFAULT_QUALITY_SLICE);
        set_quality_loaded(false);
        return DEFAULT_QUALITY_SLICE;
      }

      const response = await read_text_replacement_quality_rule(config.rule_type);
      if (response.projectPath !== project_snapshot.path) {
        return quality_slice;
      }
      const next_slice = normalize_text_replacement_quality_slice(
        response.qualityRule,
        response.sectionRevisions?.quality ?? 0,
      );
      set_quality_slice(next_slice);
      set_quality_loaded(true);
      return next_slice;
    }, [
      config.rule_type,
      project_session_status,
      project_snapshot.loaded,
      project_snapshot.path,
      quality_slice,
    ]);

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
    void read_text_replacement_quality_rule(config.rule_type).then((response) => {
      if (cancelled || response.projectPath !== project_snapshot.path) {
        return;
      }
      set_quality_slice(
        normalize_text_replacement_quality_slice(
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
    config.rule_type,
    project_change_signal?.seq ?? 0,
    project_session_status,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);

  useEffect(() => {
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

  useEffect(() => {
    entries_ref.current = entries;
  }, [entries]);

  const entry_ids = useMemo<TextReplacementEntryId[]>(() => {
    return entries.map((entry, index) => {
      return build_text_replacement_entry_id(entry, index);
    });
  }, [entries]);

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]));
  }, [entry_ids]);

  const resolve_create_insert_after_entry_id = useCallback((): TextReplacementEntryId | null => {
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
  const completed_statistics_entry_id_set = useMemo<ReadonlySet<TextReplacementEntryId>>(() => {
    return new Set(statistics_state.completed_entry_ids);
  }, [statistics_state.completed_entry_ids]);

  const build_result_snapshot = useCallback(
    (
      next_filter_state: TextReplacementFilterState,
      next_sort_state: AppTableSortState | null,
    ): ResultSnapshot<TextReplacementResultQuery, TextReplacementEntryId> => {
      const result = build_text_replacement_filter_result({
        entries,
        entry_ids,
        filter_state: next_filter_state,
      });
      const visible_entries = sort_text_replacement_entries(
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
  const has_active_filters = has_active_text_replacement_filters(filter_state);
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
      next_filter_state: TextReplacementFilterState,
      next_sort_state: AppTableSortState | null,
    ): void => {
      set_result_snapshot(build_result_snapshot(next_filter_state, next_sort_state));
    },
  );

  const filter_result = useMemo(() => {
    return build_text_replacement_filter_result({
      entries,
      entry_ids,
      filter_state,
    });
  }, [entries, entry_ids, filter_state]);

  const filtered_entries = useMemo<TextReplacementVisibleEntry[]>(() => {
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

    return sort_text_replacement_entries(
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

  const visible_entry_ids = useMemo<TextReplacementEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id);
  }, [filtered_entries]);

  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids);
  }, [visible_entry_ids]);

  const readonly = is_project_write_locked(task_snapshot);
  const drag_disabled = readonly || has_active_filters || sort_state !== null;

  const statistics_badge_by_entry_id = useMemo<
    Record<TextReplacementEntryId, TextReplacementStatisticsBadgeState>
  >(() => {
    const next_badge_by_entry_id: Record<
      TextReplacementEntryId,
      TextReplacementStatisticsBadgeState
    > = {};
    if (!statistics_ready && statistics_state.completed_snapshot === null) {
      return next_badge_by_entry_id;
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index];
      if (entry_id === undefined) {
        return;
      }

      const kind = resolve_text_replacement_statistics_badge_kind(
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

  const save_entries_snapshot = useCallback(
    async (
      next_entries: TextReplacementEntry[],
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
        const section_revisions = await read_text_replacement_section_revisions();
        await commit_project_write({
          operation: create_quality_rule_entries_save_write(config.rule_type),
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/save-entries", {
              rule_type: config.rule_type,
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
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("text_replacement_page.feedback.save_failed")),
        );
        return false;
      }
    },
    [
      commit_project_write,
      config.rule_type,
      push_toast,
      readonly,
      refresh_quality_rule_snapshot,
      t,
    ],
  );

  const apply_import_entries = useCallback(
    async (
      next_entries: TextReplacementEntry[],
      options: {
        close_preset_menu: boolean;
      },
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const saved = await save_entries_snapshot(next_entries, REBUILD_RESULT_REFRESH);
      if (!saved) {
        return false;
      }

      clear_selection_state();
      push_toast("success", t("text_replacement_page.feedback.import_success"));

      if (options.close_preset_menu) {
        set_preset_menu_open(false);
      }

      return true;
    },
    [clear_selection_state, push_toast, readonly, save_entries_snapshot, t],
  );

  const get_import_existing_entries = useCallback((): TextReplacementEntry[] => {
    return entries_ref.current.map((entry) => clone_entry(entry));
  }, []);
  const import_confirmation = useQualityRuleImportConfirmation<TextReplacementEntry>({
    rule_type: IMPORT_RULE_TYPE_BY_PUBLIC_RULE_TYPE[config.rule_type],
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
    const preset_payload = await api_fetch<TextReplacementPresetPayload>(
      "/api/quality/rules/presets",
      {
        rule_type: config.rule_type,
      },
    );
    const default_virtual_id = String(settings_snapshot[config.default_preset_settings_key] ?? "");

    set_preset_items(
      decorate_preset_items(
        preset_payload.builtin_presets,
        preset_payload.user_presets,
        default_virtual_id,
      ),
    );
  }, [config.default_preset_settings_key, config.rule_type, settings_snapshot]);

  useEffect(() => {
    // 项目身份变化时页面派生视图和 session 表格状态必须一起重置。
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
    const selection_changed = !are_text_replacement_entry_ids_equal(
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
    (next_scope: TextReplacementFilterScope): void => {
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

  const update_enabled = useCallback(
    async (next_enabled: boolean): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const section_revisions = await read_text_replacement_section_revisions();
        await commit_project_write({
          operation: create_quality_rule_meta_update_write(config.rule_type),
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update-meta", {
              rule_type: config.rule_type,
              expected_section_revisions: {
                quality: section_revisions.quality ?? 0,
              },
              meta: {
                enabled: next_enabled,
              },
            });
          },
        });
        await refresh_quality_rule_snapshot();
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("text_replacement_page.feedback.save_failed")),
        );
      }
    },
    [
      commit_project_write,
      config.rule_type,
      push_toast,
      readonly,
      refresh_quality_rule_snapshot,
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
    (entry_id: TextReplacementEntryId): void => {
      if (readonly) {
        return;
      }

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
    [entries, entry_index_by_id, readonly, set_table_selection_state],
  );

  const update_dialog_draft = useCallback((patch: Partial<TextReplacementEntry>): void => {
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
    async (target_entry_ids: TextReplacementEntryId[]): Promise<boolean> => {
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

  const toggle_regex_for_selected = useCallback(
    async (next_value: boolean): Promise<void> => {
      if (readonly || selected_entry_ids.length === 0) {
        return;
      }

      const selected_set = new Set(selected_entry_ids);
      const next_entries = entries.map((entry, index) => {
        if (!selected_set.has(entry_ids[index] ?? "")) {
          return entry;
        }

        return {
          ...entry,
          regex: next_value,
        };
      });

      await save_entries_snapshot(next_entries);
    },
    [entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

  const toggle_case_sensitive_for_selected = useCallback(
    async (next_value: boolean): Promise<void> => {
      if (readonly || selected_entry_ids.length === 0) {
        return;
      }

      const selected_set = new Set(selected_entry_ids);
      const next_entries = entries.map((entry, index) => {
        if (!selected_set.has(entry_ids[index] ?? "")) {
          return entry;
        }

        return {
          ...entry,
          case_sensitive: next_value,
        };
      });

      await save_entries_snapshot(next_entries);
    },
    [entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

  const reorder_selected_entries = useCallback(
    async (
      current_active_entry_id: TextReplacementEntryId,
      over_entry_id: TextReplacementEntryId,
    ): Promise<void> => {
      if (readonly || drag_disabled || current_active_entry_id === over_entry_id) {
        return;
      }

      const next_entries = reorder_text_replacement_selected_group(
        entries,
        entry_ids,
        selected_entry_ids,
        current_active_entry_id,
        over_entry_id,
      );

      await save_entries_snapshot(next_entries, REBUILD_RESULT_REFRESH);
    },
    [drag_disabled, entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

  const query_entry_source = useCallback(
    async (entry_id: TextReplacementEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: config.rule_type,
            entry: normalize_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("text_replacement_page.feedback.query_failed")),
        );
      }
    },
    [
      config.rule_type,
      entries,
      entry_index_by_id,
      navigate_to_route,
      push_proofreading_lookup_intent,
      push_toast,
      t,
    ],
  );

  const search_entry_relations_from_statistics = useCallback(
    (entry_id: TextReplacementEntryId): void => {
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
      if (readonly) {
        return;
      }

      try {
        if (path.trim() === "") {
          return;
        }

        const payload = await api_fetch<{ entries?: TextReplacementEntry[] }>(
          "/api/quality/rules/import",
          {
            rule_type: config.rule_type,
            path,
          },
        );
        const imported_entries = Array.isArray(payload.entries) ? payload.entries : [];
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
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.import_failed"),
          ),
        );
      }
    },
    [
      config.rule_type,
      get_import_existing_entries,
      persist_entries_with_duplicate_resolution,
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
      const pick_result = await window.desktopApp.pickGlossaryExportPath(config.export_file_name);
      const selected_path = pick_result.paths[0] ?? null;
      if (pick_result.canceled || selected_path === null) {
        return;
      }

      await api_fetch("/api/quality/rules/export", {
        rule_type: config.rule_type,
        path: selected_path,
        entries: entries.map((entry) => {
          return normalize_entry(entry);
        }),
      });
      push_toast("success", t("text_replacement_page.feedback.export_success"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("text_replacement_page.feedback.export_failed")),
      );
    }
  }, [config.export_file_name, config.rule_type, entries, push_toast, t]);

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
      set_preset_menu_open(true);
    } catch (error) {
      set_preset_menu_open(false);
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("text_replacement_page.feedback.preset_failed")),
      );
    }
  }, [push_toast, refresh_preset_menu, t]);

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<{ entries: TextReplacementEntry[] }>(
          "/api/quality/rules/presets/read",
          {
            rule_type: config.rule_type,
            virtual_id,
          },
        );
        await persist_entries_with_duplicate_resolution(
          () => {
            return create_quality_rule_duplicate_resolution_plan({
              existing_entries: get_import_existing_entries(),
              incoming_entries: payload.entries,
            });
          },
          { close_preset_menu: true },
        );
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.preset_failed"),
          ),
        );
      }
    },
    [
      config.rule_type,
      get_import_existing_entries,
      persist_entries_with_duplicate_resolution,
      push_toast,
      readonly,
      t,
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
    (preset_item: TextReplacementPresetItem): void => {
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
    (preset_item: TextReplacementPresetItem): void => {
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
        push_toast("warning", t("text_replacement_page.feedback.preset_name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/rules/presets/save", {
          rule_type: config.rule_type,
          name: normalized_name,
          entries: entries
            .map((entry) => {
              return normalize_entry(entry);
            })
            .filter((entry) => entry.src !== ""),
        });
        await refresh_preset_menu();
        push_toast("success", t("text_replacement_page.feedback.preset_saved"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.preset_failed"),
          ),
        );
        return false;
      }
    },
    [config.rule_type, entries, push_toast, readonly, refresh_preset_menu, t],
  );

  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("text_replacement_page.feedback.preset_name_required"));
        return false;
      }

      try {
        const payload = await api_fetch<{ item?: TextReplacementPresetItem }>(
          "/api/quality/rules/presets/rename",
          {
            rule_type: config.rule_type,
            virtual_id,
            new_name: normalized_name,
          },
        );
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            build_default_preset_update_payload(config, String(payload.item?.virtual_id ?? "")),
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        push_toast("success", t("text_replacement_page.feedback.preset_renamed"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.preset_failed"),
          ),
        );
        return false;
      }
    },
    [apply_settings_snapshot, config, preset_items, push_toast, readonly, refresh_preset_menu, t],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>(
          "/api/settings/update",
          build_default_preset_update_payload(config, virtual_id),
        );
        apply_settings_snapshot(payload);
        await refresh_preset_menu();
        push_toast("success", t("text_replacement_page.feedback.default_preset_set"));
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.preset_failed"),
          ),
        );
      }
    },
    [apply_settings_snapshot, config, push_toast, readonly, refresh_preset_menu, t],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const payload = await api_fetch<SettingsSnapshotPayload>(
        "/api/settings/update",
        build_default_preset_update_payload(config, ""),
      );
      apply_settings_snapshot(payload);
      await refresh_preset_menu();
      push_toast("success", t("text_replacement_page.feedback.default_preset_cleared"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("text_replacement_page.feedback.preset_failed")),
      );
    }
  }, [apply_settings_snapshot, config, push_toast, readonly, refresh_preset_menu, t]);

  const validate_entry = useCallback(
    (entry: TextReplacementEntry): string | null => {
      if (entry.src === "") {
        return t("text_replacement_page.feedback.source_required");
      }

      if (!entry.regex) {
        return null;
      }

      try {
        void new RegExp(entry.src, entry.case_sensitive ? "" : "i");
        return null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        return `${t("text_replacement_page.feedback.regex_invalid")}: ${detail}`;
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

    const reopen_dialog_state: TextReplacementDialogState = {
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
      push_toast("warning", t("text_replacement_page.feedback.preset_name_required"));
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
      push_toast("warning", t("text_replacement_page.feedback.preset_exists"));
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
    push_toast("success", t("text_replacement_page.feedback.reset_success"));
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
            rule_type: config.rule_type,
            virtual_id: confirm_state.target_virtual_id,
          });

          const target_preset = preset_items.find((item) => {
            return item.virtual_id === confirm_state.target_virtual_id;
          });
          if (target_preset?.is_default) {
            const settings_payload = await api_fetch<SettingsSnapshotPayload>(
              "/api/settings/update",
              build_default_preset_update_payload(config, ""),
            );
            apply_settings_snapshot(settings_payload);
          }
          await refresh_preset_menu();
          push_toast("success", t("text_replacement_page.feedback.preset_deleted"));
          succeeded = true;
        }
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("text_replacement_page.feedback.preset_failed"),
          ),
        );
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
    config,
    confirm_state,
    preset_items,
    push_toast,
    readonly,
    refresh_preset_menu,
    reset_entries,
    save_preset,
    selected_entry_ids,
    apply_settings_snapshot,
    t,
  ]);

  return {
    title_key: config.title_key,
    enabled,
    entries,
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
    update_enabled,
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
    toggle_regex_for_selected,
    toggle_case_sensitive_for_selected,
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
