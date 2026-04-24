import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { api_fetch } from "@/app/desktop-api";
import { createProjectStoreReplaceSectionPatch } from "@/app/project/store/project-store";
import {
  getQualityRuleSlice,
  replaceQualityRuleSlice,
} from "@/app/project/quality/quality-runtime";
import {
  normalize_project_mutation_ack,
  type ProjectMutationAckPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n } from "@/i18n";
import { merge_glossary_entries } from "@/pages/glossary-page/merge";
import type { GlossaryEntry } from "@/pages/glossary-page/types";
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

type TranslateSinglePayload = {
  success?: boolean;
  status?: string;
  dst?: string;
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
    current_translating_row_id: null,
  };
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
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
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
  const [run_state, set_run_state] = useState<NameFieldRunState>(() => {
    return create_empty_run_state();
  });
  const run_active_ref = useRef(false);

  const clear_selection_state = useCallback((): void => {
    set_selected_row_ids([]);
    set_active_row_id(null);
    set_selection_anchor_row_id(null);
  }, []);

  const clear_local_state = useCallback((): void => {
    set_rows([]);
    set_filter_state(create_empty_filter_state());
    set_sort_state(create_empty_sort_state());
    clear_selection_state();
    set_dialog_state(create_empty_dialog_state());
    set_confirm_state(create_empty_confirm_state());
    set_run_state(create_empty_run_state());
    run_active_ref.current = false;
  }, [clear_selection_state]);

  useEffect(() => {
    clear_local_state();
  }, [clear_local_state, project_snapshot.loaded, project_snapshot.path]);

  const invalid_filter_message = useMemo(() => {
    return get_name_field_filter_error(filter_state);
  }, [filter_state]);

  const filtered_rows = useMemo(() => {
    return filter_name_field_rows({
      rows,
      filter_state,
      sort_state,
    });
  }, [filter_state, rows, sort_state]);

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
      current_translating_row_id: null,
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
    clear_selection_state,
    push_toast,
    t,
  ]);

  const update_filter_keyword = useCallback((next_keyword: string): void => {
    set_filter_state((previous_state) => {
      return {
        ...previous_state,
        keyword: next_keyword,
      };
    });
  }, []);

  const update_filter_scope = useCallback((next_scope: NameFieldFilterScope): void => {
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
      field: next_sort_state.column_id as NameFieldSortField,
      direction: next_sort_state.direction,
    });
  }, []);

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
      current_translating_row_id: null,
    });

    try {
      for (const row of target_rows) {
        set_run_state({
          extracting: false,
          translating: true,
          current_translating_row_id: row.id,
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
          if (error instanceof Error) {
            push_toast("error", error.message);
          }
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

  const import_to_glossary = useCallback(async (): Promise<void> => {
    if (is_running) {
      return;
    }

    const incoming_entries = build_name_field_glossary_entries(rows);
    if (incoming_entries.length === 0) {
      push_toast("warning", t("name_field_extraction_page.feedback.no_importable_entries"));
      return;
    }

    const current_glossary_slice = getQualityRuleSlice(
      project_store.getState().quality,
      "glossary",
    );
    const { merged_entries } = merge_glossary_entries(
      current_glossary_slice.entries as GlossaryEntry[],
      incoming_entries,
    );
    const normalized_entries = merged_entries.map(normalize_glossary_entry);
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
      source: "name_field_extraction_import_glossary",
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
      push_toast("success", t("name_field_extraction_page.feedback.import_success"));
    } catch (error) {
      local_commit.rollback();
      void refresh_project_runtime().catch(() => {});
      if (error instanceof Error) {
        push_toast("error", error.message);
      } else {
        push_toast("error", t("name_field_extraction_page.feedback.import_failed"));
      }
    }
  }, [
    align_project_runtime_ack,
    commit_local_project_patch,
    is_running,
    project_store,
    push_toast,
    refresh_project_runtime,
    rows,
    t,
  ]);

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
    confirm_pending_action,
    close_confirm_dialog,
  };
}
