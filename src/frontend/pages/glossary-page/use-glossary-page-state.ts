import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  type ProjectWriteOperation,
  type ProjectWriteResultPayload,
} from "@frontend/app/state/desktop-project-write";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import { buildProofreadingLookupQuery } from "@shared/quality/quality-rule-proofreading-query";
import {
  export_quality_rule_entries,
  import_quality_rule_entries,
  pick_quality_rule_import_path,
  type QualityRuleQuerySlice,
} from "@frontend/features/quality-rule-editor/quality-rule-api-client";
import { useQualityRuleQuery } from "@frontend/features/quality-rule-editor/use-quality-rule-query";
import {
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  type QualityRuleStatisticsCacheSnapshot,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { SettingsSnapshotPayload } from "@frontend/app/state/desktop-state-context";
import { is_runtime_busy } from "@frontend/app/state/runtime-activity-store";
import { useQualityRuleStatistics } from "@frontend/app/session/quality-rule-statistics-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
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
  PresetInputState as GlossaryPresetInputState,
  PresetItem as GlossaryPresetItem,
} from "@frontend/features/preset-editor/preset-types";
import {
  has_active_quality_rule_filters,
  resolve_quality_rule_hit_badge_kind,
} from "@frontend/features/quality-rule-editor/quality-rule-filtering";
import {
  create_empty_quality_rule_confirm_state,
  type QualityRuleConfirmState,
} from "@frontend/features/quality-rule-editor/quality-rule-confirm-state";
import { build_glossary_filter_result } from "@frontend/pages/glossary-page/filtering";
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
import { create_quality_rule_entry_id } from "@shared/quality/quality-rule-entry";
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
  reorder_selected_quality_rule_entries,
  resolve_quality_rule_insert_after_entry_id,
} from "@frontend/features/quality-rule-editor/quality-rule-selection";
import {
  useQualityRuleResultControls,
  useQualityRuleSelectionPruning,
  useQualityRuleTableSessionReset,
} from "@frontend/features/quality-rule-editor/use-quality-rule-table-session";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import type {
  GlossaryDialogState,
  GlossaryEntry,
  GlossaryEntryDraft,
  GlossaryEntryId,
  GlossaryFilterScope,
  GlossaryFilterState,
  GlossarySortField,
  GlossarySortState,
  GlossaryHitBadgeState,
  GlossaryHitState,
  GlossaryVisibleEntry,
} from "@frontend/pages/glossary-page/types";

import { QualityRuleImportRuleTypeValue } from "@shared/quality/quality-rule-import";

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
// 元信息开关与条目保存使用不同诊断名，便于定位失败的写入意图。
const GLOSSARY_META_UPDATE_WRITE: ProjectWriteOperation = "glossary.meta_update";

// 对话框总是克隆该模板，避免复用可变草稿引用。
const EMPTY_ENTRY: GlossaryEntryDraft = {
  src: "",
  dst: "",
  info: "",
  case_sensitive: false,
};
// 首次查询前使用与后端默认语义一致的只读切片。
const DEFAULT_QUALITY_SLICE: GlossaryQualitySlice = {
  enabled: true,
  entries: [],
  section_revision: 0,
};
/** 按术语字段白名单克隆，避免重复规划联合类型中的异类字段泄漏。 */
function clone_entry<Entry extends GlossaryEntryDraft>(entry: Entry): Entry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    dst: entry.dst,
    info: entry.info,
    case_sensitive: entry.case_sensitive,
  } as Entry;
}

/** 新项目或清空筛选时的完整筛选状态。 */
function create_empty_filter_state(): GlossaryFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

/** 使用成对空值表达“未排序”，避免半有效排序状态。 */
function create_empty_sort_state(): GlossarySortState {
  return {
    field: null,
    direction: null,
  };
}

// session 恢复排序的白名单，防止旧版本或其它页面列 id 泄入本页。
const GLOSSARY_SORT_FIELDS = new Set(["src", "dst", "info", "rule", "hit"]);

/**
 * 在 session 恢复边界收窄排序状态，旧列或半有效状态统一回到未排序。
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

/** AppTable 的通用列排序在页面边界收窄为术语表字段。 */
function resolve_glossary_table_sort_state(
  sort_state: AppTableSortState | null,
): GlossarySortState {
  return sort_state === null
    ? create_empty_sort_state()
    : {
        field: sort_state.column_id as GlossarySortField,
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

/** 每次关闭编辑框都重建草稿，避免跨条目残留保存态。 */
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
 * 在保存边界按术语字段白名单投影并裁掉文本两端空白，同时保留稳定条目 ID。
 */
function normalize_dialog_entry<Entry extends GlossaryEntryDraft>(entry: Entry): Entry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    info: entry.info.trim(),
    case_sensitive: entry.case_sensitive,
  } as Entry;
}

