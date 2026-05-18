import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop/desktop-api";
import { getQualityRuleSlice } from "@/project/quality/quality-runtime";
import {
  normalize_project_mutation_result,
  type ProjectMutationResultPayload,
} from "@/app/desktop/desktop-runtime-context";
import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
import { is_task_mutation_locked } from "@/project/tasks/task-lock";
import { useDesktopToast } from "@/app/ui-runtime/toast/use-desktop-toast";
import { resolve_visible_error_message } from "@/app/ui-runtime/error-message";
import { useI18n } from "@/app/locale/locale-provider";
import type { GlossaryEntry } from "@/pages/glossary-page/types";
import { useQualityRuleImportConfirmation } from "@/project/quality/quality-rule-import-confirmation";
import {
  build_name_field_glossary_entries,
  count_name_field_rows,
  delete_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
  get_name_field_filter_error,
  parse_name_field_translation_result,
  preserve_name_field_row_translations,
  resolve_name_field_status_from_dst,
  update_name_field_row_dst,
} from "@/pages/name-field-extraction-page/logic";
import type {
  NameFieldConfirmState,
  NameFieldDialogState,
  NameFieldFilterScope,
  NameFieldFilterState,
  NameFieldRow,
  NameFieldRowId,
  NameFieldRunState,
  NameFieldSortField,
  NameFieldSortState,
} from "@/pages/name-field-extraction-page/types";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import { QualityRuleImportRuleTypeValue } from "@shared/quality/importer";
import {
  create_result_view_snapshot,
  materialize_result_view_snapshot,
  prune_result_view_snapshot,
  type ResultViewSnapshot,
} from "@/pages/result-view-snapshot";
import { ensure_quality_rule_entry_ids } from "@/project/quality/quality-rule-entry-id";

type TranslateSinglePayload = {
  success?: boolean;
  dst?: string;
};

type NameFieldResultViewQuery = {
  filter_state: NameFieldFilterState;
  sort_state: NameFieldSortState;
};

const EMPTY_ROW: NameFieldRow = {
  id: "",
  src: "",
  dst: "",
  context: "",
  status: "untranslated",
};

function clone_row(row: NameFieldRow): NameFieldRow {
  return {
    id: row.id,
    src: row.src,
    dst: row.dst,
    context: row.context,
    status: row.status,
  };
}

function create_empty_filter_state(): NameFieldFilterState {
  return {
    keyword: "",
    scope: "all",
    is_regex: false,
  };
}

function create_empty_sort_state(): NameFieldSortState {
  return {
    field: null,
    direction: null,
  };
}

function create_empty_confirm_state(): NameFieldConfirmState {
  return {
    open: false,
    kind: null,
    submitting: false,
    selection_count: 0,
    target_row_ids: [],
  };
}

function create_empty_dialog_state(): NameFieldDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_row: clone_row(EMPTY_ROW),
    saving: false,
  };
}

function create_empty_run_state(): NameFieldRunState {
  return {
    extracting: false,
    translating: false,
  };
}

function is_name_field_sort_field(column_id: string): column_id is NameFieldSortField {
  return column_id === "src" || column_id === "dst";
}

function normalize_glossary_entry(entry: GlossaryEntry): GlossaryEntry {
  return {
    entry_id: entry.entry_id,
    src: String(entry.src ?? "").trim(),
    dst: String(entry.dst ?? "").trim(),
    info: String(entry.info ?? "").trim(),
    case_sensitive: Boolean(entry.case_sensitive),
  };
}

