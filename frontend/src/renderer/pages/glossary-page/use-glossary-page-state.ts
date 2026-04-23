import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop-api";
import { useAppNavigation } from "@/app/navigation/navigation-context";
import { createProjectStoreReplaceSectionPatch } from "@/app/project-runtime/project-store";
import type { QualityStatisticsDependencySnapshot } from "@/app/project-runtime/quality-statistics-auto";
import {
  buildProofreadingLookupQuery,
  getQualityRuleSlice,
  replaceQualityRuleSlice,
} from "@/app/project-runtime/quality-runtime";
import type { QualityStatisticsCacheSnapshot } from "@/app/project-runtime/quality-statistics-store";
import {
  normalize_project_mutation_ack,
  normalize_settings_snapshot,
  type ProjectMutationAckPayload,
  type SettingsSnapshotPayload,
} from "@/app/state/desktop-runtime-context";
import { useQualityStatistics } from "@/app/state/quality-statistics-context";
import { useDesktopRuntime } from "@/app/state/use-desktop-runtime";
import { useDesktopToast } from "@/app/state/use-desktop-toast";
import { useI18n, type LocaleKey } from "@/i18n";
import {
  build_glossary_filter_result,
  has_active_glossary_filters,
  resolve_glossary_statistics_badge_kind,
} from "@/pages/glossary-page/filtering";
import { merge_glossary_entries } from "@/pages/glossary-page/merge";
import {
  are_glossary_entry_ids_equal,
  build_glossary_entry_id,
  collect_range_selection,
  reorder_selected_group,
} from "@/pages/glossary-page/components/glossary-selection";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
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
} from "@/pages/glossary-page/types";

type GlossarySnapshot = {
  revision: number;
  meta: {
    enabled?: boolean;
  };
  entries: GlossaryEntry[];
};

type GlossaryPresetPayload = {
  builtin_presets: GlossaryPresetItem[];
  user_presets: GlossaryPresetItem[];
};

const EMPTY_ENTRY: GlossaryEntry = {
  src: "",
  dst: "",
  info: "",
  case_sensitive: false,
};

function clone_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src,
    dst: entry.dst,
    info: entry.info,
    case_sensitive: entry.case_sensitive,
  };
}

function create_empty_filter_state(): GlossaryFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

function create_empty_sort_state(): GlossarySortState {
  return {
    field: null,
    direction: null,
  };
}

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

function create_empty_preset_input_state(): GlossaryPresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

function normalize_dialog_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: entry.src.trim(),
    dst: entry.dst.trim(),
    info: entry.info.trim(),
    case_sensitive: entry.case_sensitive,
  };
}

function build_user_preset_virtual_id(name: string): string {
  return `user:${name}.json`;
}

function normalize_preset_name(name: string): string {
  return name.trim();
}

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