/**
 * 将后端 quality 查询收窄为页面稳定切片。
 */
function normalize_glossary_quality_slice(
  slice: QualityRuleQuerySlice<"glossary"> | undefined,
  section_revision: number,
): GlossaryQualitySlice {
  const raw_entries = Array.isArray(slice?.entries) ? slice.entries : [];
  return {
    enabled: slice?.enabled === undefined ? true : Boolean(slice.enabled),
    entries: raw_entries.map((entry) => normalize_dialog_entry(entry)),
    section_revision,
  };
}

/**
 * 将命中数和子集父项关系合并成徽章的多行说明。
 */
function build_hit_badge_tooltip(
  t: (key: LocaleKey) => string,
  entry: GlossaryEntry,
  hits: number,
  subset_parents: string[],
): string {
  const tooltip_lines = [
    t("quality_rule_editor.hit.hit_count").replace("{COUNT}", hits.toString()),
  ];

  if (subset_parents.length > 0) {
    tooltip_lines.push(t("quality_rule_editor.hit.subset_relations"));
    tooltip_lines.push(
      ...subset_parents.map((label) => {
        return `${entry.src} -> ${label}`;
      }),
    );
  }

  return tooltip_lines.join("\n");
}

/**
 * 将会话级统计缓存投影为页面只读状态，不复制规则事实。
 */