export function useNameFieldExtractionPageState() {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const {
    project_snapshot,
    project_store,
    refresh_project_runtime,
    apply_project_mutation_result,
    task_snapshot,
  } = useDesktopRuntime();
  const project_store_state = useSyncExternalStore(
    project_store.subscribe,
    project_store.getState,
    project_store.getState,
  );
  const [rows, set_rows] = useState<NameFieldRow[]>([]);
  const [filter_state, set_filter_state] = useState<NameFieldFilterState>(() => {
    return create_empty_filter_state();
  });
  const [sort_state, set_sort_state] = useState<NameFieldSortState>(() => {
    return create_empty_sort_state();
  });
  const [result_view_snapshot, set_result_view_snapshot] = useState<ResultViewSnapshot<
    NameFieldResultViewQuery,
    NameFieldRowId
  > | null>(null);
  const [selected_row_ids, set_selected_row_ids] = useState<NameFieldRowId[]>([]);
  const [active_row_id, set_active_row_id] = useState<NameFieldRowId | null>(null);
  const [selection_anchor_row_id, set_selection_anchor_row_id] = useState<NameFieldRowId | null>(
    null,
  );
  const [dialog_state, set_dialog_state] = useState<NameFieldDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [confirm_state, set_confirm_state] = useState<NameFieldConfirmState>(() => {
    return create_empty_confirm_state();
  });
  // 姓名字段导入术语表也走共享计划，避免绕过术语表页面的重复处理语义
  const [run_state, set_run_state] = useState<NameFieldRunState>(() => {
    return create_empty_run_state();
  });
  const run_active_ref = useRef(false);
  const glossary_import_locked = is_task_mutation_locked(task_snapshot);

  const clear_selection_state = useCallback((): void => {
    set_selected_row_ids([]);
    set_active_row_id(null);
    set_selection_anchor_row_id(null);
  }, []);

  const clear_local_state = useCallback((): void => {
    set_rows([]);
    set_filter_state(create_empty_filter_state());
    set_sort_state(create_empty_sort_state());
    set_result_view_snapshot(null);
    clear_selection_state();
    set_dialog_state(create_empty_dialog_state());
    set_confirm_state(create_empty_confirm_state());
    set_run_state(create_empty_run_state());
    run_active_ref.current = false;
  }, [clear_selection_state]);

  useEffect(() => {
    clear_local_state();
  }, [clear_local_state, project_snapshot.loaded, project_snapshot.path]);

  const build_result_view_snapshot = useCallback(
    (
      next_rows: NameFieldRow[],
      next_filter_state: NameFieldFilterState,
      next_sort_state: NameFieldSortState,
    ): ResultViewSnapshot<NameFieldResultViewQuery, NameFieldRowId> => {
      return create_result_view_snapshot({
        applied_query: {
          filter_state: next_filter_state,
          sort_state: next_sort_state,
        },
        ordered_ids: filter_name_field_rows({
          rows: next_rows,
          filter_state: next_filter_state,
          sort_state: next_sort_state,
        }).map((row) => row.id),
        invalid_message: get_name_field_filter_error(next_filter_state),
      });
    },
    [],
  );

  const invalid_filter_message = useMemo(() => {
    return result_view_snapshot?.invalid_message ?? get_name_field_filter_error(filter_state);
  }, [filter_state, result_view_snapshot]);

  const live_filtered_rows = useMemo(() => {
    return filter_name_field_rows({
      rows,
      filter_state,
      sort_state,
    });
  }, [filter_state, rows, sort_state]);

  const filtered_rows = useMemo(() => {
    if (result_view_snapshot === null) {
      return live_filtered_rows;
    }

    return materialize_result_view_snapshot({
      snapshot: result_view_snapshot,
      item_by_id: new Map(
        rows.map((row) => {
          return [row.id, row] as const;
        }),
      ),
    });
  }, [live_filtered_rows, result_view_snapshot, rows]);

  useEffect(() => {
    set_result_view_snapshot((previous_snapshot) => {
      const valid_row_id_set = new Set(rows.map((row) => row.id));
      if (previous_snapshot === null) {
        return build_result_view_snapshot(rows, filter_state, sort_state);
      }

      return prune_result_view_snapshot(previous_snapshot, valid_row_id_set);
    });
  }, [build_result_view_snapshot, filter_state, rows, sort_state]);

  const visible_row_ids = useMemo<NameFieldRowId[]>(() => {
    return filtered_rows.map((row) => row.id);
  }, [filtered_rows]);

  const visible_row_id_set = useMemo(() => {
    return new Set(visible_row_ids);
  }, [visible_row_ids]);

  const summary = useMemo(() => {
    return count_name_field_rows(rows);
  }, [rows]);
  const is_running = run_state.extracting || run_state.translating;

  useEffect(() => {
    set_selected_row_ids((previous_ids) => {
      return previous_ids.filter((row_id) => visible_row_id_set.has(row_id));
    });

    if (active_row_id !== null && !visible_row_id_set.has(active_row_id)) {
      set_active_row_id(null);
    }

    if (selection_anchor_row_id !== null && !visible_row_id_set.has(selection_anchor_row_id)) {
      set_selection_anchor_row_id(null);
    }
  }, [active_row_id, selection_anchor_row_id, visible_row_id_set]);

  const extract_rows = useCallback(async (): Promise<void> => {
    if (run_active_ref.current) {
      return;
    }

    if (!project_snapshot.loaded) {
      push_toast("warning", t("name_field_extraction_page.feedback.project_required"));
      return;
    }

    run_active_ref.current = true;
    set_run_state({
      extracting: true,
      translating: false,
    });

    try {
      await Promise.resolve();
      const glossary_slice = getQualityRuleSlice(project_store_state.quality, "glossary");
      const extracted_rows = extract_name_field_rows({
        items: project_store_state.items,
        glossary_entries: glossary_slice.entries,
      });
      const next_rows = preserve_name_field_row_translations({
        previous_rows: rows,
        extracted_rows,
      });
      set_rows(next_rows);
      set_result_view_snapshot(build_result_view_snapshot(next_rows, filter_state, sort_state));
      clear_selection_state();
      set_dialog_state(create_empty_dialog_state());
      push_toast(
        next_rows.length > 0 ? "success" : "warning",
        next_rows.length > 0
          ? t("name_field_extraction_page.feedback.extract_success").replace(
              "{COUNT}",
              next_rows.length.toString(),
            )
          : t("name_field_extraction_page.feedback.extract_empty"),
      );
    } finally {
      run_active_ref.current = false;
      set_run_state(create_empty_run_state());
    }
  }, [
    project_snapshot.loaded,
    project_store_state.items,
    project_store_state.quality,
    rows,
    build_result_view_snapshot,
    clear_selection_state,
    filter_state,
    push_toast,
    sort_state,
    t,
  ]);

  const update_filter_keyword = useCallback(
    (next_keyword: string): void => {
      const next_filter_state = {
        ...filter_state,
        keyword: next_keyword,
      };
      set_filter_state(next_filter_state);
      set_result_view_snapshot(build_result_view_snapshot(rows, next_filter_state, sort_state));
    },
    [build_result_view_snapshot, filter_state, rows, sort_state],
  );

  const update_filter_scope = useCallback(
    (next_scope: NameFieldFilterScope): void => {
      const next_filter_state = {
        ...filter_state,
        scope: next_scope,
      };
      set_filter_state(next_filter_state);
      set_result_view_snapshot(build_result_view_snapshot(rows, next_filter_state, sort_state));
    },
    [build_result_view_snapshot, filter_state, rows, sort_state],
  );

  const update_filter_regex = useCallback(
    (next_is_regex: boolean): void => {
      const next_filter_state = {
        ...filter_state,
        is_regex: next_is_regex,
      };
      set_filter_state(next_filter_state);
      set_result_view_snapshot(build_result_view_snapshot(rows, next_filter_state, sort_state));
    },
    [build_result_view_snapshot, filter_state, rows, sort_state],
  );

  const apply_table_sort_state = useCallback(
    (next_sort_state: AppTableSortState | null): void => {
      const next_name_field_sort_state =
        next_sort_state === null || !is_name_field_sort_field(next_sort_state.column_id)
          ? create_empty_sort_state()
          : {
              field: next_sort_state.column_id,
              direction: next_sort_state.direction,
            };
      if (next_sort_state === null) {
        set_sort_state(next_name_field_sort_state);
        set_result_view_snapshot(
          build_result_view_snapshot(rows, filter_state, next_name_field_sort_state),
        );
        return;
      }

      if (!is_name_field_sort_field(next_sort_state.column_id)) {
        set_sort_state(next_name_field_sort_state);
        set_result_view_snapshot(
          build_result_view_snapshot(rows, filter_state, next_name_field_sort_state),
        );
        return;
      }

      set_sort_state(next_name_field_sort_state);
      set_result_view_snapshot(
        build_result_view_snapshot(rows, filter_state, next_name_field_sort_state),
      );
    },
    [build_result_view_snapshot, filter_state, rows],
  );

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_row_ids(payload.selected_row_ids);
    set_active_row_id(payload.active_row_id);
    set_selection_anchor_row_id(payload.anchor_row_id);
  }, []);

  const update_row_dst = useCallback((row_id: string, dst: string): void => {
    set_rows((previous_rows) => update_name_field_row_dst(previous_rows, row_id, dst));
  }, []);

  const open_edit_dialog = useCallback(
    (row_id: NameFieldRowId): void => {
      const target_row = rows.find((row) => row.id === row_id);
      if (target_row === undefined) {
        return;
      }

      set_dialog_state({
        open: true,
        target_row_id: row_id,
        draft_row: clone_row(target_row),
        saving: false,
      });
    },
    [rows],
  );

  const update_dialog_draft = useCallback((patch: Partial<NameFieldRow>): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        draft_row: {
          ...previous_state.draft_row,
          ...patch,
        },
      };
    });
  }, []);

  const save_dialog_row = useCallback(async (): Promise<void> => {
    if (!dialog_state.open) {
      return;
    }

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        saving: true,
      };
    });
    update_row_dst(dialog_state.target_row_id, dialog_state.draft_row.dst);
    set_dialog_state(create_empty_dialog_state());
    push_toast("success", t("app.feedback.save_success"));
  }, [dialog_state, push_toast, t, update_row_dst]);

  const request_close_dialog = useCallback(async (): Promise<void> => {
    set_dialog_state(create_empty_dialog_state());
  }, []);

  const translate_rows = useCallback(async (): Promise<void> => {
    if (run_active_ref.current) {
      return;
    }

    const target_rows = rows.filter((row) => row.dst.trim() === "");
    if (target_rows.length === 0) {
      push_toast("warning", t("name_field_extraction_page.feedback.no_pending_translation"));
      return;
    }

    run_active_ref.current = true;
    set_run_state({
      extracting: false,
      translating: true,
    });

    try {
      for (const row of target_rows) {
        set_run_state({
          extracting: false,
          translating: true,
        });
        set_rows((previous_rows) => {
          return previous_rows.map((current_row) => {
            return current_row.id === row.id
              ? {
                  ...current_row,
                  status: "translating",
                }
              : current_row;
          });
        });

        try {
          const payload = await api_fetch<TranslateSinglePayload>("/api/tasks/translate-single", {
            text: `【${row.src}】\n${row.context}`,
          });

          if (payload.success !== true) {
            set_rows((previous_rows) => {
              return previous_rows.map((current_row) => {
                return current_row.id === row.id
                  ? {
                      ...current_row,
                      status: "network-error",
                    }
                  : current_row;
              });
            });
            continue;
          }

          const parsed_result = parse_name_field_translation_result(String(payload.dst ?? ""));
          set_rows((previous_rows) => {
            return previous_rows.map((current_row) => {
              return current_row.id === row.id
                ? {
                    ...current_row,
                    dst: parsed_result.dst,
                    status: parsed_result.status,
                  }
                : current_row;
            });
          });
        } catch (error) {
          set_rows((previous_rows) => {
            return previous_rows.map((current_row) => {
              return current_row.id === row.id
                ? {
                    ...current_row,
                    status: "network-error",
                  }
                : current_row;
            });
          });
          push_toast(
            "error",
            resolve_visible_error_message(
              error,
              t,
              t("name_field_extraction_page.feedback.translate_failed"),
            ),
          );
        }
      }
    } finally {
      run_active_ref.current = false;
      set_run_state(create_empty_run_state());
      set_rows((previous_rows) => {
        return previous_rows.map((row) => {
          return row.status === "translating"
            ? {
                ...row,
                status: resolve_name_field_status_from_dst(row.dst),
              }
            : row;
        });
      });
    }
  }, [push_toast, rows, t]);

  const request_delete_selected_rows = useCallback((): void => {
    if (is_running) {
      return;
    }

    const existing_row_ids = selected_row_ids.filter((row_id) => {
      return rows.some((row) => row.id === row_id);
    });
    if (existing_row_ids.length === 0) {
      return;
    }

    set_confirm_state({
      open: true,
      kind: "delete-selection",
      submitting: false,
      selection_count: existing_row_ids.length,
      target_row_ids: existing_row_ids,
    });
  }, [is_running, rows, selected_row_ids]);

  const close_confirm_dialog = useCallback((): void => {
    if (!confirm_state.submitting) {
      set_confirm_state(create_empty_confirm_state());
    }
  }, [confirm_state.submitting]);

  const apply_glossary_import_entries = useCallback(
    async (next_entries: GlossaryEntry[]): Promise<boolean> => {
      const current_state = project_store.getState();
      const normalized_entries = ensure_quality_rule_entry_ids(
        next_entries.map(normalize_glossary_entry),
      );
      try {
        const mutation_result = normalize_project_mutation_result(
          await api_fetch<ProjectMutationResultPayload>("/api/quality/rules/save-entries", {
            rule_type: "glossary",
            expected_section_revisions: {
              quality: current_state.revisions.sections.quality ?? 0,
            },
            entries: normalized_entries,
          }),
        );
        await apply_project_mutation_result(mutation_result);
        push_toast("success", t("name_field_extraction_page.feedback.import_success"));
        return true;
      } catch (error) {
        void refresh_project_runtime().catch(() => {});
        push_toast(
          "error",
          resolve_visible_error_message(
            error,
            t,
            t("name_field_extraction_page.feedback.import_failed"),
          ),
        );
        return false;
      }
    },
    [apply_project_mutation_result, project_store, push_toast, refresh_project_runtime, t],
  );

  const get_import_existing_entries = useCallback((): GlossaryEntry[] => {
    const current_glossary_slice = getQualityRuleSlice(
      project_store.getState().quality,
      "glossary",
    );
    return current_glossary_slice.entries as GlossaryEntry[];
  }, [project_store]);
  const apply_import_entries = useCallback(
    async (next_entries: GlossaryEntry[]): Promise<boolean> => {
      if (is_running || glossary_import_locked) {
        return false;
      }
      return await apply_glossary_import_entries(next_entries);
    },
    [apply_glossary_import_entries, glossary_import_locked, is_running],
  );
  const {
    import_confirm_state,
    persist_import_entries,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
    reset_import_confirmation,
  } = useQualityRuleImportConfirmation<GlossaryEntry>({
    rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
    get_existing_entries: get_import_existing_entries,
    apply_entries: apply_import_entries,
  });

  useEffect(() => {
    reset_import_confirmation();
  }, [project_snapshot.loaded, project_snapshot.path, reset_import_confirmation]);

  const import_to_glossary = useCallback(async (): Promise<void> => {
    if (is_running || glossary_import_locked) {
      return;
    }

    const incoming_entries = build_name_field_glossary_entries(rows);
    if (incoming_entries.length === 0) {
      push_toast("warning", t("name_field_extraction_page.feedback.no_importable_entries"));
      return;
    }

    await persist_import_entries(incoming_entries, { close_preset_menu: false });
  }, [glossary_import_locked, is_running, persist_import_entries, push_toast, rows, t]);

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

    const target_row_ids = confirm_state.target_row_ids;
    if (target_row_ids.length > 0) {
      const target_row_id_set = new Set(target_row_ids);
      set_rows((previous_rows) => delete_name_field_rows(previous_rows, target_row_ids));
      set_selected_row_ids((previous_ids) => {
        return previous_ids.filter((row_id) => !target_row_id_set.has(row_id));
      });
      set_active_row_id((previous_id) => {
        return previous_id !== null && target_row_id_set.has(previous_id) ? null : previous_id;
      });
      set_selection_anchor_row_id((previous_id) => {
        return previous_id !== null && target_row_id_set.has(previous_id) ? null : previous_id;
      });
      set_dialog_state((previous_state) => {
        return previous_state.open && target_row_id_set.has(previous_state.target_row_id)
          ? create_empty_dialog_state()
          : previous_state;
      });
    }
    set_confirm_state(create_empty_confirm_state());
  }, [confirm_state]);

  return {
    rows,
    filtered_rows,
    summary,
    filter_state,
    sort_state,
    selected_row_ids,
    active_row_id,
    selection_anchor_row_id,
    dialog_state,
    confirm_state,
    import_confirm_state,
    invalid_filter_message,
    update_filter_keyword,
    update_filter_scope,
    update_filter_regex,
    apply_table_sort_state,
    apply_table_selection,
    open_edit_dialog,
    update_dialog_draft,
    save_dialog_row,
    request_close_dialog,
    extract_rows,
    translate_rows,
    request_delete_selected_rows,
    import_to_glossary,
    run_state,
    is_running,
    glossary_import_locked,
    confirm_pending_action,
    close_confirm_dialog,
    import_duplicate_skip,
    import_duplicate_overwrite,
    close_import_duplicate_confirm,
  };
}
