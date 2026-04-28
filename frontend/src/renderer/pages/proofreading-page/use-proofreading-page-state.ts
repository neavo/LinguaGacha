import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api_fetch } from "@/app/desktop-api";
import { useAppNavigation } from "@/app/navigation/navigation-context";
import type { ProjectStoreState } from "@/app/project/store/project-store";
import {
  normalize_project_mutation_ack,
  type ProjectMutationAckPayload,
} from "@/app/runtime/desktop/desktop-runtime-context";
import { useDesktopRuntime } from "@/app/runtime/desktop/use-desktop-runtime";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n } from "@/i18n";
import { is_worker_client_error } from "@/lib/worker-client-error";
import {
  create_replace_all_plan,
  create_reset_items_plan,
  create_save_item_plan,
  type ProofreadingMutationPlan,
} from "@/pages/proofreading-page/proofreading-mutation-planner";
import { createProofreadingRuntimeClient } from "@/pages/proofreading-page/proofreading-runtime-client";
import type {
  ProofreadingListWindow,
  ProofreadingRuntimeDeltaInput,
  ProofreadingRuntimeHydrationInput,
  ProofreadingRuntimeItemRecord,
  ProofreadingRuntimeSyncState,
} from "@/pages/proofreading-page/proofreading-runtime-engine";
import type {
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import {
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  normalize_proofreading_mutation_payload,
  type ProofreadingClientItem,
  type ProofreadingDialogState,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingMutationPayload,
  type ProofreadingPendingMutation,
  type ProofreadingSearchScope,
  type ProofreadingVisibleItem,
} from "@/pages/proofreading-page/types";

const PROOFREADING_WINDOW_FETCH_COUNT = 160;

export type UseProofreadingPageStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  cache_stale: boolean;
  last_loaded_at: number | null;
  refresh_request_id: number;
  settled_project_path: string;
  is_refreshing: boolean;
  is_mutating: boolean;
  readonly: boolean;
  search_keyword: string;
  replace_text: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
  invalid_regex_message: string | null;
  current_filters: ProofreadingFilterOptions;
  filter_dialog_filters: ProofreadingFilterOptions;
  filter_panel: ReturnType<typeof create_empty_proofreading_filter_panel_state>;
  filter_panel_loading: boolean;
  visible_items: ProofreadingVisibleItem[];
  visible_row_count: number;
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  filter_dialog_open: boolean;
  dialog_state: ProofreadingDialogState;
  dialog_item: ProofreadingItem | null;
  pending_mutation: ProofreadingPendingMutation | null;
  refresh_snapshot: () => Promise<void>;
  update_search_keyword: (next_keyword: string) => void;
  update_replace_text: (next_replace_text: string) => void;
  update_search_scope: (next_scope: ProofreadingSearchScope) => void;
  update_regex: (next_is_regex: boolean) => void;
  apply_table_selection: (payload: AppTableSelectionChange) => void;
  apply_table_sort_state: (next_sort_state: AppTableSortState | null) => void;
  get_visible_row_at_index: (index: number) => ProofreadingVisibleItem | undefined;
  get_visible_row_id_at_index: (index: number) => string | undefined;
  resolve_visible_row_index: (row_id: string) => number | undefined;
  read_visible_range: (range: { start: number; count: number }) => void;
  open_filter_dialog: () => void;
  close_filter_dialog: () => void;
  update_filter_dialog_filters: (next_filters: ProofreadingFilterOptions) => void;
  confirm_filter_dialog_filters: () => Promise<void>;
  open_edit_dialog: (row_id: string) => void;
  request_close_dialog: () => void;
  update_dialog_draft: (next_draft_dst: string) => void;
  save_dialog_entry: () => Promise<void>;
  replace_next_visible_match: () => Promise<void>;
  replace_all_visible_matches: () => Promise<void>;
  request_retranslate_row_ids: (row_ids: string[]) => void;
  request_reset_row_ids: (row_ids: string[]) => void;
  confirm_pending_mutation: () => Promise<void>;
  close_pending_mutation: () => void;
};

function create_empty_filter_options(): ProofreadingFilterOptions {
  return {
    warning_types: [],
    statuses: [],
    file_paths: [],
    glossary_terms: [],
    include_without_glossary_miss: true,
  };
}

function create_empty_dialog_state(): ProofreadingDialogState {
  return {
    open: false,
    target_row_id: null,
    draft_dst: "",
    saving: false,
  };
}

function escape_regular_expression(source_text: string): string {
  return source_text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return fallback_message;
}

function serialize_glossary_terms(glossary_terms: ProofreadingGlossaryTerm[]): string[][] {
  return glossary_terms.map((term) => [term[0], term[1]]);
}

function serialize_item(item: ProofreadingItem): Record<string, unknown> {
  return {
    // 为什么：校对接口落到 core 时会反序列化成 `Item`，这里必须传标准字段名，避免被误判成新条目。
    id: item.item_id,
    file_path: item.file_path,
    row: item.row_number,
    src: item.src,
    dst: item.dst,
    status: item.status,
    warnings: [...item.warnings],
    failed_glossary_terms: serialize_glossary_terms(item.failed_glossary_terms),
  };
}

function create_search_pattern(keyword: string, is_regex: boolean): RegExp | null {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return null;
  }

  if (is_regex) {
    return new RegExp(normalized_keyword, "iu");
  }

  return new RegExp(escape_regular_expression(normalized_keyword), "iu");
}

function matches_search_pattern(
  text: string,
  search_pattern: RegExp | null,
  keyword: string,
  is_regex: boolean,
): boolean {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return true;
  }

  if (search_pattern === null) {
    return true;
  }

  if (is_regex) {
    return search_pattern.test(text);
  }

  return text.toLocaleLowerCase().includes(normalized_keyword.toLocaleLowerCase());
}

function replace_first_visible_match(
  text: string,
  search_pattern: RegExp,
  replacement: string,
): { text: string; replaced: boolean } {
  const replaced_text = text.replace(search_pattern, replacement);
  return {
    text: replaced_text,
    replaced: replaced_text !== text,
  };
}

function build_filter_signature(filters: ProofreadingFilterOptions): string {
  return JSON.stringify({
    warning_types: [...filters.warning_types].sort(),
    statuses: [...filters.statuses].sort(),
    file_paths: [...filters.file_paths].sort(),
    glossary_terms: serialize_glossary_terms(filters.glossary_terms).sort(
      (left_term, right_term) => {
        return left_term.join("→").localeCompare(right_term.join("→"), "zh-Hans-CN");
      },
    ),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  });
}

function build_sort_signature(sort_state: AppTableSortState | null): string {
  return sort_state === null ? "null" : `${sort_state.column_id}:${sort_state.direction}`;
}