function build_glossary_statistics_state_from_cache(
  statistics_cache: QualityStatisticsCacheSnapshot,
): GlossaryStatisticsState {
  return {
    running: statistics_cache.running,
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
  has_active_filters: boolean;
  invalid_filter_message: string | null;
  drag_disabled: boolean;
  statistics_state: GlossaryStatisticsState;
  statistics_ready: boolean;
  statistics_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState>;
  preset_items: GlossaryPresetItem[];
  selected_entry_ids: GlossaryEntryId[];
  active_entry_id: GlossaryEntryId | null;
  selection_anchor_entry_id: GlossaryEntryId | null;
  preset_menu_open: boolean;
  dialog_state: GlossaryDialogState;
  confirm_state: GlossaryConfirmState;
  preset_input_state: GlossaryPresetInputState;
  update_filter_keyword: (next_keyword: string) => void;
  update_filter_scope: (next_scope: GlossaryFilterScope) => void;
  update_filter_regex: (next_is_regex: boolean) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  clear_all_filters: () => void;
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
  select_entry: (entry_id: GlossaryEntryId, options: { extend: boolean; range: boolean }) => void;
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
    project_store,
    settings_snapshot,
    set_settings_snapshot,
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
  } = useDesktopRuntime();
  const { navigate_to_route, push_proofreading_lookup_intent } = useAppNavigation();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const [revision, set_revision] = useState(0);
  const [enabled, set_enabled] = useState(true);
  const [entries, set_entries] = useState<GlossaryEntry[]>([]);
  const [preset_items, set_preset_items] = useState<GlossaryPresetItem[]>([]);
  const [selected_entry_ids, set_selected_entry_ids] = useState<GlossaryEntryId[]>([]);
  const [active_entry_id, set_active_entry_id] = useState<GlossaryEntryId | null>(null);
  const [selection_anchor_entry_id, set_selection_anchor_entry_id] =
    useState<GlossaryEntryId | null>(null);
  const [preset_menu_open, set_preset_menu_open] = useState(false);
  const [filter_state, set_filter_state] = useState<GlossaryFilterState>(() => {
    return create_empty_filter_state();
  });
  const [sort_state, set_sort_state] = useState<GlossarySortState>(() => {
    return create_empty_sort_state();
  });
  const [dialog_state, set_dialog_state] = useState<GlossaryDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [confirm_state, set_confirm_state] = useState<GlossaryConfirmState>(() => {
    return create_empty_confirm_state();
  });
  const [preset_input_state, set_preset_input_state] = useState<GlossaryPresetInputState>(() => {
    return create_empty_preset_input_state();
  });
  const revision_ref = useRef(revision);
  const dialog_state_ref = useRef(dialog_state);
  const statistics_cache = useQualityStatistics("glossary");
  const statistics_state = useMemo<GlossaryStatisticsState>(() => {
    return build_glossary_statistics_state_from_cache(statistics_cache);
  }, [statistics_cache]);
  const statistics_ready = statistics_cache.ready;

  useEffect(() => {
    revision_ref.current = revision;
  }, [revision]);

  useEffect(() => {
    dialog_state_ref.current = dialog_state;
  }, [dialog_state]);

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
  const { visible_entries: filtered_entries, invalid_regex_message } = useMemo(() => {
    return build_glossary_filter_result({
      entries,
      entry_ids,
      filter_state,
      sort_state,
      statistics_ready,
      statistics_state,
      completed_statistics_entry_id_set,
    });
  }, [
    completed_statistics_entry_id_set,
    entries,
    entry_ids,
    filter_state,
    sort_state,
    statistics_ready,
    statistics_state,
  ]);
  const visible_entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return filtered_entries.map((item) => item.entry_id);
  }, [filtered_entries]);
  const visible_entry_id_set = useMemo(() => {
    return new Set(visible_entry_ids);
  }, [visible_entry_ids]);
  const has_active_filters = has_active_glossary_filters(filter_state);
  const has_active_sort = sort_state.field !== null;
  // 搜索过滤和逻辑排序都会打破“真实顺序即操作上下文”的前提，因此拖拽要一起禁用。
  const drag_disabled = has_active_filters || has_active_sort;
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
  const apply_snapshot = useCallback((snapshot: GlossarySnapshot): void => {
    set_revision(snapshot.revision);
    set_enabled(snapshot.meta.enabled ?? true);
    set_entries(snapshot.entries.map((entry) => clone_entry(entry)));
  }, []);

  const clear_selection_state = useCallback((): void => {
    // 规则导入、预设应用和重置都会重排/折叠条目，先清空选区能避免旧 id 误绑到新行。
    set_selected_entry_ids([]);
    set_active_entry_id(null);
    set_selection_anchor_entry_id(null);
  }, []);

  const apply_store_snapshot = useCallback((): void => {
    const glossary_slice = getQualityRuleSlice(project_store_state.quality, "glossary");
    apply_snapshot({
      revision: glossary_slice.revision,
      meta: {
        enabled: glossary_slice.enabled,
      },
      entries: glossary_slice.entries as GlossaryEntry[],
    });
  }, [apply_snapshot, project_store_state.quality]);

  const save_entries_snapshot = useCallback(
    async (next_entries: GlossaryEntry[]): Promise<boolean> => {
      const current_glossary_slice = getQualityRuleSlice(
        project_store.getState().quality,
        "glossary",
      );
      const normalized_entries = next_entries.map((entry) => {
        return normalize_dialog_entry(entry);
      });
      const next_quality_state = replaceQualityRuleSlice(
        project_store.getState().quality,
        "glossary",
        {
          ...current_glossary_slice,
          entries: normalized_entries,
          revision: current_glossary_slice.revision + 1,
        },
      );
      const local_commit = commit_local_project_patch({
        source: "quality_rule_save_entries",
        updatedSections: ["quality"],
        patch: [createProjectStoreReplaceSectionPatch("quality", next_quality_state)],
      });

      try {
        const mutation_ack = normalize_project_mutation_ack(
          await api_fetch<ProjectMutationAckPayload>("/api/quality/rules/save-entries", {
            rule_type: "glossary",
            expected_revision: current_glossary_slice.revision,
            entries: normalized_entries,
          }),
        );
        align_project_runtime_ack(mutation_ack);
        return true;
      } catch (error) {
        local_commit.rollback();
        void refresh_project_runtime().catch(() => {});
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.save_failed"));
        }
        return false;
      }
    },
    [
      align_project_runtime_ack,
      commit_local_project_patch,
      project_store,
      push_toast,
      refresh_project_runtime,
      t,
    ],
  );

  const persist_merged_entries = useCallback(
    async (
      incoming_entries: GlossaryEntry[],
      options: {
        close_preset_menu: boolean;
      },
    ): Promise<boolean> => {
      const { merged_entries, report } = merge_glossary_entries(entries, incoming_entries);
      const saved = await save_entries_snapshot(merged_entries);
      if (!saved) {
        return false;
      }

      clear_selection_state();
      push_toast("success", t("glossary_page.feedback.import_success"));

      if (report.updated > 0 || report.deduped > 0) {
        push_toast("warning", t("glossary_page.feedback.merge_warning"));
      }

      if (options.close_preset_menu) {
        set_preset_menu_open(false);
      }

      return true;
    },
    [clear_selection_state, entries, push_toast, save_entries_snapshot, t],
  );

  const refresh_preset_menu = useCallback(async (): Promise<void> => {
    const preset_payload = await api_fetch<GlossaryPresetPayload>("/api/quality/rules/presets", {
      preset_dir_name: "glossary",
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
    if (!project_snapshot.loaded) {
      apply_snapshot({
        revision: 0,
        meta: {
          enabled: true,
        },
        entries: [],
      });
      return;
    }

    apply_store_snapshot();
  }, [apply_snapshot, apply_store_snapshot, project_snapshot.loaded, project_snapshot.path]);

  useEffect(() => {
    if (statistics_ready || sort_state.field !== "statistics") {
      return;
    }

    // 统计结果一旦失效，就不能继续挂着旧统计排序，否则会出现“按钮禁用但顺序还在偷偷生效”的假象。
    set_sort_state(create_empty_sort_state());
  }, [sort_state.field, statistics_ready]);

  useEffect(() => {
    // 筛选视图是当前页面的真实操作上下文，选中集必须与可见结果保持一致。
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

  const update_filter_keyword = useCallback((next_keyword: string): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        keyword: next_keyword,
      };
    });
  }, []);

  const update_filter_scope = useCallback((next_scope: GlossaryFilterScope): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        scope: next_scope,
      };
    });
  }, []);

  const update_filter_regex = useCallback((next_is_regex: boolean): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        is_regex: next_is_regex,
      };
    });
  }, []);

  const apply_table_sort_state = useCallback((next_sort_state: AppTableSortState | null): void => {
    if (next_sort_state === null) {
      set_sort_state(create_empty_sort_state());
      return;
    }

    set_sort_state({
      field: next_sort_state.column_id as GlossarySortField,
      direction: next_sort_state.direction,
    });
  }, []);

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_entry_ids((previous_ids) => {
      return are_glossary_entry_ids_equal(previous_ids, payload.selected_row_ids)
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

  const clear_all_filters = useCallback((): void => {
    set_filter_state(create_empty_filter_state());
  }, []);

  const search_entry_relations_from_statistics = useCallback(
    (entry_id: GlossaryEntryId): void => {
      const target_index = entry_index_by_id.get(entry_id);
      const target_entry = target_index === undefined ? null : entries[target_index];
      if (target_entry === null || target_entry === undefined) {
        return;
      }

      // 统计入口要把用户带回一条可解释的筛选路径，而不是偷偷叠加更多隐式条件。
      set_filter_state({
        keyword: target_entry.src,
        scope: "src",
        is_regex: false,
      });
    },
    [entries, entry_index_by_id],
  );

  const update_enabled = useCallback(
    async (next_enabled: boolean): Promise<void> => {
      const current_glossary_slice = getQualityRuleSlice(
        project_store.getState().quality,
        "glossary",
      );
      const next_quality_state = replaceQualityRuleSlice(
        project_store.getState().quality,
        "glossary",
        {
          ...current_glossary_slice,
          enabled: next_enabled,
          revision: current_glossary_slice.revision + 1,
        },
      );
      const local_commit = commit_local_project_patch({
        source: "quality_rule_meta",
        updatedSections: ["quality"],
        patch: [createProjectStoreReplaceSectionPatch("quality", next_quality_state)],
      });

      try {
        const mutation_ack = normalize_project_mutation_ack(
          await api_fetch<ProjectMutationAckPayload>("/api/quality/rules/update-meta", {
            rule_type: "glossary",
            expected_revision: current_glossary_slice.revision,
            meta: {
              enabled: next_enabled,
            },
          }),
        );
        align_project_runtime_ack(mutation_ack);
      } catch (error) {
        local_commit.rollback();
        void refresh_project_runtime().catch(() => {});
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.save_failed"));
        }
      }
    },
    [
      align_project_runtime_ack,
      commit_local_project_patch,
      project_store,
      push_toast,
      refresh_project_runtime,
      t,
    ],
  );

  const open_create_dialog = useCallback((): void => {
    const insert_after_entry_id = resolve_create_insert_after_entry_id();

    // 新增态不再继承当前选中上下文，避免动作条删除与创建语义冲突。
    set_selected_entry_ids([]);
    set_active_entry_id(null);
    set_selection_anchor_entry_id(null);
    set_dialog_state({
      open: true,
      mode: "create",
      target_entry_id: null,
      insert_after_entry_id,
      draft_entry: clone_entry(EMPTY_ENTRY),
      dirty: false,
      saving: false,
    });
  }, [resolve_create_insert_after_entry_id]);

  const open_edit_dialog = useCallback(
    (entry_id: GlossaryEntryId): void => {
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
        dirty: false,
        saving: false,
      });
    },
    [entries, entry_index_by_id],
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

  const select_entry = useCallback(
    (entry_id: GlossaryEntryId, options: { extend: boolean; range: boolean }): void => {
      set_active_entry_id(entry_id);

      if (options.range) {
        set_selected_entry_ids(
          collect_range_selection(visible_entry_ids, selection_anchor_entry_id, entry_id),
        );
        return;
      }

      if (options.extend) {
        set_selected_entry_ids((previous_ids) => {
          return previous_ids.includes(entry_id)
            ? previous_ids.filter((current_id) => current_id !== entry_id)
            : [...previous_ids, entry_id];
        });
        set_selection_anchor_entry_id(entry_id);
        return;
      }

      set_selected_entry_ids([entry_id]);
      set_selection_anchor_entry_id(entry_id);
    },
    [selection_anchor_entry_id, visible_entry_ids],
  );

  const delete_selected_entries = useCallback(async (): Promise<void> => {
    if (selected_entry_ids.length === 0) {
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
  }, [selected_entry_ids]);

  const commit_delete_selected_entries = useCallback(async (): Promise<boolean> => {
    if (selected_entry_ids.length === 0) {
      return true;
    }

    const selected_set = new Set(selected_entry_ids);
    const previous_entries = entries;
    const previous_selected_entry_ids = selected_entry_ids;
    const previous_active_entry_id = active_entry_id;
    const previous_anchor_entry_id = selection_anchor_entry_id;
    const next_entries = entries.filter((_entry, index) => {
      return !selected_set.has(entry_ids[index] ?? "");
    });

    set_entries(next_entries);
    clear_selection_state();

    const saved = await save_entries_snapshot(next_entries);
    if (!saved) {
      set_entries(previous_entries);
      set_selected_entry_ids(previous_selected_entry_ids);
      set_active_entry_id(previous_active_entry_id);
      set_selection_anchor_entry_id(previous_anchor_entry_id);
      return false;
    }

    return true;
  }, [
    active_entry_id,
    clear_selection_state,
    entries,
    entry_ids,
    save_entries_snapshot,
    selected_entry_ids,
    selection_anchor_entry_id,
  ]);

  const toggle_case_sensitive_for_selected = useCallback(
    async (next_value: boolean): Promise<void> => {
      if (selected_entry_ids.length === 0) {
        return;
      }

      const selected_set = new Set(selected_entry_ids);
      const previous_entries = entries;
      const next_entries = entries.map((entry, index) => {
        if (!selected_set.has(entry_ids[index] ?? "")) {
          return entry;
        }

        return {
          ...entry,
          case_sensitive: next_value,
        };
      });

      set_entries(next_entries);
      const saved = await save_entries_snapshot(next_entries);
      if (!saved) {
        set_entries(previous_entries);
      }
    },
    [entries, entry_ids, save_entries_snapshot, selected_entry_ids],
  );

  const reorder_selected_entries = useCallback(
    async (
      current_active_entry_id: GlossaryEntryId,
      over_entry_id: GlossaryEntryId,
    ): Promise<void> => {
      if (current_active_entry_id === over_entry_id) {
        return;
      }

      const previous_entries = entries;
      const next_entries = reorder_selected_group(
        entries,
        entry_ids,
        selected_entry_ids,
        current_active_entry_id,
        over_entry_id,
      );

      set_entries(next_entries);
      const saved = await save_entries_snapshot(next_entries);
      if (!saved) {
        set_entries(previous_entries);
      }
    },
    [entries, entry_ids, save_entries_snapshot, selected_entry_ids],
  );

  const persist_dialog_entry = useCallback(async (): Promise<boolean> => {
    const current_dialog_state = dialog_state;
    const normalized_entry = normalize_dialog_entry(dialog_state.draft_entry);

    if (normalized_entry.src === "") {
      push_toast("error", t("glossary_page.feedback.source_required"));
      return false;
    }

    set_dialog_state((previous_state) => ({
      ...previous_state,
      saving: true,
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
            const next_entries = [...entries];

            next_entries.splice(insert_index, 0, normalized_entry);
            return next_entries;
          })()
        : entries.map((entry, index) => {
            return entry_ids[index] === dialog_state.target_entry_id
              ? {
                  ...entry,
                  ...normalized_entry,
                }
              : entry;
          });

    const reopen_dialog_state: GlossaryDialogState = {
      ...current_dialog_state,
      saving: false,
    };
    set_dialog_state(create_empty_dialog_state());

    const saved = await save_entries_snapshot(next_entries);
    if (saved) {
      push_toast("success", t("app.feedback.save_success"));
      return true;
    }

    if (!dialog_state_ref.current.open) {
      set_dialog_state(reopen_dialog_state);
    }
    return false;
  }, [dialog_state, entries, entry_ids, push_toast, save_entries_snapshot, t]);

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
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.query_failed"));
        }
      }
    },
    [entries, entry_index_by_id, navigate_to_route, push_proofreading_lookup_intent, push_toast, t],
  );

  const import_entries_from_path = useCallback(
    async (path: string): Promise<void> => {
      try {
        if (path.trim() === "") {
          return;
        }

        const payload = await api_fetch<{ entries?: GlossaryEntry[] }>(
          "/api/quality/rules/import",
          {
            rule_type: "glossary",
            expected_revision: revision_ref.current,
            path,
          },
        );
        const imported_entries = Array.isArray(payload.entries) ? payload.entries : [];
        if (imported_entries.length === 0) {
          push_toast("warning", t("app.feedback.no_valid_data"));
          return;
        }

        await persist_merged_entries(imported_entries, { close_preset_menu: false });
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.import_failed"));
        }
      }
    },
    [persist_merged_entries, push_toast, t],
  );

  const import_entries_from_picker = useCallback(async (): Promise<void> => {
    const pick_result = await window.desktopApp.pickGlossaryImportFilePath();
    if (pick_result.canceled || pick_result.path === null) {
      return;
    }

    await import_entries_from_path(pick_result.path);
  }, [import_entries_from_path]);

  const export_entries_from_picker = useCallback(async (): Promise<void> => {
    try {
      const pick_result = await window.desktopApp.pickGlossaryExportPath("glossary.json");
      if (pick_result.canceled || pick_result.path === null) {
        return;
      }

      await api_fetch("/api/quality/rules/export", {
        rule_type: "glossary",
        path: pick_result.path,
        entries: entries.map((entry) => {
          return normalize_dialog_entry(entry);
        }),
      });
      push_toast("success", t("glossary_page.feedback.export_success"));
    } catch (error) {
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("glossary_page.feedback.export_failed"));
      }
    }
  }, [entries, push_toast, t]);

  const open_preset_menu = useCallback(async (): Promise<void> => {
    try {
      await refresh_preset_menu();
      set_preset_menu_open(true);
    } catch (error) {
      set_preset_menu_open(false);
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("glossary_page.feedback.preset_failed"));
      }
    }
  }, [push_toast, refresh_preset_menu, t]);

  const apply_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      try {
        const payload = await api_fetch<{ entries: GlossaryEntry[] }>(
          "/api/quality/rules/presets/read",
          {
            preset_dir_name: "glossary",
            virtual_id,
          },
        );
        await persist_merged_entries(payload.entries, { close_preset_menu: true });
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.preset_failed"));
        }
      }
    },
    [persist_merged_entries, push_toast, t],
  );

  const request_reset_entries = useCallback((): void => {
    set_confirm_state({
      open: true,
      kind: "reset",
      selection_count: 0,
      preset_name: "",
      preset_input_value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, []);

  const request_save_preset = useCallback((): void => {
    set_preset_input_state({
      open: true,
      mode: "save",
      value: "",
      submitting: false,
      target_virtual_id: null,
    });
  }, []);

  const request_rename_preset = useCallback((preset_item: GlossaryPresetItem): void => {
    set_preset_input_state({
      open: true,
      mode: "rename",
      value: preset_item.name,
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    });
  }, []);

  const request_delete_preset = useCallback((preset_item: GlossaryPresetItem): void => {
    set_confirm_state({
      open: true,
      kind: "delete-preset",
      selection_count: 0,
      preset_name: preset_item.name,
      preset_input_value: "",
      submitting: false,
      target_virtual_id: preset_item.virtual_id,
    });
  }, []);

  const save_preset = useCallback(
    async (name: string): Promise<boolean> => {
      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("glossary_page.feedback.preset_name_required"));
        return false;
      }

      try {
        await api_fetch("/api/quality/rules/presets/save", {
          preset_dir_name: "glossary",
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
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.preset_failed"));
        }
        return false;
      }
    },
    [entries, push_toast, refresh_preset_menu, t],
  );

  const rename_preset = useCallback(
    async (virtual_id: string, name: string): Promise<boolean> => {
      const normalized_name = normalize_preset_name(name);
      if (normalized_name === "") {
        push_toast("warning", t("glossary_page.feedback.preset_name_required"));
        return false;
      }

      try {
        const payload = await api_fetch<{ item?: GlossaryPresetItem }>(
          "/api/quality/rules/presets/rename",
          {
            preset_dir_name: "glossary",
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
          set_settings_snapshot(normalize_settings_snapshot(settings_payload));
        }
        await refresh_preset_menu();
        push_toast("success", t("glossary_page.feedback.preset_renamed"));
        return true;
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.preset_failed"));
        }
        return false;
      }
    },
    [preset_items, push_toast, refresh_preset_menu, set_settings_snapshot, t],
  );

  const set_default_preset = useCallback(
    async (virtual_id: string): Promise<void> => {
      try {
        const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
          glossary_default_preset: virtual_id,
        });
        set_settings_snapshot(normalize_settings_snapshot(payload));
        await refresh_preset_menu();
        push_toast("success", t("glossary_page.feedback.default_preset_set"));
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.preset_failed"));
        }
      }
    },
    [push_toast, refresh_preset_menu, set_settings_snapshot, t],
  );

  const cancel_default_preset = useCallback(async (): Promise<void> => {
    try {
      const payload = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
        glossary_default_preset: "",
      });
      set_settings_snapshot(normalize_settings_snapshot(payload));
      await refresh_preset_menu();
      push_toast("success", t("glossary_page.feedback.default_preset_cleared"));
    } catch (error) {
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("glossary_page.feedback.preset_failed"));
      }
    }
  }, [push_toast, refresh_preset_menu, set_settings_snapshot, t]);

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
    if (!preset_input_state.open || preset_input_state.mode === null) {
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
  }, [preset_input_state, preset_items, push_toast, rename_preset, save_preset, t]);

  const reset_entries = useCallback(async (): Promise<boolean> => {
    const saved = await save_entries_snapshot([]);
    if (!saved) {
      return false;
    }

    clear_selection_state();
    push_toast("success", t("glossary_page.feedback.reset_success"));
    set_preset_menu_open(false);
    return true;
  }, [clear_selection_state, push_toast, save_entries_snapshot, t]);

  const confirm_pending_action = useCallback(async (): Promise<void> => {
    if (!confirm_state.open || confirm_state.kind === null) {
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
            preset_dir_name: "glossary",
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
            set_settings_snapshot(normalize_settings_snapshot(settings_payload));
          }
          await refresh_preset_menu();
          push_toast("success", t("glossary_page.feedback.preset_deleted"));
          succeeded = true;
        }
      } catch (error) {
        if (error instanceof Error) {
          push_toast("error", error.message);
        } else {
          push_toast("error", t("glossary_page.feedback.preset_failed"));
        }
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
    save_preset,
    set_settings_snapshot,
    t,
  ]);

  return useMemo<UseGlossaryPageStateResult>(() => {
    return {
      enabled,
      filtered_entries,
      filter_state,
      sort_state,
      has_active_filters,
      invalid_filter_message: invalid_regex_message,
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
      preset_input_state,
      update_filter_keyword,
      update_filter_scope,
      update_filter_regex,
      apply_table_sort_state,
      apply_table_selection,
      clear_all_filters,
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
      select_entry,
      delete_selected_entries,
      toggle_case_sensitive_for_selected,
      reorder_selected_entries,
      query_entry_source_from_statistics,
      search_entry_relations_from_statistics,
      save_dialog_entry,
      request_close_dialog,
      confirm_pending_action,
      close_confirm_dialog,
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
    clear_all_filters,
    close_confirm_dialog,
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
    has_active_filters,
    import_entries_from_path,
    import_entries_from_picker,
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
    save_dialog_entry,
    search_entry_relations_from_statistics,
    select_entry,
    selected_entry_ids,
    selection_anchor_entry_id,
    set_default_preset,
    sort_state,
    statistics_badge_by_entry_id,
    statistics_ready,
    statistics_state,
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
