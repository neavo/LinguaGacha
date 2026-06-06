import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import type { QualityStatisticsDependencySnapshot } from "@shared/quality/quality-statistics";
import { buildProofreadingLookupQuery } from "@shared/quality/state";
import {
  read_glossary_quality_rule,
  read_glossary_section_revisions,
  type GlossaryQualityRuleQuerySlice,
} from "@frontend/pages/glossary-page/glossary-api-client";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { is_project_write_locked } from "@frontend/app/state/task-snapshot-store";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import { useDesktopToast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  build_glossary_filter_result,
  has_active_glossary_filters,
  resolve_glossary_statistics_badge_kind,
} from "@frontend/pages/glossary-page/filtering";
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
import type { QualityRuleImportConfirmState } from "@frontend/widgets/quality-rule-import-confirm-dialog/quality-rule-import-confirm-state";
import {
  useProjectSessionTableUiState,
  type ProjectSessionTableSelectionState,
} from "@frontend/app/session/project-session-ui-state-context";
import {
  are_glossary_entry_ids_equal,
  build_glossary_entry_id,
  reorder_selected_group,
} from "@frontend/pages/glossary-page/components/glossary-selection";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import type {
  GlossaryConfirmState,
  GlossaryDialogState,
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryFilterScope,
  GlossaryFilterState,
  GlossaryPresetInputState,
  GlossaryPresetItem,
  GlossarySortField,
  GlossarySortState,
  GlossaryStatisticsBadgeState,
  GlossaryStatisticsState,
  GlossaryVisibleEntry,
} from "@frontend/pages/glossary-page/types";

import { QualityRuleImportRuleTypeValue } from "@shared/quality/importer";

type GlossaryPresetPayload = {
  builtin_presets: GlossaryPresetItem[];
  user_presets: GlossaryPresetItem[];
};

type GlossaryResultQuery = {
  filter_state: GlossaryFilterState;
  sort_state: GlossarySortState;
};

type GlossaryQualitySlice = {
  enabled: boolean;
  entries: GlossaryEntry[];
  section_revision: number;
};

type GlossaryDuplicateApplyOptions = {
  close_preset_menu: boolean;
  result_refresh: ResultRefreshPolicy;
  feedback: "import" | "dialog";
};

// 术语表页维护自己的写入诊断名，desktop 层只负责提交和失败恢复。
const GLOSSARY_ENTRIES_SAVE_WRITE: ProjectWriteOperation = "glossary.entries_save";
// GLOSSARY META UPDATE WRITE 是模块级稳定契约，集中维护避免调用点散落魔术值。
const GLOSSARY_META_UPDATE_WRITE: ProjectWriteOperation = "glossary.meta_update";

// EMPTY ENTRY 是默认快照事实，调用方只读取副本不临时拼装。
const EMPTY_ENTRY: GlossaryEntry = {
  src: "",
  dst: "",
  info: "",
  case_sensitive: false,
};
const DEFAULT_QUALITY_SLICE: GlossaryQualitySlice = {
  enabled: true,
  entries: [],
  section_revision: 0,
};
// 术语表规则事实只归 quality section 拥有，items 变化只影响统计和结果视图。
const QUALITY_RULE_REFRESH_SECTIONS = ["quality"] as const;

function clone_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    dst: entry.dst,
    info: entry.info,
    case_sensitive: entry.case_sensitive,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_filter_state(): GlossaryFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_sort_state(): GlossarySortState {
  return {
    field: null,
    direction: null,
  };
}

// session 恢复排序的白名单，防止旧版本或其它页面列 id 泄入本页。
const GLOSSARY_SORT_FIELDS = new Set(["src", "dst", "info", "rule", "statistics"]);

// 在 session 边界收窄排序状态，坏状态统一回到默认值。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_glossary_sort_state(sort_state: GlossarySortState): GlossarySortState {
  if (sort_state.field === null || sort_state.direction === null) {
    return create_empty_sort_state();
  }

  if (!GLOSSARY_SORT_FIELDS.has(sort_state.field)) {
    return create_empty_sort_state();
  }

  return {
    field: sort_state.field,
    direction: sort_state.direction,
  };
}