type ProofreadingFilterValueKeyResolver<T> = (value: T) => string;

function create_filter_value_key_set<T>(
  values: T[],
  resolve_key: ProofreadingFilterValueKeyResolver<T>,
): Set<string> {
  return new Set(values.map((value) => resolve_key(value)));
}

function are_filter_value_key_sets_equal(left_keys: Set<string>, right_keys: Set<string>): boolean {
  if (left_keys.size !== right_keys.size) {
    return false;
  }

  for (const key of left_keys) {
    if (!right_keys.has(key)) {
      return false;
    }
  }

  return true;
}

function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`;
}

function clone_glossary_term(term: ProofreadingGlossaryTerm): ProofreadingGlossaryTerm {
  return [term[0], term[1]] as const;
}

function reconcile_filter_dimension<T>(args: {
  previous_applied: T[];
  previous_default: T[];
  next_default: T[];
  resolve_key: ProofreadingFilterValueKeyResolver<T>;
  clone_value: (value: T) => T;
}): T[] {
  const previous_applied_keys = create_filter_value_key_set(
    args.previous_applied,
    args.resolve_key,
  );
  const previous_default_keys = create_filter_value_key_set(
    args.previous_default,
    args.resolve_key,
  );

  if (are_filter_value_key_sets_equal(previous_applied_keys, previous_default_keys)) {
    return args.next_default.map((value) => args.clone_value(value));
  }

  const next_default_by_key = new Map(
    args.next_default.map((value) => {
      return [args.resolve_key(value), value] as const;
    }),
  );

  const reconciled_values: T[] = [];
  for (const value of args.previous_applied) {
    const next_value = next_default_by_key.get(args.resolve_key(value));
    if (next_value !== undefined) {
      reconciled_values.push(args.clone_value(next_value));
    }
  }

  return reconciled_values;
}

function reconcile_proofreading_filter_options(args: {
  previous_applied: ProofreadingFilterOptions;
  previous_default: ProofreadingFilterOptions;
  next_default: ProofreadingFilterOptions;
}): ProofreadingFilterOptions {
  return {
    warning_types: reconcile_filter_dimension({
      previous_applied: args.previous_applied.warning_types,
      previous_default: args.previous_default.warning_types,
      next_default: args.next_default.warning_types,
      resolve_key: (value) => value,
      clone_value: (value) => value,
    }),
    statuses: reconcile_filter_dimension({
      previous_applied: args.previous_applied.statuses,
      previous_default: args.previous_default.statuses,
      next_default: args.next_default.statuses,
      resolve_key: (value) => value,
      clone_value: (value) => value,
    }),
    file_paths: reconcile_filter_dimension({
      previous_applied: args.previous_applied.file_paths,
      previous_default: args.previous_default.file_paths,
      next_default: args.next_default.file_paths,
      resolve_key: (value) => value,
      clone_value: (value) => value,
    }),
    glossary_terms: reconcile_filter_dimension({
      previous_applied: args.previous_applied.glossary_terms,
      previous_default: args.previous_default.glossary_terms,
      next_default: args.next_default.glossary_terms,
      resolve_key: build_glossary_term_key,
      clone_value: clone_glossary_term,
    }),
    include_without_glossary_miss:
      args.previous_applied.include_without_glossary_miss ===
      args.previous_default.include_without_glossary_miss
        ? args.next_default.include_without_glossary_miss
        : args.previous_applied.include_without_glossary_miss,
  };
}

function normalize_runtime_item_from_state(record: unknown): ProofreadingRuntimeItemRecord | null {
  if (typeof record !== "object" || record === null) {
    return null;
  }

  const candidate = record as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id)) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    status: String(candidate.status ?? ""),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

function collect_full_sync_input(args: {
  state: ProjectStoreState;
  source_language: string;
}): ProofreadingRuntimeHydrationInput {
  return {
    project_id: args.state.project.path,
    revision: Number(args.state.proofreading.revision ?? 0),
    total_item_count: Object.keys(args.state.items).length,
    items: Object.values(args.state.items).flatMap((record) => {
      const normalized_item = normalize_runtime_item_from_state(record);
      return normalized_item === null ? [] : [normalized_item];
    }),
    quality: args.state.quality,
    source_language: args.source_language,
  };
}

function collect_delta_sync_input(args: {
  state: ProjectStoreState;
  item_ids: Array<number | string>;
}): ProofreadingRuntimeDeltaInput {
  const items = args.item_ids.flatMap((item_id) => {
    const item_record = args.state.items[String(item_id)];
    const normalized_item = normalize_runtime_item_from_state(item_record);
    return normalized_item === null ? [] : [normalized_item];
  });

  return {
    project_id: args.state.project.path,
    revision: Number(args.state.proofreading.revision ?? 0),
    total_item_count: Object.keys(args.state.items).length,
    items,
  };
}

function build_list_query_signature(args: {
  revision: number;
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
}): string {
  return JSON.stringify({
    revision: args.revision,
    filters: build_filter_signature(args.filters),
    keyword: args.keyword,
    scope: args.scope,
    is_regex: args.is_regex,
    sort: build_sort_signature(args.sort_state),
  });
}

function build_filter_panel_signature(args: {
  revision: number;
  filters: ProofreadingFilterOptions;
}): string {
  return JSON.stringify({
    revision: args.revision,
    filters: build_filter_signature(args.filters),
  });
}

function resolve_requested_sync_mode(args: {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  runtime_sync_state: ProofreadingRuntimeSyncState | null;
  project_path: string;
  signal_mode: "full" | "delta" | "noop";
}): "full" | "delta" | "noop" {
  if (
    args.cache_status === "error" ||
    args.runtime_sync_state === null ||
    args.runtime_sync_state.project_id !== args.project_path
  ) {
    return "full";
  }

  return args.signal_mode;
}

export function useProofreadingPageState(): UseProofreadingPageStateResult {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const { proofreading_lookup_intent, clear_proofreading_lookup_intent } = useAppNavigation();
  const {
    settings_snapshot,
    project_snapshot,
    project_store,
    task_snapshot,
    proofreading_change_signal,
    commit_local_project_patch,
    refresh_project_runtime,
    align_project_runtime_ack,
  } = useDesktopRuntime();
  const [list_view, set_list_view] = useState(() => create_empty_proofreading_list_view());
  const [current_filters, set_current_filters] = useState<ProofreadingFilterOptions>(() => {
    return create_empty_filter_options();
  });
  const [filter_dialog_filters, set_filter_dialog_filters] = useState<ProofreadingFilterOptions>(
    () => {
      return create_empty_filter_options();
    },
  );
  const [filter_panel, set_filter_panel] = useState(() => {
    return create_empty_proofreading_filter_panel_state();
  });
  const [filter_panel_loading, set_filter_panel_loading] = useState(false);
  const [is_refreshing, set_is_refreshing] = useState(false);
  const [cache_status, set_cache_status] = useState<"idle" | "refreshing" | "ready" | "error">(
    "idle",
  );
  const [cache_stale, set_cache_stale] = useState(false);
  const [last_loaded_at, set_last_loaded_at] = useState<number | null>(null);
  const [refresh_request_id, set_refresh_request_id] = useState(0);
  const [settled_project_path, set_settled_project_path] = useState("");
  const [is_mutating, set_is_mutating] = useState(false);
  const [search_keyword, set_search_keyword] = useState("");
  const [replace_text, set_replace_text] = useState("");
  const [search_scope, set_search_scope] = useState<ProofreadingSearchScope>("all");
  const [is_regex, set_is_regex] = useState(false);
  const [sort_state, set_sort_state] = useState<AppTableSortState | null>(null);
  const [selected_row_ids, set_selected_row_ids] = useState<string[]>([]);
  const [active_row_id, set_active_row_id] = useState<string | null>(null);
  const [anchor_row_id, set_anchor_row_id] = useState<string | null>(null);
  const [filter_dialog_open, set_filter_dialog_open] = useState(false);
  const [dialog_state, set_dialog_state] = useState<ProofreadingDialogState>(() => {
    return create_empty_dialog_state();
  });
  const [pending_mutation, set_pending_mutation] = useState<ProofreadingPendingMutation | null>(
    null,
  );
  const deferred_search_keyword = useDeferredValue(search_keyword);
  const deferred_search_scope = useDeferredValue(search_scope);
  const deferred_is_regex = useDeferredValue(is_regex);
  const deferred_sort_state = useDeferredValue(sort_state);
  const refresh_request_id_ref = useRef(0);
  const list_view_request_id_ref = useRef(0);
  const list_window_request_id_ref = useRef(0);
  const filter_panel_request_id_ref = useRef(0);
  const current_filters_ref = useRef(current_filters);
  const filter_dialog_filters_ref = useRef(filter_dialog_filters);
  const runtime_sync_state_ref = useRef<ProofreadingRuntimeSyncState | null>(null);
  const default_filters_ref = useRef(create_empty_filter_options());
  const proofreading_runtime_client_ref = useRef(createProofreadingRuntimeClient());
  const preferred_row_id_ref = useRef<string | null>(null);
  const should_select_first_visible_ref = useRef(false);
  const replace_cursor_ref = useRef(0);
  const pending_replace_cursor_ref = useRef<number | null>(null);
  const selected_row_ids_ref = useRef<string[]>(selected_row_ids);
  const active_row_id_ref = useRef<string | null>(active_row_id);
  const anchor_row_id_ref = useRef<string | null>(anchor_row_id);
  const pending_reset_filters_ref = useRef(false);
  const previous_project_loaded_ref = useRef(false);
  const previous_project_path_ref = useRef("");
  const previous_proofreading_change_seq_ref = useRef(proofreading_change_signal.seq);
  const search_keyword_ref = useRef(search_keyword);
  const search_scope_ref = useRef(search_scope);
  const is_regex_ref = useRef(is_regex);
  const sort_state_ref = useRef(sort_state);
  const last_list_query_signature_ref = useRef("");
  const last_filter_panel_signature_ref = useRef("");
  const last_visible_range_signature_ref = useRef("");
  const [dialog_item_snapshot, set_dialog_item_snapshot] = useState<ProofreadingItem | null>(null);

  useEffect(() => {
    const proofreading_runtime_client = proofreading_runtime_client_ref.current;
    return () => {
      proofreading_runtime_client.dispose();
    };
  }, []);

  useEffect(() => {
    current_filters_ref.current = current_filters;
  }, [current_filters]);

  useEffect(() => {
    filter_dialog_filters_ref.current = filter_dialog_filters;
  }, [filter_dialog_filters]);

  useEffect(() => {
    selected_row_ids_ref.current = selected_row_ids;
  }, [selected_row_ids]);

  useEffect(() => {
    active_row_id_ref.current = active_row_id;
  }, [active_row_id]);

  useEffect(() => {
    anchor_row_id_ref.current = anchor_row_id;
  }, [anchor_row_id]);

  useEffect(() => {
    search_keyword_ref.current = search_keyword;
  }, [search_keyword]);

  useEffect(() => {
    search_scope_ref.current = search_scope;
  }, [search_scope]);

  useEffect(() => {
    is_regex_ref.current = is_regex;
  }, [is_regex]);

  useEffect(() => {
    sort_state_ref.current = sort_state;
  }, [sort_state]);

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
  const dialog_item =
    dialog_state.target_row_id === null
      ? null
      : (visible_item_by_id.get(dialog_state.target_row_id) ?? dialog_item_snapshot);
  const readonly = task_snapshot.busy;
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
      const message = resolve_error_message(error, fallback_message);
      push_toast("error", message);
    },
    [push_toast],
  );

  const clear_transient_state_for_new_project = useCallback((): void => {
    set_current_filters(create_empty_filter_options());
    set_filter_dialog_filters(create_empty_filter_options());
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_cache_stale(false);
    set_last_loaded_at(null);
    set_refresh_request_id(0);
    set_settled_project_path("");
    set_search_keyword("");
    set_replace_text("");
    set_search_scope("all");
    set_is_regex(false);
    set_sort_state(null);
    set_selected_row_ids([]);
    set_active_row_id(null);
    set_anchor_row_id(null);
    set_filter_dialog_open(false);
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
    set_pending_mutation(null);
    replace_cursor_ref.current = 0;
    pending_replace_cursor_ref.current = null;
    preferred_row_id_ref.current = null;
    should_select_first_visible_ref.current = false;
    pending_reset_filters_ref.current = false;
    last_list_query_signature_ref.current = "";
    last_filter_panel_signature_ref.current = "";
    last_visible_range_signature_ref.current = "";
  }, []);

  const clear_cache_state = useCallback((): void => {
    const current_project_id = runtime_sync_state_ref.current?.project_id;
    runtime_sync_state_ref.current = null;
    default_filters_ref.current = create_empty_filter_options();
    set_list_view(create_empty_proofreading_list_view());
    set_filter_panel(create_empty_proofreading_filter_panel_state());
    set_filter_panel_loading(false);
    set_is_refreshing(false);
    set_cache_status("idle");
    set_is_mutating(false);
    last_visible_range_signature_ref.current = "";
    if (current_project_id !== undefined) {
      void proofreading_runtime_client_ref.current.dispose_project(current_project_id);
    }
  }, []);

  const run_list_view_query = useCallback(
    async (
      args: {
        filters: ProofreadingFilterOptions;
        keyword: string;
        scope: ProofreadingSearchScope;
        is_regex: boolean;
        sort_state: AppTableSortState | null;
      },
      options?: {
        force?: boolean;
      },
    ) => {
      const runtime_sync_state = runtime_sync_state_ref.current;
      if (runtime_sync_state === null) {
        return null;
      }

      const query_signature = build_list_query_signature({
        revision: runtime_sync_state.revision,
        filters: args.filters,
        keyword: args.keyword,
        scope: args.scope,
        is_regex: args.is_regex,
        sort_state: args.sort_state,
      });
      if (!options?.force && query_signature === last_list_query_signature_ref.current) {
        return list_view;
      }

      list_view_request_id_ref.current += 1;
      const request_id = list_view_request_id_ref.current;
      const next_list_view = await proofreading_runtime_client_ref.current.build_list_view({
        filters: args.filters,
        keyword: args.keyword,
        scope: args.scope,
        is_regex: args.is_regex,
        sort_state: args.sort_state,
        window_start: 0,
        window_count: PROOFREADING_WINDOW_FETCH_COUNT,
      });
      if (request_id !== list_view_request_id_ref.current) {
        return null;
      }

      last_list_query_signature_ref.current = query_signature;
      startTransition(() => {
        set_list_view(next_list_view);
      });
      return next_list_view;
    },
    [list_view],
  );

  const run_filter_panel_query = useCallback(
    async (
      filters: ProofreadingFilterOptions,
      options?: {
        force?: boolean;
        mark_loading?: boolean;
      },
    ) => {
      const runtime_sync_state = runtime_sync_state_ref.current;
      if (runtime_sync_state === null) {
        return null;
      }

      const query_signature = build_filter_panel_signature({
        revision: runtime_sync_state.revision,
        filters,
      });
      if (!options?.force && query_signature === last_filter_panel_signature_ref.current) {
        return filter_panel;
      }

      filter_panel_request_id_ref.current += 1;
      const request_id = filter_panel_request_id_ref.current;
      if (options?.mark_loading !== false) {
        set_filter_panel_loading(true);
      }

      try {
        const next_filter_panel = await proofreading_runtime_client_ref.current.build_filter_panel({
          filters,
        });
        if (request_id !== filter_panel_request_id_ref.current) {
          return null;
        }

        last_filter_panel_signature_ref.current = query_signature;
        startTransition(() => {
          set_filter_panel(next_filter_panel);
        });
        return next_filter_panel;
      } finally {
        if (request_id === filter_panel_request_id_ref.current) {
          set_filter_panel_loading(false);
        }
      }
    },
    [filter_panel],
  );

  const read_list_window = useCallback(
    async (range: { start: number; count: number }): Promise<ProofreadingListWindow | null> => {
      if (list_view.view_id === "" || range.count <= 0) {
        return null;
      }

      const request_start = Math.max(0, range.start - PROOFREADING_WINDOW_FETCH_COUNT);
      const request_count = Math.min(
        list_view.row_count - request_start,
        range.count + PROOFREADING_WINDOW_FETCH_COUNT * 2,
      );
      const range_signature = `${list_view.view_id}:${request_start}:${request_count}`;
      if (range_signature === last_visible_range_signature_ref.current) {
        return null;
      }

      last_visible_range_signature_ref.current = range_signature;
      list_window_request_id_ref.current += 1;
      const request_id = list_window_request_id_ref.current;
      const next_window = await proofreading_runtime_client_ref.current.read_list_window({
        view_id: list_view.view_id,
        start: request_start,
        count: request_count,
      });
      if (request_id !== list_window_request_id_ref.current) {
        return null;
      }

      if (next_window.view_id !== list_view.view_id) {
        return null;
      }

      startTransition(() => {
        set_list_view((previous_view) => {
          if (previous_view.view_id !== next_window.view_id) {
            return previous_view;
          }

          return {
            ...previous_view,
            window_start: next_window.start,
            window_rows: next_window.rows,
          };
        });
      });
      return next_window;
    },
    [list_view.row_count, list_view.view_id],
  );

  const settle_list_view_and_filter_panel = useCallback(
    async (args: {
      filters: ProofreadingFilterOptions;
      keyword: string;
      scope: ProofreadingSearchScope;
      is_regex: boolean;
      sort_state: AppTableSortState | null;
      force?: boolean;
    }) => {
      const [next_list_view, next_filter_panel] = await Promise.all([
        run_list_view_query(
          {
            filters: args.filters,
            keyword: args.keyword,
            scope: args.scope,
            is_regex: args.is_regex,
            sort_state: args.sort_state,
          },
          {
            force: args.force,
          },
        ),
        run_filter_panel_query(args.filters, {
          force: args.force,
          mark_loading: false,
        }),
      ]);

      return next_list_view !== null && next_filter_panel !== null;
    },
    [run_filter_panel_query, run_list_view_query],
  );

  const read_items_by_row_ids = useCallback(
    async (row_ids: string[]): Promise<ProofreadingClientItem[]> => {
      if (row_ids.length === 0) {
        return [];
      }

      const items_by_row_id = new Map(
        visible_items.map((visible_item) => {
          return [visible_item.row_id, visible_item.item] as const;
        }),
      );
      const missing_row_ids = row_ids.filter((row_id) => {
        return !items_by_row_id.has(row_id);
      });
      if (missing_row_ids.length > 0) {
        const fetched_items = await proofreading_runtime_client_ref.current.read_items_by_row_ids({
          row_ids: missing_row_ids,
        });
        fetched_items.forEach((item) => {
          items_by_row_id.set(item.row_id, item);
        });
      }

      return row_ids.flatMap((row_id) => {
        const item = items_by_row_id.get(row_id);
        return item === undefined ? [] : [item];
      });
    },
    [visible_items],
  );

  const read_current_view_row_ids = useCallback(
    async (start: number, count: number): Promise<string[]> => {
      if (list_view.view_id === "" || count <= 0) {
        return [];
      }

      return await proofreading_runtime_client_ref.current.read_row_ids_range({
        view_id: list_view.view_id,
        start,
        count,
      });
    },
    [list_view.view_id],
  );

  const refresh_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_transient_state_for_new_project();
      clear_cache_state();
      return;
    }

    const request_id = refresh_request_id_ref.current + 1;
    refresh_request_id_ref.current = request_id;
    set_refresh_request_id(request_id);
    set_is_refreshing(true);
    set_cache_status("refreshing");

    try {
      const current_state = project_store.getState();
      const sync_mode = resolve_requested_sync_mode({
        cache_status,
        runtime_sync_state: runtime_sync_state_ref.current,
        project_path: project_snapshot.path,
        signal_mode: proofreading_change_signal.mode,
      });
      let runtime_sync_state = runtime_sync_state_ref.current;
      if (sync_mode === "noop") {
        if (request_id !== refresh_request_id_ref.current || runtime_sync_state === null) {
          return;
        }

        set_cache_status("ready");
        set_cache_stale(false);
        set_is_refreshing(false);
        set_last_loaded_at(Date.now());
        set_settled_project_path(project_snapshot.path);
        return;
      }

      if (sync_mode === "full") {
        runtime_sync_state = await proofreading_runtime_client_ref.current.hydrate_full(
          collect_full_sync_input({
            state: current_state,
            source_language: settings_snapshot.source_language,
          }),
        );
      } else if (sync_mode === "delta") {
        runtime_sync_state = await proofreading_runtime_client_ref.current.apply_item_delta(
          collect_delta_sync_input({
            state: current_state,
            item_ids: proofreading_change_signal.item_ids,
          }),
        );
      }

      if (request_id !== refresh_request_id_ref.current || runtime_sync_state === null) {
        return;
      }

      const next_default_filters = clone_proofreading_filter_options(
        runtime_sync_state.default_filters,
      );
      const next_current_filters = pending_reset_filters_ref.current
        ? clone_proofreading_filter_options(next_default_filters)
        : reconcile_proofreading_filter_options({
            previous_applied: current_filters_ref.current,
            previous_default: default_filters_ref.current,
            next_default: next_default_filters,
          });

      runtime_sync_state_ref.current = runtime_sync_state;
      default_filters_ref.current = clone_proofreading_filter_options(next_default_filters);
      set_current_filters(clone_proofreading_filter_options(next_current_filters));
      set_filter_dialog_filters(clone_proofreading_filter_options(next_current_filters));

      const settled = await settle_list_view_and_filter_panel({
        filters: next_current_filters,
        keyword: search_keyword_ref.current,
        scope: search_scope_ref.current,
        is_regex: is_regex_ref.current,
        sort_state: sort_state_ref.current,
        force: true,
      });
      if (!settled || request_id !== refresh_request_id_ref.current) {
        return;
      }

      preferred_row_id_ref.current = active_row_id_ref.current;
      set_cache_status("ready");
      set_cache_stale(false);
      set_last_loaded_at(Date.now());
      set_settled_project_path(project_snapshot.path);
    } catch (error) {
      if (request_id !== refresh_request_id_ref.current) {
        return;
      }

      const fallback_message = t("proofreading_page.feedback.refresh_failed");
      const message = is_worker_client_error(error)
        ? fallback_message
        : resolve_error_message(error, fallback_message);
      set_cache_status("error");
      set_cache_stale(true);
      set_settled_project_path(project_snapshot.path);
      push_toast("error", message);
    } finally {
      pending_reset_filters_ref.current = false;
      if (request_id === refresh_request_id_ref.current) {
        set_is_refreshing(false);
      }
    }
  }, [
    cache_status,
    clear_cache_state,
    clear_transient_state_for_new_project,
    project_snapshot.loaded,
    project_snapshot.path,
    project_store,
    proofreading_change_signal.item_ids,
    proofreading_change_signal.mode,
    push_toast,
    settings_snapshot.source_language,
    settle_list_view_and_filter_panel,
    t,
  ]);

  const run_ack_only_mutation = useCallback(
    async (args: {
      path: string;
      source: string;
      plan: ProofreadingMutationPlan | null;
      fallback_error_key:
        | "proofreading_page.feedback.save_failed"
        | "proofreading_page.feedback.replace_failed"
        | "proofreading_page.feedback.reset_failed";
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

      if (args.pending_replace_cursor !== undefined) {
        pending_replace_cursor_ref.current = args.pending_replace_cursor;
      }
      preferred_row_id_ref.current = args.preferred_row_id ?? active_row_id_ref.current;

      set_is_mutating(true);
      const local_commit = commit_local_project_patch({
        source: args.source,
        updatedSections: ["items", "proofreading", "task"],
        patch: args.plan.patch,
      });

      try {
        const mutation_ack = normalize_project_mutation_ack(
          await api_fetch<ProjectMutationAckPayload>(args.path, args.plan.request_body),
        );
        align_project_runtime_ack(mutation_ack);

        if (args.success_message_builder !== null && args.success_message_builder !== undefined) {
          push_toast("success", args.success_message_builder(args.plan.changed_item_ids.length));
        }

        if (args.close_dialog) {
          set_dialog_state(create_empty_dialog_state());
          set_dialog_item_snapshot(null);
        }
      } catch (error) {
        local_commit.rollback();
        void refresh_project_runtime().catch(() => {});
        handle_api_error(error, t(args.fallback_error_key));
      } finally {
        set_is_mutating(false);
      }
    },
    [
      align_project_runtime_ack,
      commit_local_project_patch,
      handle_api_error,
      push_toast,
      refresh_project_runtime,
      t,
    ],
  );

  const run_mutation = useCallback(
    async (args: {
      path: string;
      body: Record<string, unknown>;
      fallback_error_key: "proofreading_page.feedback.retranslate_failed";
      preferred_row_id?: string | null;
      pending_replace_cursor?: number | null;
      success_message_builder?: ((changed_count: number) => string) | null;
      empty_warning_message?: string | null;
      close_dialog?: boolean;
    }): Promise<void> => {
      set_is_mutating(true);

      try {
        const mutation_payload = await api_fetch<ProofreadingMutationPayload>(args.path, args.body);
        const mutation_result = normalize_proofreading_mutation_payload(mutation_payload);

        if (mutation_result.changed_item_ids.length === 0) {
          if (args.empty_warning_message !== null && args.empty_warning_message !== undefined) {
            push_toast("warning", args.empty_warning_message);
          }
          return;
        }

        if (args.pending_replace_cursor !== undefined) {
          pending_replace_cursor_ref.current = args.pending_replace_cursor;
        }

        if (args.success_message_builder !== null && args.success_message_builder !== undefined) {
          push_toast(
            "success",
            args.success_message_builder(mutation_result.changed_item_ids.length),
          );
        }

        if (args.close_dialog) {
          set_dialog_state(create_empty_dialog_state());
          set_dialog_item_snapshot(null);
        }

        preferred_row_id_ref.current = args.preferred_row_id ?? active_row_id_ref.current;
        set_cache_stale(true);
      } catch (error) {
        handle_api_error(error, t(args.fallback_error_key));
      } finally {
        set_is_mutating(false);
      }
    },
    [handle_api_error, push_toast, t],
  );

  const update_search_keyword = useCallback((next_keyword: string): void => {
    set_search_keyword(next_keyword);
    should_select_first_visible_ref.current = false;
  }, []);

  const update_replace_text = useCallback((next_replace_text: string): void => {
    set_replace_text(next_replace_text);
  }, []);

  const update_search_scope = useCallback((next_scope: ProofreadingSearchScope): void => {
    set_search_scope(next_scope);
    should_select_first_visible_ref.current = false;
  }, []);

  const update_regex = useCallback((next_is_regex: boolean): void => {
    set_is_regex(next_is_regex);
    should_select_first_visible_ref.current = false;
  }, []);

  const apply_table_selection = useCallback((payload: AppTableSelectionChange): void => {
    set_selected_row_ids(payload.selected_row_ids);
    set_active_row_id(payload.active_row_id);
    set_anchor_row_id(payload.anchor_row_id);
  }, []);

  const apply_table_sort_state = useCallback((next_sort_state: AppTableSortState | null): void => {
    set_sort_state(next_sort_state);
  }, []);

  const get_visible_row_at_index = useCallback(
    (index: number): ProofreadingVisibleItem | undefined => {
      const window_index = index - list_view.window_start;
      if (window_index < 0 || window_index >= visible_items.length) {
        return undefined;
      }

      return visible_items[window_index];
    },
    [list_view.window_start, visible_items],
  );

  const get_visible_row_id_at_index = useCallback(
    (index: number): string | undefined => {
      return get_visible_row_at_index(index)?.row_id;
    },
    [get_visible_row_at_index],
  );

  const resolve_visible_row_index = useCallback(
    (row_id: string): number | undefined => {
      return visible_row_index_by_id.get(row_id);
    },
    [visible_row_index_by_id],
  );

  const read_visible_range = useCallback(
    (range: { start: number; count: number }): void => {
      void read_list_window(range).catch((error) => {
        const fallback_message = t("proofreading_page.feedback.refresh_failed");
        const message = is_worker_client_error(error)
          ? fallback_message
          : resolve_error_message(error, fallback_message);
        push_toast("error", message);
      });
    },
    [push_toast, read_list_window, t],
  );

  const open_filter_dialog = useCallback((): void => {
    set_filter_dialog_filters(clone_proofreading_filter_options(current_filters_ref.current));
    set_filter_dialog_open(true);
  }, []);

  const close_filter_dialog = useCallback((): void => {
    set_filter_dialog_open(false);
    const restored_filters = clone_proofreading_filter_options(current_filters_ref.current);
    set_filter_dialog_filters(restored_filters);
    void run_filter_panel_query(restored_filters, {
      force: true,
      mark_loading: false,
    });
  }, [run_filter_panel_query]);

  const update_filter_dialog_filters = useCallback(
    (next_filters: ProofreadingFilterOptions): void => {
      set_filter_dialog_filters(clone_proofreading_filter_options(next_filters));
    },
    [],
  );

  const confirm_filter_dialog_filters = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || cache_status !== "ready" || is_refreshing) {
      return;
    }

    const normalized_filters = clone_proofreading_filter_options(filter_dialog_filters_ref.current);
    preferred_row_id_ref.current = null;
    should_select_first_visible_ref.current = true;
    set_current_filters(clone_proofreading_filter_options(normalized_filters));
    set_filter_dialog_filters(clone_proofreading_filter_options(normalized_filters));
    set_filter_dialog_open(false);

    try {
      await settle_list_view_and_filter_panel({
        filters: normalized_filters,
        keyword: search_keyword_ref.current,
        scope: search_scope_ref.current,
        is_regex: is_regex_ref.current,
        sort_state: sort_state_ref.current,
        force: true,
      });
    } catch (error) {
      const fallback_message = t("proofreading_page.feedback.refresh_failed");
      const message = is_worker_client_error(error)
        ? fallback_message
        : resolve_error_message(error, fallback_message);
      push_toast("error", message);
    }
  }, [
    cache_status,
    is_refreshing,
    project_snapshot.loaded,
    push_toast,
    settle_list_view_and_filter_panel,
    t,
  ]);

  const open_edit_dialog = useCallback(
    async (row_id: string): Promise<void> => {
      const target_item = (await read_items_by_row_ids([row_id]))[0];
      if (target_item === undefined) {
        return;
      }

      set_dialog_item_snapshot(target_item);
      set_dialog_state({
        open: true,
        target_row_id: row_id,
        draft_dst: target_item.dst,
        saving: false,
      });
    },
    [read_items_by_row_ids],
  );

  const request_close_dialog = useCallback((): void => {
    set_dialog_state(create_empty_dialog_state());
    set_dialog_item_snapshot(null);
  }, []);

  const update_dialog_draft = useCallback((next_draft_dst: string): void => {
    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        draft_dst: next_draft_dst,
      };
    });
  }, []);

  const save_dialog_entry = useCallback(async (): Promise<void> => {
    if (dialog_state.target_row_id === null) {
      return;
    }

    const target_item = (await read_items_by_row_ids([dialog_state.target_row_id]))[0];
    if (target_item === undefined) {
      set_dialog_state(create_empty_dialog_state());
      set_dialog_item_snapshot(null);
      return;
    }

    if (dialog_state.draft_dst === target_item.dst) {
      set_dialog_state(create_empty_dialog_state());
      set_dialog_item_snapshot(null);
      push_toast("success", t("app.feedback.save_success"));
      return;
    }

    set_dialog_state((previous_state) => {
      return {
        ...previous_state,
        saving: true,
      };
    });

    try {
      await run_ack_only_mutation({
        path: "/api/project/proofreading/save-item",
        source: "proofreading_save_item",
        plan: create_save_item_plan({
          state: project_store.getState(),
          item_id: Number(target_item.item_id),
          next_dst: dialog_state.draft_dst,
        }),
        fallback_error_key: "proofreading_page.feedback.save_failed",
        preferred_row_id: dialog_state.target_row_id,
        success_message_builder: () => t("app.feedback.save_success"),
        close_dialog: true,
      });
    } finally {
      set_dialog_state((previous_state) => {
        if (previous_state.target_row_id !== dialog_state.target_row_id) {
          return previous_state;
        }

        return {
          ...previous_state,
          saving: false,
        };
      });
    }
  }, [dialog_state, project_store, push_toast, read_items_by_row_ids, run_ack_only_mutation, t]);

  const replace_next_visible_match = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_mutating) {
      return;
    }

    const trimmed_keyword = search_keyword.trim();
    if (trimmed_keyword === "") {
      push_toast("warning", t("proofreading_page.feedback.no_match"));
      return;
    }

    let search_pattern: RegExp;
    try {
      search_pattern = create_search_pattern(trimmed_keyword, is_regex) ?? /^$/u;
    } catch (error) {
      push_toast(
        "error",
        `${t("proofreading_page.feedback.regex_invalid")}: ${resolve_error_message(error, "")}`,
      );
      return;
    }

    if (list_view.view_id === "") {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let target_index = -1;
    let target_item: ProofreadingItem | null = null;
    for (
      let scan_start = replace_cursor_ref.current;
      scan_start < list_view.row_count;
      scan_start += PROOFREADING_WINDOW_FETCH_COUNT
    ) {
      const target_window = await proofreading_runtime_client_ref.current.read_list_window({
        view_id: list_view.view_id,
        start: scan_start,
        count: PROOFREADING_WINDOW_FETCH_COUNT,
      });
      const matched_index = target_window.rows.findIndex((row) => {
        return matches_search_pattern(row.item.dst, search_pattern, trimmed_keyword, is_regex);
      });
      if (matched_index >= 0) {
        target_index = target_window.start + matched_index;
        target_item = target_window.rows[matched_index]?.item ?? null;
        break;
      }
    }

    if (target_item === null || target_index < 0) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    const replaced_result = replace_first_visible_match(
      target_item.dst,
      search_pattern,
      replace_text,
    );
    if (!replaced_result.replaced) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    await run_ack_only_mutation({
      path: "/api/project/proofreading/save-item",
      source: "proofreading_save_item",
      plan: create_save_item_plan({
        state: project_store.getState(),
        item_id: Number(target_item.item_id),
        next_dst: replaced_result.text,
      }),
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: build_proofreading_row_id(target_item.item_id),
      pending_replace_cursor: target_index + 1,
    });
  }, [
    is_mutating,
    is_refreshing,
    is_regex,
    project_store,
    push_toast,
    readonly,
    replace_text,
    run_ack_only_mutation,
    search_keyword,
    t,
    list_view.view_id,
  ]);

  const replace_all_visible_matches = useCallback(async (): Promise<void> => {
    if (readonly || is_refreshing || is_mutating) {
      return;
    }

    const trimmed_keyword = search_keyword.trim();
    if (trimmed_keyword === "") {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let search_pattern: RegExp;
    try {
      search_pattern = create_search_pattern(trimmed_keyword, is_regex) ?? /^$/u;
    } catch (error) {
      push_toast(
        "error",
        `${t("proofreading_page.feedback.regex_invalid")}: ${resolve_error_message(error, "")}`,
      );
      return;
    }

    const target_row_ids = await read_current_view_row_ids(0, list_view.row_count);
    const target_items = (await read_items_by_row_ids(target_row_ids)).filter((item) => {
      return matches_search_pattern(item.dst, search_pattern, trimmed_keyword, is_regex);
    });

    if (target_items.length === 0) {
      push_toast("warning", t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    const replace_plan = create_replace_all_plan({
      state: project_store.getState(),
      item_ids: target_items.map((item) => Number(item.item_id)),
      search_text: trimmed_keyword,
      replace_text,
      is_regex,
    });

    await run_ack_only_mutation({
      path: "/api/project/proofreading/replace-all",
      source: "proofreading_replace_all",
      plan: replace_plan,
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: active_row_id_ref.current,
      pending_replace_cursor: 0,
      success_message_builder: (changed_count) => {
        return t("proofreading_page.feedback.replace_done").replace(
          "{N}",
          changed_count.toString(),
        );
      },
      empty_warning_message: t("proofreading_page.feedback.replace_no_change"),
      close_dialog: true,
    });
  }, [
    is_mutating,
    is_refreshing,
    is_regex,
    project_store,
    push_toast,
    readonly,
    replace_text,
    run_ack_only_mutation,
    search_keyword,
    t,
    list_view.row_count,
    read_current_view_row_ids,
    read_items_by_row_ids,
  ]);

  const request_retranslate_row_ids = useCallback((row_ids: string[]): void => {
    if (row_ids.length === 0) {
      return;
    }

    set_pending_mutation({
      kind: "retranslate-items",
      target_row_ids: row_ids,
    });
  }, []);

  const request_reset_row_ids = useCallback((row_ids: string[]): void => {
    if (row_ids.length === 0) {
      return;
    }

    set_pending_mutation({
      kind: "reset-items",
      target_row_ids: row_ids,
    });
  }, []);

  const close_pending_mutation = useCallback((): void => {
    set_pending_mutation(null);
  }, []);

  const confirm_pending_mutation = useCallback(async (): Promise<void> => {
    if (pending_mutation === null) {
      return;
    }

    const target_items = await read_items_by_row_ids(pending_mutation.target_row_ids);
    if (target_items.length === 0) {
      set_pending_mutation(null);
      return;
    }

    const is_retranslate = pending_mutation.kind === "retranslate-items";
    const success_message = is_retranslate
      ? t("proofreading_page.feedback.retranslate_success").replace("{COUNT}", "{COUNT}")
      : t("proofreading_page.feedback.reset_success").replace("{COUNT}", "{COUNT}");

    set_pending_mutation(null);
    if (is_retranslate) {
      await run_mutation({
        path: "/api/project/proofreading/retranslate-items",
        body: {
          items: target_items.map((item) => serialize_item(item)),
          expected_revision: list_view.revision,
        },
        fallback_error_key: "proofreading_page.feedback.retranslate_failed",
        preferred_row_id: active_row_id_ref.current,
        success_message_builder: (changed_count) => {
          return success_message.replace("{COUNT}", changed_count.toString());
        },
        close_dialog: dialog_state.open,
      });
      return;
    }

    await run_ack_only_mutation({
      path: "/api/project/proofreading/save-all",
      source: "proofreading_save_all",
      plan: create_reset_items_plan({
        state: project_store.getState(),
        item_ids: target_items.map((item) => Number(item.item_id)),
      }),
      fallback_error_key: "proofreading_page.feedback.reset_failed",
      preferred_row_id: active_row_id_ref.current,
      success_message_builder: (changed_count) => {
        return success_message.replace("{COUNT}", changed_count.toString());
      },
      close_dialog: dialog_state.open,
      empty_warning_message: null,
    });
  }, [
    dialog_state.open,
    list_view.revision,
    pending_mutation,
    project_store,
    read_items_by_row_ids,
    run_ack_only_mutation,
    run_mutation,
    t,
  ]);

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current;
    const previous_project_path = previous_project_path_ref.current;

    previous_project_loaded_ref.current = project_snapshot.loaded;
    previous_project_path_ref.current = project_snapshot.path;

    if (!project_snapshot.loaded) {
      clear_transient_state_for_new_project();
      clear_cache_state();
      set_cache_status("idle");
      return;
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_transient_state_for_new_project();
      clear_cache_state();
      set_cache_status("refreshing");
      pending_reset_filters_ref.current = true;
    }
  }, [
    clear_cache_state,
    clear_transient_state_for_new_project,
    project_snapshot.loaded,
    project_snapshot.path,
  ]);

  useEffect(() => {
    const previous_seq = previous_proofreading_change_seq_ref.current;
    previous_proofreading_change_seq_ref.current = proofreading_change_signal.seq;

    if (!project_snapshot.loaded) {
      return;
    }

    if (previous_seq !== proofreading_change_signal.seq) {
      set_cache_stale(true);
      void refresh_snapshot();
    }
  }, [project_snapshot.loaded, proofreading_change_signal.seq, refresh_snapshot]);

  useEffect(() => {
    if (cache_status !== "ready" || is_refreshing || runtime_sync_state_ref.current === null) {
      return;
    }

    void run_list_view_query({
      filters: current_filters,
      keyword: deferred_search_keyword,
      scope: deferred_search_scope,
      is_regex: deferred_is_regex,
      sort_state: deferred_sort_state,
    }).catch((error) => {
      const fallback_message = t("proofreading_page.feedback.refresh_failed");
      const message = is_worker_client_error(error)
        ? fallback_message
        : resolve_error_message(error, fallback_message);
      push_toast("error", message);
    });
  }, [
    cache_status,
    current_filters,
    deferred_is_regex,
    deferred_search_keyword,
    deferred_search_scope,
    deferred_sort_state,
    is_refreshing,
    push_toast,
    run_list_view_query,
    t,
  ]);

  useEffect(() => {
    if (
      !filter_dialog_open ||
      cache_status !== "ready" ||
      runtime_sync_state_ref.current === null
    ) {
      return;
    }

    const debounce_id = window.setTimeout(() => {
      void run_filter_panel_query(filter_dialog_filters, {
        mark_loading: true,
      }).catch((error) => {
        const fallback_message = t("proofreading_page.feedback.refresh_failed");
        const message = is_worker_client_error(error)
          ? fallback_message
          : resolve_error_message(error, fallback_message);
        push_toast("error", message);
      });
    }, 160);

    return () => {
      window.clearTimeout(debounce_id);
    };
  }, [
    cache_status,
    filter_dialog_filters,
    filter_dialog_open,
    push_toast,
    run_filter_panel_query,
    t,
  ]);

  useEffect(() => {
    if (proofreading_lookup_intent === null) {
      return;
    }

    set_search_keyword(proofreading_lookup_intent.keyword);
    set_search_scope("all");
    set_is_regex(proofreading_lookup_intent.is_regex);
    should_select_first_visible_ref.current = true;
    clear_proofreading_lookup_intent();
  }, [clear_proofreading_lookup_intent, proofreading_lookup_intent]);

  useEffect(() => {
    if (pending_replace_cursor_ref.current !== null) {
      replace_cursor_ref.current = pending_replace_cursor_ref.current;
      pending_replace_cursor_ref.current = null;
      return;
    }

    replace_cursor_ref.current = 0;
  }, [
    current_filter_signature,
    is_regex,
    list_view.revision,
    search_keyword,
    search_scope,
    sort_signature,
    visible_items,
  ]);

  useEffect(() => {
    const visible_row_id_set = new Set(visible_row_ids);
    const preferred_row_id = preferred_row_id_ref.current;

    if (preferred_row_id !== null) {
      preferred_row_id_ref.current = null;
      if (visible_row_id_set.has(preferred_row_id)) {
        set_selected_row_ids([preferred_row_id]);
        set_active_row_id(preferred_row_id);
        set_anchor_row_id(preferred_row_id);
        return;
      }
    }

    if (should_select_first_visible_ref.current && visible_row_ids.length > 0) {
      should_select_first_visible_ref.current = false;
      const first_visible_row_id = visible_row_ids[0] ?? null;
      if (first_visible_row_id !== null) {
        set_selected_row_ids([first_visible_row_id]);
        set_active_row_id(first_visible_row_id);
        set_anchor_row_id(first_visible_row_id);
        return;
      }
    }

    const next_selected_row_ids = selected_row_ids_ref.current.filter((row_id) => {
      return visible_row_id_set.has(row_id);
    });
    const next_active_row_id =
      active_row_id_ref.current !== null && visible_row_id_set.has(active_row_id_ref.current)
        ? active_row_id_ref.current
        : (next_selected_row_ids[0] ?? null);
    const next_anchor_row_id =
      anchor_row_id_ref.current !== null && visible_row_id_set.has(anchor_row_id_ref.current)
        ? anchor_row_id_ref.current
        : next_active_row_id;

    set_selected_row_ids(next_selected_row_ids);
    set_active_row_id(next_active_row_id);
    set_anchor_row_id(next_anchor_row_id);
  }, [visible_row_ids]);

  return useMemo<UseProofreadingPageStateResult>(() => {
    return {
      cache_status,
      cache_stale,
      last_loaded_at,
      refresh_request_id,
      settled_project_path,
      is_refreshing,
      is_mutating,
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
      filter_dialog_open,
      dialog_state,
      dialog_item,
      pending_mutation,
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
      read_visible_range,
      open_filter_dialog,
      close_filter_dialog,
      update_filter_dialog_filters,
      confirm_filter_dialog_filters,
      open_edit_dialog,
      request_close_dialog,
      update_dialog_draft,
      save_dialog_entry,
      replace_next_visible_match,
      replace_all_visible_matches,
      request_retranslate_row_ids,
      request_reset_row_ids,
      confirm_pending_mutation,
      close_pending_mutation,
    };
  }, [
    active_row_id,
    anchor_row_id,
    apply_table_selection,
    apply_table_sort_state,
    cache_stale,
    cache_status,
    close_filter_dialog,
    close_pending_mutation,
    confirm_filter_dialog_filters,
    confirm_pending_mutation,
    current_filters,
    dialog_item,
    dialog_state,
    filter_dialog_filters,
    filter_dialog_open,
    filter_panel,
    filter_panel_loading,
    get_visible_row_at_index,
    get_visible_row_id_at_index,
    invalid_regex_message,
    is_mutating,
    is_refreshing,
    is_regex,
    last_loaded_at,
    open_edit_dialog,
    open_filter_dialog,
    pending_mutation,
    readonly,
    refresh_request_id,
    refresh_snapshot,
    read_visible_range,
    replace_all_visible_matches,
    replace_next_visible_match,
    replace_text,
    request_close_dialog,
    request_reset_row_ids,
    request_retranslate_row_ids,
    resolve_visible_row_index,
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