function build_glossary_hit_state_from_cache(
  statistics_cache: QualityRuleStatisticsCacheSnapshot,
): GlossaryHitState {
  // 页面只从质量统计缓存计算展示状态，不持有也不修改项目质量规则事实。
  return {
    running: isQualityRuleStatisticsCacheRunning(statistics_cache),
    entry_ids: statistics_cache.entry_ids,
    hits_by_entry_id: statistics_cache.hits_by_entry_id,
    subset_parents_by_entry_id: statistics_cache.subset_parents_by_entry_id,
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
  hit_ready: boolean;
  hit_sort_available: boolean;
  hit_badge_by_entry_id: Record<GlossaryEntryId, GlossaryHitBadgeState>;
  preset_items: GlossaryPresetItem[];
  selected_entry_ids: GlossaryEntryId[];
  active_entry_id: GlossaryEntryId | null;
  selection_anchor_entry_id: GlossaryEntryId | null;
  restore_scroll_entry_id: GlossaryEntryId | null;
  preset_menu_open: boolean;
  dialog_state: GlossaryDialogState;
  confirm_state: QualityRuleConfirmState;
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
  update_dialog_draft: (patch: Partial<GlossaryEntryDraft>) => void;
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
  query_entry_source_from_hit: (entry_id: GlossaryEntryId) => Promise<void>;
  search_entry_relations_from_hit: (entry_id: GlossaryEntryId) => void;
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

/**
 * 聚合术语表页面的项目快照、筛选状态、统计缓存与唯一写入口。
 *
 * 页面组件只消费该 Hook 暴露的快照和意图，避免绕过项目写锁直接修改后端状态。
 */
export function useGlossaryPageState(): UseGlossaryPageStateResult {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const {
    project_snapshot,
    project_session_status = "ready",
    settings_snapshot,
    apply_settings_snapshot,
    commit_project_write,
  } = useDesktopState();
  const runtime_snapshot = useRuntimeSnapshot();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const handle_quality_rule_load_error = useCallback(
    (error: unknown): void => {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.load_failed")),
      );
    },
    [push_toast, t],
  );
  const { quality_slice, quality_loaded, refresh_quality_rule_snapshot } = useQualityRuleQuery({
    rule_type: "glossary",
    project_path: project_snapshot.loaded ? project_snapshot.path : "",
    session_ready: project_session_status === "ready",
    default_slice: DEFAULT_QUALITY_SLICE,
    normalize_slice: normalize_glossary_quality_slice,
    on_load_error: handle_quality_rule_load_error,
  });
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
  const [confirm_state, set_confirm_state] = useState<QualityRuleConfirmState>(() => {
    return create_empty_quality_rule_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<GlossaryPresetInputState>(() => {
    return create_empty_preset_input_state();
  });
  const dialog_state_ref = useRef(dialog_state);
  const entries_ref = useRef(entries);
  const statistics_cache = useQualityRuleStatistics("glossary");
  const hit_state = useMemo<GlossaryHitState>(() => {
    return build_glossary_hit_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const hit_ready = isQualityRuleStatisticsCacheReady(statistics_cache);
  const hit_sort_available = hit_ready || hit_state.entry_ids !== null;
  useEffect(() => {
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

  useEffect(() => {
    entries_ref.current = entries;
  }, [entries]);

  const entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return entries.map((entry) => entry.entry_id);
  }, [entries]);

  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]));
  }, [entry_ids]);

  const resolve_create_insert_after_entry_id = useCallback((): GlossaryEntryId | null => {
    return resolve_quality_rule_insert_after_entry_id(
      active_entry_id,
      selected_entry_ids,
      entry_index_by_id,
    );
  }, [active_entry_id, entry_index_by_id, selected_entry_ids]);
  const completed_hit_entry_id_set = useMemo<ReadonlySet<GlossaryEntryId>>(() => {
    return new Set(hit_state.entry_ids ?? []);
  }, [hit_state.entry_ids]);
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
        hit_sort_available,
        hit_state,
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
    [entries, entry_ids, hit_sort_available, hit_state],
  );
  const build_current_result_snapshot = useCallback(() => {
    return build_result_snapshot(filter_state, sort_state);
  }, [build_result_snapshot, filter_state, sort_state]);
  const has_active_filters = has_active_quality_rule_filters(filter_state);
  const {
    result_snapshot,
    set_result_snapshot,
    set_pending_result_refresh,
    reset_result_snapshot,
  } = useResultSnapshotState({
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
      hit_sort_available,
      hit_state,
    });
  }, [entries, entry_ids, filter_state, sort_state, hit_sort_available, hit_state]);
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
  const readonly = is_runtime_busy(runtime_snapshot);
  const drag_disabled = readonly || has_active_filters || has_active_sort; // 搜索过滤和逻辑排序都会打破“真实顺序即操作上下文”的前提，因此拖拽要一起禁用
  const hit_badge_by_entry_id = useMemo<Record<GlossaryEntryId, GlossaryHitBadgeState>>(() => {
    const next_badge_by_entry_id: Record<GlossaryEntryId, GlossaryHitBadgeState> = {};
    if (!hit_ready && hit_state.entry_ids === null) {
      return next_badge_by_entry_id;
    }

    entries.forEach((entry, index) => {
      const entry_id = entry_ids[index];
      if (entry_id === undefined) {
        return;
      }

      const kind = resolve_quality_rule_hit_badge_kind(
        entry_id,
        hit_state,
        completed_hit_entry_id_set,
      );
      if (kind === null) {
        return;
      }

      const hits = hit_state.hits_by_entry_id[entry_id] ?? 0;
      const subset_parents = hit_state.subset_parents_by_entry_id[entry_id] ?? [];

      next_badge_by_entry_id[entry_id] = {
        kind,
        hits,
        subset_parents,
        tooltip: build_hit_badge_tooltip(t, entry, hits, subset_parents),
      };
    });

    return next_badge_by_entry_id;
  }, [completed_hit_entry_id_set, entries, entry_ids, hit_ready, hit_state, t]);
  const clear_selection_state = table_ui_state.clear_selection_state;

  const save_entries_snapshot = useCallback(
    async (
      next_entries: GlossaryEntry[],
      result_refresh: ResultRefreshPolicy = PRESERVE_RESULT_REFRESH,
    ): Promise<boolean> => {
      if (readonly) {
        return false;
      }

      const normalized_entries = next_entries.map((entry) => normalize_dialog_entry(entry));

      try {
        await commit_project_write({
          operation: GLOSSARY_ENTRIES_SAVE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update", {
              rule_type: "glossary",
              expected_section_revisions: {
                quality: quality_slice.section_revision,
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
    [
      commit_project_write,
      push_toast,
      quality_slice.section_revision,
      readonly,
      refresh_quality_rule_snapshot,
      t,
    ],
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
        push_toast("success", t("app.feedback.import_success"));
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
      const current_entry_ids = current_entries.map((entry) => entry.entry_id);
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

  useQualityRuleTableSessionReset({
    project_identity: project_snapshot.loaded ? project_snapshot.path : "",
    reset_result_snapshot,
    reset_table_state,
  });
  useQualityRuleSelectionPruning({
    loaded: quality_loaded,
    selected_entry_ids,
    active_entry_id,
    selection_anchor_entry_id,
    valid_entry_ids: entry_index_by_id,
    visible_entry_ids: visible_entry_id_set,
    set_selection_state: set_table_selection_state,
  });

  const {
    update_filter_keyword,
    update_filter_scope,
    update_filter_regex,
    apply_table_sort_state,
  } = useQualityRuleResultControls({
    filter_state,
    sort_state,
    build_result_snapshot,
    set_result_snapshot,
    set_filter_state: set_table_filter_state,
    set_sort_state: set_table_sort_state,
    debounced_result_snapshot,
    resolve_sort_state: resolve_glossary_table_sort_state,
  });

  const search_entry_relations_from_hit = useCallback(
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
        await commit_project_write({
          operation: GLOSSARY_META_UPDATE_WRITE,
          run: async () => {
            return await api_fetch<ProjectWriteResultPayload>("/api/quality/rules/update", {
              rule_type: "glossary",
              expected_section_revisions: {
                quality: quality_slice.section_revision,
              },
              meta: {
                enabled: next_enabled,
              },
            });
          },
        });
        await refresh_quality_rule_snapshot();
        push_toast(
          "success",
          t(next_enabled ? "app.feedback.feature_enabled" : "app.feedback.feature_disabled", {
            TITLE: t("glossary_page.title"),
          }),
        );
      } catch (error) {
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("glossary_page.feedback.save_failed")),
        );
      }
    },
    [
      commit_project_write,
      push_toast,
      quality_slice.section_revision,
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
    [entries, entry_index_by_id, set_table_selection_state],
  );

  const update_dialog_draft = useCallback((patch: Partial<GlossaryEntryDraft>): void => {
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

      const next_entries = reorder_selected_quality_rule_entries(
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
      entry_id:
        dialog_state.draft_entry.entry_id ?? create_quality_rule_entry_id(new Set(entry_ids)),
    };

    if (normalized_entry.src === "") {
      push_toast("error", t("quality_rule_editor.feedback.source_required"));
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
    entry_ids,
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

  const query_entry_source_from_hit = useCallback(
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

        const imported_entries = await import_quality_rule_entries("glossary", path);
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

    const selected_path = await pick_quality_rule_import_path();
    if (selected_path === null) {
      return;
    }

    await import_entries_from_path(selected_path);
  }, [import_entries_from_path, readonly]);

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const exported = await export_quality_rule_entries({
        rule_type: "glossary",
        file_name: "glossary.json",
        entries: entries.map((entry) => {
          return normalize_dialog_entry(entry);
        }),
      });
      if (exported) {
        push_toast("success", t("app.feedback.export_success"));
      }
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
        push_toast("warning", t("preset_editor.feedback.name_required"));
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
        push_toast("success", t("preset_editor.feedback.saved"));
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
        push_toast("warning", t("preset_editor.feedback.name_required"));
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
        push_toast("success", t("preset_editor.feedback.renamed"));
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
        push_toast("success", t("preset_editor.feedback.default_set"));
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
      push_toast("success", t("preset_editor.feedback.default_cleared"));
    } catch (error) {
      push_toast(
        "error",
        resolve_visible_error_message(error, t, t("glossary_page.feedback.preset_failed")),
      );
    }
  }, [apply_settings_snapshot, push_toast, readonly, refresh_preset_menu, t]);

  const close_confirm_dialog = useCallback((): void => {
    set_confirm_state(create_empty_quality_rule_confirm_state());
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
      push_toast("warning", t("preset_editor.feedback.name_required"));
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
      push_toast("warning", t("preset_editor.feedback.exists"));
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
    push_toast("success", t("app.feedback.reset_success"));
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
          push_toast("success", t("preset_editor.feedback.deleted"));
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
      set_confirm_state(create_empty_quality_rule_confirm_state());
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
      hit_ready,
      hit_sort_available,
      hit_badge_by_entry_id,
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
      apply_table_selection: set_table_selection_state,
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
      query_entry_source_from_hit,
      search_entry_relations_from_hit,
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
    query_entry_source_from_hit,
    reorder_selected_entries,
    request_delete_preset,
    request_close_dialog,
    request_rename_preset,
    request_reset_entries,
    request_save_preset,
    readonly,
    restore_scroll_entry_id,
    save_dialog_entry,
    search_entry_relations_from_hit,
    selected_entry_ids,
    selection_anchor_entry_id,
    set_table_selection_state,
    set_default_preset,
    sort_state,
    hit_badge_by_entry_id,
    hit_sort_available,
    hit_ready,
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