// 切断 session 快照引用，避免页面编辑直接修改缓存对象。
function clone_glossary_filter_state(filter_state: GlossaryFilterState): GlossaryFilterState {
  return {
    keyword: filter_state.keyword,
    scope: filter_state.scope,
    is_regex: filter_state.is_regex,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_dialog_state(): GlossaryDialogState {
  return {
    open: false,
    mode: "create",
    target_entry_id: null,
    insert_after_entry_id: null,
    draft_entry: clone_entry(EMPTY_ENTRY),
    dirty: false,
    saving: false,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function create_empty_confirm_state(): GlossaryConfirmState {
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
 * 构建当前场景的稳定结果。
 */
function create_empty_preset_input_state(): GlossaryPresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

// 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_dialog_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    info: entry.info.trim(),
    case_sensitive: entry.case_sensitive,
  };
}

// 在后端 query 边界收窄规则事实，页面内部只消费稳定形状。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_glossary_quality_slice(
  slice: GlossaryQualityRuleQuerySlice | undefined,
  section_revision: number,
): GlossaryQualitySlice {
  const raw_entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    enabled: slice?.enabled === undefined ? true : Boolean(slice.enabled),
    entries: ensure_quality_rule_entry_ids(
      raw_entries.map((entry) => {
        const record = typeof entry === "object" && entry !== null ? entry : {};
        return normalize_dialog_entry({
          ...EMPTY_ENTRY,
          ...(record as Partial<GlossaryEntry>),
        });
      }),
    ),
    section_revision,
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.json`;
}

// 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_preset_name(name: string): string {
  return name.trim();
}

/**
 * 判断当前值是否满足业务条件。
 */
function has_casefold_duplicate_preset(
  preset_items: GlossaryPresetItem[],
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

function decorate_preset_items(
  builtin_presets: GlossaryPresetItem[],
  user_presets: GlossaryPresetItem[],
  default_virtual_id: string,
): GlossaryPresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => {
    return {
      ...item,
      is_default: item.virtual_id === default_virtual_id,
    };
  });
}

/**
 * 构建当前场景的稳定结果。
 */
function build_statistics_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: GlossaryEntry,
  matched_count: number,
  subset_parent_labels: string[],
): string {
  const tooltip_lines = [
    t("glossary_page.statistics.hit_count").replace("{COUNT}", matched_count.toString()),
  ];

  if (subset_parent_labels.length > 0) {
    tooltip_lines.push(t("glossary_page.statistics.subset_relations"));
    tooltip_lines.push(
      ...subset_parent_labels.map((label) => {
        return `${entry.src} -> ${label}`;
      }),
    );
  }

  return tooltip_lines.join("\n");
}

export function buildGlossaryStatisticsState(args: {
  snapshot: QualityStatisticsDependencySnapshot;
  completed_entry_ids: GlossaryEntryId[];
  results: Record<string, { matched_item_count?: number; subset_parents?: string[] }>;
}): GlossaryStatisticsState {
  return {
    running: false,
    completed_snapshot: args.snapshot,
    completed_entry_ids: args.completed_entry_ids,
    matched_count_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.matched_item_count ?? 0];
      }),
    ),
    subset_parent_labels_by_entry_id: Object.fromEntries(
      Object.entries(args.results).map(([entry_id, result]) => {
        return [entry_id, result.subset_parents ?? []];
      }),
    ),
  };
}

/**
 * 构建当前场景的稳定结果。
 */
function build_glossary_statistics_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): GlossaryStatisticsState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改项目质量规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    completed_snapshot: statistics_cache.completed_snapshot,
    completed_entry_ids: statistics_cache.completed_entry_ids,
    matched_count_by_entry_id: statistics_cache.matched_count_by_entry_id,
    subset_parent_labels_by_entry_id: statistics_cache.subset_parent_labels_by_entry_id,
  };
}

type UseGlossaryPageStateResult = {
  enabled: boolean;
  filtered_entries: GlossaryVisibleEntry[];
  filter_state: GlossaryFilterState;
  sort_state: GlossarySortState;
  invalid_filter_message: string | null;
  readonly: boolean;
  drag_disabled: boolean;
  statistics_ready: boolean;
  statistics_sort_available: boolean;
  statistics_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState>;
  preset_items: GlossaryPresetItem[];
  selected_entry_ids: GlossaryEntryId[];
  active_entry_id: GlossaryEntryId | null;
  selection_anchor_entry_id: GlossaryEntryId | null;
  restore_scroll_entry_id: GlossaryEntryId | null;
  preset_menu_open: boolean;
  dialog_state: GlossaryDialogState;
  confirm_state: GlossaryConfirmState;
  import_confirm_state: QualityRuleImportConfirmState;
  preset_input_state: GlossaryPresetInputState;
  update_filter_keyword: (next_keyword: string) => void;
  update_filter_scope: (next_scope: GlossaryFilterScope) => void;
  update_filter_regex: (next_is_regex: boolean) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  update_enabled: (next_enabled: boolean) => Promise<void>;
  open_create_dialog: () => void;
  open_edit_dialog: (entry_id: GlossaryEntryId) => void;
  update_dialog_draft: (patch: Partial<GlossaryEntry>) => void;
  import_entries_from_path: (path: string) => Promise<void>;
  import_entries_from_picker: () => Promise<void>;
  export_entries_from_picker: () => Promise<void>;
  open_preset_menu: () => Promise<void>;
  apply_preset: (virtual_id: string) => Promise<void>;
  request_reset_entries: () => void;
  request_save_preset: () => void;
  request_rename_preset: (preset_item: GlossaryPresetItem) => void;
  request_delete_preset: (preset_item: GlossaryPresetItem) => void;
  set_default_preset: (virtual_id: string) => Promise<void>;
  cancel_default_preset: () => Promise<void>;
  delete_selected_entries: () => Promise<void>;
  toggle_case_sensitive_for_selected: (next_value: boolean) => Promise<void>;
  reorder_selected_entries: (
    active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ) => Promise<void>;
  query_entry_source_from_statistics: (entry_id: GlossaryEntryId) => Promise<void>;
  search_entry_relations_from_statistics: (entry_id: GlossaryEntryId) => void;
  save_dialog_entry: () => Promise<void>;
  request_close_dialog: () => Promise<void>;
  confirm_pending_action: () => Promise<void>;
  close_confirm_dialog: () => void;
  import_duplicate_skip: () => Promise<void>;
  import_duplicate_overwrite: () => Promise<void>;
  close_import_duplicate_confirm: () => void;
  update_preset_input_value: (next_value: string) => void;
  submit_preset_input: () => Promise<void>;
  close_preset_input_dialog: () => void;
  set_preset_menu_open: (next_open: boolean) => void;
};

export function useGlossaryPageState(): UseGlossaryPageStateResult {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const {
    project_snapshot,
    project_change_signal,
    project_session_status = "ready",
    settings_snapshot,
    apply_settings_snapshot,
    commit_project_write,
    task_snapshot,
  } = useDesktopState();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const [quality_slice, set_quality_slice] = useState<GlossaryQualitySlice>(DEFAULT_QUALITY_SLICE);
  const [quality_loaded, set_quality_loaded] = useState(false);
  const enabled = project_snapshot.loaded ? quality_slice.enabled : true;
  const entries = project_snapshot.loaded ? quality_slice.entries : [];
  const [preset_items, set_preset_items] = useState<GlossaryPresetItem[]>([]);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const table_ui_state = useProjectSessionTableUiState<GlossaryFilterState, GlossarySortState>({
    key: "quality:glossary",
    create_default_filter_state: create_empty_filter_state,
    create_default_sort_state: create_empty_sort_state,
    clone_filter_state: clone_glossary_filter_state,
    normalize_sort_state: normalize_glossary_sort_state,
  });
  // table_ui_state 是质量规则页跨路由保留筛选、排序和选区的唯一 session 状态入口。
  const filter_state = table_ui_state.filter_state;
  const sort_state = table_ui_state.sort_state;
  const selected_entry_ids = table_ui_state.selected_row_ids as GlossaryEntryId[];
  const active_entry_id = table_ui_state.active_row_id as GlossaryEntryId | null;
  const selection_anchor_entry_id = table_ui_state.anchor_row_id as GlossaryEntryId | null;
  const restore_scroll_entry_id = table_ui_state.restore_scroll_row_id as GlossaryEntryId | null;
  const set_table_filter_state = table_ui_state.set_filter_state;
  const set_table_sort_state = table_ui_state.set_sort_state;
  const set_table_selection_state = table_ui_state.set_selection_state;
  const restore_table_selection_state = table_ui_state.restore_selection_state;
  const reset_table_state = table_ui_state.reset_table_state;
  const [dialog_state, set_dialog_state] = useState<GlossaryDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [confirm_state, set_confirm_state] = useState<GlossaryConfirmState>(() => {
    return create_empty_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<GlossaryPresetInputState>(() => {
    return create_empty_preset_input_state();
  });
  const dialog_state_ref = useRef(dialog_state);
  const entries_ref = useRef(entries);
  const statistics_cache = useQualityRuleStatistics("glossary");
  const statistics_state = useMemo<GlossaryStatisticsState>(() => {
    return build_glossary_statistics_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const statistics_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  const statistics_sort_available =
    statistics_ready || statistics_state.completed_snapshot !== null;
  // 区分同组件内项目身份切换，避免把上一项目的表格状态写入新项目。
  const project_view_identity_ref = useRef(project_snapshot.loaded ? project_snapshot.path : "");

  const refresh_quality_rule_snapshot = useCallback(async (): Promise<GlossaryQualitySlice> => {
    if (
      !project_snapshot.loaded ||
      project_snapshot.path === "" ||
      project_session_status !== "ready"
    ) {
      set_quality_slice(DEFAULT_QUALITY_SLICE);
      set_quality_loaded(false);
      return DEFAULT_QUALITY_SLICE;
    }

    const response = await read_glossary_quality_rule();
    if (response.projectPath !== project_snapshot.path) {
      return quality_slice;
    }
    const next_slice = normalize_glossary_quality_slice(
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
    void read_glossary_quality_rule().then((response) => {
      if (cancelled || response.projectPath !== project_snapshot.path) {
        return;
      }
      set_quality_slice(
        normalize_glossary_quality_slice(
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
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

  useEffect(() => {
    entries_ref.current = entries;
  }, [entries]);

  const entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return entries.map((entry, index) => {
      return build_glossary_entry_id(entry, index);
    });
  }, [entries]);

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]));
  }, [entry_ids]);

  const resolve_create_insert_after_entry_id = useCallback((): GlossaryEntryId | null => {
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
  const completed_statistics_entry_id_set = useMemo<ReadonlySet<GlossaryEntryId>>(() => {
    return new Set(statistics_state.completed_entry_ids);
  }, [statistics_state.completed_entry_ids]);
  const build_result_snapshot = useCallback(
    (
      next_filter_state: GlossaryFilterState,
      next_sort_state: GlossarySortState,
    ): ResultSnapshot<GlossaryResultQuery, GlossaryEntryId> => {
      const result = build_glossary_filter_result({
        entries,
        entry_ids,
        filter_state: next_filter_state,
        sort_state: next_sort_state,
        statistics_sort_available,
        statistics_state,
        completed_statistics_entry_id_set,
      });

      return create_result_snapshot({
        applied_query: {
          filter_state: next_filter_state,
          sort_state: next_sort_state,
        },
        ordered_ids: result.visible_entries.map((entry) => entry.entry_id),
        invalid_message: result.invalid_regex_message,
      });
    },
    [
      completed_statistics_entry_id_set,
      entries,
      entry_ids,
      statistics_sort_available,
      statistics_state,
    ],
  );
  const build_current_result_snapshot = useCallback(() => {
    return build_result_snapshot(filter_state, sort_state);
  }, [build_result_snapshot, filter_state, sort_state]);
  const has_active_filters = has_active_glossary_filters(filter_state);
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
    (next_filter_state: GlossaryFilterState, next_sort_state: GlossarySortState): void => {
      set_result_snapshot(build_result_snapshot(next_filter_state, next_sort_state));
    },
  );
  const live_filter_result = useMemo(() => {
    return build_glossary_filter_result({
      entries,
      entry_ids,
      filter_state,
      sort_state,
      statistics_sort_available,
      statistics_state,
      completed_statistics_entry_id_set,
    });
  }, [
    completed_statistics_entry_id_set,
    entries,
    entry_ids,
    filter_state,
    sort_state,
    statistics_sort_available,
    statistics_state,
  ]);
  const visible_entry_by_id = useMemo(() => {
    return new Map(
      entries.flatMap((entry, source_index) => {
        const entry_id = entry_ids[source_index];
        return entry_id === undefined ? [] : [[entry_id, { entry, entry_id, source_index }]];
      }),
    );
  }, [entries, entry_ids]);
  const filtered_entries = useMemo<GlossaryVisibleEntry[]>(() => {
    if (result_snapshot === null) {
      return live_filter_result.visible_entries;
    }

    return materialize_result_snapshot({
      snapshot: result_snapshot,
      item_by_id: visible_entry_by_id,
    });
  }, [live_filter_result.visible_entries, result_snapshot, visible_entry_by_id]);
  const invalid_regex_message =
    result_snapshot?.invalid_message ?? live_filter_result.invalid_regex_message;
  const visible_entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id);
  }, [filtered_entries]);
  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids);
  }, [visible_entry_ids]);
  const has_active_sort = sort_state.field !== null;
  const readonly = is_project_write_locked(task_snapshot);
  const drag_disabled = readonly || has_active_filters || has_active_sort; // 搜索过滤和逻辑排序都会打破“真实顺序即操作上下文”的前提，因此拖拽要一起禁用
  const statistics_badge_by_entry_id = useMemo<
    Record<GlossaryEntryId, GlossaryStatisticsBadgeState>
  >(() => {
    const next_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState> = {};
    if (!statistics_ready && statistics_state.completed_snapshot === null) {
      return next_badge_by_entry_id;
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index];
      if (entry_id === undefined) {
        return;
      }

      const kind = resolve_glossary_statistics_badge_kind(
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
      next_entries: GlossaryEntry[],
      result_refresh: ResultRefreshPolicy = PRESERVE_RESULT_REFRESH,
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_entries = ensure_quality_rule_entry_ids(
        next_entries.map((entry) => {
          return normalize_dialog_entry(entry);
        }),
      );

      try {
        const section_revisions = await read_glossary_section_revisions();
        await commit_project_write({
          operation: GLOSSARY_ENTRIES_SAVE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/save-entries", {
              rule_type: "glossary",
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
          resolve_visible_error_message(error, t, t("glossary_page.feedback.save_failed")),
        );
        return false;
      }
    },
    [commit_project_write, push_toast, readonly, refresh_quality_rule_snapshot, t],
  );

  const apply_duplicate_resolved_entries = useCallback(
    async (
      next_entries: GlossaryEntry[],
      options: GlossaryDuplicateApplyOptions,
    ): Promise<boolean> => {
      const saved = await save_entries_snapshot(next_entries, options.result_refresh);
      if (!saved) {
        return false;
      }

      if (options.feedback === "import") {
        clear_selection_state();
        push_toast("success", t("glossary_page.feedback.import_success"));
      }

      if (options.close_preset_menu) {
        set_preset_menu_open(false);
      }

      return true;
    },
    [clear_selection_state, push_toast, save_entries_snapshot, t],
  );

  const read_current_glossary_entries = useCallback((): GlossaryEntry[] => {
    return entries_ref.current.map((entry) => clone_entry(entry));
  }, []);
  const import_confirmation = useQualityRuleImportConfirmation<
    GlossaryEntry,
    GlossaryDuplicateApplyOptions
  >({
    rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
    apply_entries: apply_duplicate_resolved_entries,
  });
  const {
    import_confirm_state,
    persist_entries_with_duplicate_resolution,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
  } = import_confirmation;

  const build_dialog_duplicate_resolution_plan = useCallback(
    (current_dialog_state: GlossaryDialogState, normalized_entry: GlossaryEntry) => {
      const current_entries = read_current_glossary_entries();
      const current_entry_ids = current_entries.map((entry, index) => {
        return build_glossary_entry_id(entry, index);
      });
      const existing_entries =
        current_dialog_state.mode === "edit"
          ? current_entries.filter((_entry, index) => {
              return current_entry_ids[index] !== current_dialog_state.target_entry_id;
            })
          : current_entries;
      const direct_entries =
        current_dialog_state.mode === "create"
          ? (() => {
              const insert_after_index =
                current_dialog_state.insert_after_entry_id === null
                  ? -1
                  : current_entry_ids.findIndex((entry_id) => {
                      return entry_id === current_dialog_state.insert_after_entry_id;
                    });
              const insert_index =
                insert_after_index < 0 ? current_entries.length : insert_after_index + 1;
              const next_entries = [...current_entries];

              next_entries.splice(insert_index, 0, normalized_entry);
              return next_entries;
            })()
          : current_entries.map((entry, index) => {
              return current_entry_ids[index] === current_dialog_state.target_entry_id
                ? {
                    ...entry,
                    ...normalized_entry,
                  }
                : entry;
            });

      return create_quality_rule_duplicate_resolution_plan({
        existing_entries,
        incoming_entries: [normalized_entry],
        direct_entries,
        skip_entries: null,
        before_pending: () => {
          set_dialog_state(create_empty_dialog_state());
        },
        before_apply: () => {
          set_dialog_state(create_empty_dialog_state());
        },
      });
    },
    [read_current_glossary_entries],
  );

  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<GlossaryPresetPayload>("/api/quality/rules/presets", {
      rule_type: "glossary",
    });
    const default_virtual_id = String(settings_snapshot.glossary_default_preset ?? "");

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
    const selection_changed = !are_glossary_entry_ids_equal(
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
    (next_scope: GlossaryFilterScope): void => {
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
      const next_glossary_sort_state =
        next_sort_state === null
          ? create_empty_sort_state()
          : {
              field: next_sort_state.column_id as GlossarySortField,
              direction: next_sort_state.direction,
            };
      debounced_result_snapshot.cancel();
      set_table_sort_state(next_glossary_sort_state);
      set_result_snapshot(build_result_snapshot(filter_state, next_glossary_sort_state));
    },
    [build_result_snapshot, debounced_result_snapshot, filter_state, set_table_sort_state],
  );

  const apply_table_selection = useCallback(
    (payload: AppTableSelectionChange): void => {
      set_table_selection_state(payload);
    },
    [set_table_selection_state],
  );

  const search_entry_relations_from_statistics = useCallback(
    (entry_id: GlossaryEntryId): void => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      const next_filter_state = {
        // 统计入口要把用户带回一条可解释的筛选路径，保持筛选条件完全显式。
        keyword: target_entry.src,
        scope: "src" as const,
        is_regex: false,
      };
      debounced_result_snapshot.cancel();
      set_table_filter_state(next_filter_state);
      set_result_snapshot(build_result_snapshot(next_filter_state, sort_state));
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      entries,
      entry_index_by_id,
      set_table_filter_state,
      sort_state,
    ],
  );

  const update_enabled = useCallback(
    async (next_enabled: boolean): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const section_revisions = await read_glossary_section_revisions();
        await commit_project_write({
          operation: GLOSSARY_META_UPDATE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update-meta", {
              rule_type: "glossary",
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
          resolve_visible_error_message(error, t, t("glossary_page.feedback.save_failed")),
        );
      }
    },
    [commit_project_write, push_toast, readonly, refresh_quality_rule_snapshot, t],
  );

  const open_create_dialog = useCallback((): void => {
    if (readonly) {
      return;
    }

    const insert_after_entry_id = resolve_create_insert_after_entry_id();

    clear_selection_state(); // 新增态不再继承当前选中上下文，避免动作条删除与创建语义冲突
    set_dialog_state({
      open: true,
      mode: "create",
      target_entry_id: null,
      insert_after_entry_id,
      draft_entry: clone_entry(EMPTY_ENTRY),
      dirty: false,
      saving: false,
    });
  }, [clear_selection_state, readonly, resolve_create_insert_after_entry_id]);

  const open_edit_dialog = useCallback(
    (entry_id: GlossaryEntryId): void => {
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
        dirty: false,
        saving: false,
      });
    },
    [entries, entry_index_by_id, readonly, set_table_selection_state],
  );

  const update_dialog_draft = useCallback((patch: Partial<GlossaryEntry>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        dirty: true,
        draft_entry: {
          ...previous_state.draft_entry,
          ...patch,
        },
      };
    });
  }, []);

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

  const commit_delete_selected_entries = useCallback(async (): Promise<boolean> => {
    if (readonly || selected_entry_ids.length === 0) {
      return true;
    }

    const selected_set = new Set(selected_entry_ids);
    const previous_selection_state: ProjectSessionTableSelectionState = {
      selected_row_ids: selected_entry_ids,
      active_row_id: active_entry_id,
      anchor_row_id: selection_anchor_entry_id,
    };
    const next_entries = entries.filter((_entry, index) => {
      return !selected_set.has(entry_ids[index] ?? "");
    });

    clear_selection_state();

    const saved = await save_entries_snapshot(next_entries);
    if (!saved) {
      restore_table_selection_state(previous_selection_state);
      return false;
    }

    return true;
  }, [
    active_entry_id,
    clear_selection_state,
    entries,
    entry_ids,
    save_entries_snapshot,
    readonly,
    selected_entry_ids,
    selection_anchor_entry_id,
    restore_table_selection_state,
  ]);

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
      current_active_entry_id: GlossaryEntryId,
      over_entry_id: GlossaryEntryId,
    ): Promise<void> => {
      if (readonly || current_active_entry_id === over_entry_id) {
        return;
      }

      const next_entries = reorder_selected_group(
        entries,
        entry_ids,
        selected_entry_ids,
        current_active_entry_id,
        over_entry_id,
      );

      await save_entries_snapshot(next_entries, REBUILD_RESULT_REFRESH);
    },
    [entries, entry_ids, readonly, save_entries_snapshot, selected_entry_ids],
  );

  const persist_dialog_entry = useCallback(async (): Promise<boolean> => {
    if (readonly) {
      return false;
    }

    const current_dialog_state = dialog_state;
    const normalized_entry = {
      ...normalize_dialog_entry(dialog_state.draft_entry),
      entry_id: dialog_state.draft_entry.entry_id ?? create_quality_rule_entry_id(),
    };

    if (normalized_entry.src === "") {
      push_toast("error", t("glossary_page.feedback.source_required"));
      return false;
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: true,
    }));

    const reopen_dialog_state: GlossaryDialogState = {
      ...current_dialog_state,
      saving: false,
    };
    const save_result = await persist_entries_with_duplicate_resolution(
      () => {
        return build_dialog_duplicate_resolution_plan(current_dialog_state, normalized_entry);
      },
      {
        close_preset_menu: false,
        result_refresh:
          current_dialog_state.mode === "create" ? REBUILD_RESULT_REFRESH : PRESERVE_RESULT_REFRESH,
        feedback: "dialog",
      },
    );
    if (save_result === "saved") {
      push_toast("success", t("app.feedback.save_success"));
      return true;
    }

    if (save_result === "pending") {
      return false;
    }

    if (!dialog_state_ref.current.open) {
      set_dialog_state(reopen_dialog_state);
    }
    return false;
  }, [
    build_dialog_duplicate_resolution_plan,
    dialog_state,
    persist_entries_with_duplicate_resolution,
    push_toast,
    readonly,
    t,
  ]);

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    await persist_dialog_entry();
  }, [persist_dialog_entry]);

  const request_close_dialog = useCallback(async (): Promise<void> => {
    set_dialog_state(create_empty_dialog_state());
  }, []);

  const query_entry_source_from_statistics = useCallback(
    async (entry_id: GlossaryEntryId): Promise<void> => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      try {
        push_proofreading_lookup_intent(
          buildProofreadingLookupQuery({
            rule_type: "glossary",
            entry: normalize_dialog_entry(target_entry),
          }),
        );
        navigate_to_route("proofreading");
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.query_failed")),
        );
      }
    },
    [entries, entry_index_by_id, navigate_to_route, push_proofreading_lookup_intent, push_toast, t],
  );

  const import_entries_from_path = useCallback(
    async (path: string): Promise<void> => {
      try {
        if (readonly || path.trim() === "") {
          return;
        }

        const payload = await api_fetch<{ entries?: GlossaryEntry[] }>(
          "/api/quality/rules/import",
          {
            rule_type: "glossary",
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
              existing_entries: read_current_glossary_entries(),
              incoming_entries: imported_entries,
            });
          },
          {
            close_preset_menu: false,
            result_refresh: REBUILD_RESULT_REFRESH,
            feedback: "import",
          },
        );
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.import_failed")),
        );
      }
    },
    [
      persist_entries_with_duplicate_resolution,
      push_toast,
      read_current_glossary_entries,
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
      const pick_result = await window.desktopApp.pickGlossaryExportPath("glossary.json");
      const selected_path = pick_result.paths[0] ?? null;
      if (pick_result.canceled || selected_path === null) {
        return;
      }

      await api_fetch("/api/quality/rules/export", {
        rule_type: "glossary",
        path: selected_path,
        entries: entries.map((entry) => {
          return normalize_dialog_entry(entry);
        }),
      });
      push_toast("success", t("glossary_page.feedback.export_success"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.export_failed")),
      );
    }
  }, [entries, push_toast, t]);

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
      set_preset_menu_open(true);
    } catch (error) {
      set_preset_menu_open(false);
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
      );
    }
  }, [push_toast, refresh_preset_menu, t]);

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<{ entries: GlossaryEntry[] }>(
          "/api/quality/rules/presets/read",
          {
            rule_type: "glossary",
            virtual_id,
          },
        );
        await persist_entries_with_duplicate_resolution(
          () => {
            return create_quality_rule_duplicate_resolution_plan({
              existing_entries: read_current_glossary_entries(),
              incoming_entries: payload.entries,
            });
          },
          {
            close_preset_menu: true,
            result_refresh: REBUILD_RESULT_REFRESH,
            feedback: "import",
          },
        );
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
        );
      }
    },
    [
      persist_entries_with_duplicate_resolution,
      push_toast,
      read_current_glossary_entries,
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
    (preset_item: GlossaryPresetItem): void => {
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
    (preset_item: GlossaryPresetItem): void => {
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
        push_toast("warning", t("glossary_page.feedback.preset_name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/rules/presets/save", {
          rule_type: "glossary",
          name: normalized_name,
          entries: entries
            .map((entry) => {
              return normalize_dialog_entry(entry);
            })
            .filter((entry) => entry.src !== ""),
        });
        await refresh_preset_menu();
        push_toast("success", t("glossary_page.feedback.preset_saved"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [entries, push_toast, readonly, refresh_preset_menu, t],
  );

  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("glossary_page.feedback.preset_name_required"));
        return false;
      }

      try {
        const payload = await api_fetch<{ item?: GlossaryPresetItem }>(
          "/api/quality/rules/presets/rename",
          {
            rule_type: "glossary",
            virtual_id,
            new_name: normalized_name,
          },
        );
        const target_preset = preset_items.find((item) => item.virtual_id === virtual_id);
        if (target_preset?.is_default) {
          const settings_payload = await api_fetch<SettingsSnapshotPayload>(
            "/api/settings/update",
            {
              glossary_default_preset: String(payload.item?.virtual_id ?? ""),
            },
          );
          apply_settings_snapshot(settings_payload);
        }
        await refresh_preset_menu();
        push_toast("success", t("glossary_page.feedback.preset_renamed"));
        return true;
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
        );
        return false;
      }
    },
    [apply_settings_snapshot, preset_items, push_toast, readonly, refresh_preset_menu, t],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      if (readonly) {
        return;
      }

      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          glossary_default_preset: virtual_id,
        });
        apply_settings_snapshot(payload);
        await refresh_preset_menu();
        push_toast("success", t("glossary_page.feedback.default_preset_set"));
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
        );
      }
    },
    [apply_settings_snapshot, push_toast, readonly, refresh_preset_menu, t],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    if (readonly) {
      return;
    }

    try {
      const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
        glossary_default_preset: "",
      });
      apply_settings_snapshot(payload);
      await refresh_preset_menu();
      push_toast("success", t("glossary_page.feedback.default_preset_cleared"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
      );
    }
  }, [apply_settings_snapshot, push_toast, readonly, refresh_preset_menu, t]);

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
      push_toast("warning", t("glossary_page.feedback.preset_name_required"));
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
      push_toast("warning", t("glossary_page.feedback.preset_exists"));
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
    push_toast("success", t("glossary_page.feedback.reset_success"));
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
      succeeded = await commit_delete_selected_entries();
    } else if (confirm_state.kind === "reset") {
      succeeded = await reset_entries();
    } else if (confirm_state.kind === "delete-preset") {
      try {
        if (confirm_state.target_virtual_id !== null) {
          await api_fetch("/api/quality/rules/presets/delete", {
            rule_type: "glossary",
            virtual_id: confirm_state.target_virtual_id,
          });

          const target_preset = preset_items.find((item) => {
            return item.virtual_id === confirm_state.target_virtual_id;
          });
          if (target_preset?.is_default) {
            const settings_payload = await api_fetch<SettingsSnapshotPayload>(
              "/api/settings/update",
              {
                glossary_default_preset: "",
              },
            );
            apply_settings_snapshot(settings_payload);
          }
          await refresh_preset_menu();
          push_toast("success", t("glossary_page.feedback.preset_deleted"));
          succeeded = true;
        }
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
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
    commit_delete_selected_entries,
    confirm_state,
    preset_items,
    push_toast,
    refresh_preset_menu,
    reset_entries,
    readonly,
    save_preset,
    apply_settings_snapshot,
    t,
  ]);

  return useMemo<UseGlossaryPageStateResult>(() => {
    return {
      enabled,
      filtered_entries,
      filter_state,
      sort_state,
      invalid_filter_message: invalid_regex_message,
      readonly,
      drag_disabled,
      statistics_ready,
      statistics_sort_available,
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
      toggle_case_sensitive_for_selected,
      reorder_selected_entries,
      query_entry_source_from_statistics,
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
  }, [
    active_entry_id,
    apply_table_selection,
    apply_table_sort_state,
    apply_preset,
    cancel_default_preset,
    close_confirm_dialog,
    close_import_duplicate_confirm,
    close_preset_input_dialog,
    confirm_pending_action,
    confirm_state,
    delete_selected_entries,
    dialog_state,
    drag_disabled,
    enabled,
    export_entries_from_picker,
    filter_state,
    filtered_entries,
    import_entries_from_path,
    import_entries_from_picker,
    import_confirm_state,
    import_duplicate_overwrite,
    import_duplicate_skip,
    invalid_regex_message,
    open_create_dialog,
    open_edit_dialog,
    open_preset_menu,
    preset_items,
    preset_input_state,
    preset_menu_open,
    query_entry_source_from_statistics,
    reorder_selected_entries,
    request_delete_preset,
    request_close_dialog,
    request_rename_preset,
    request_reset_entries,
    request_save_preset,
    readonly,
    restore_scroll_entry_id,
    save_dialog_entry,
    search_entry_relations_from_statistics,
    selected_entry_ids,
    selection_anchor_entry_id,
    set_default_preset,
    sort_state,
    statistics_badge_by_entry_id,
    statistics_sort_available,
    statistics_ready,
    submit_preset_input,
    toggle_case_sensitive_for_selected,
    update_dialog_draft,
    update_enabled,
    update_filter_keyword,
    update_filter_regex,
    update_filter_scope,
    update_preset_input_value,
  ]);
}
