import type { ProjectDataSection, ProjectDataSectionRevisions } from "@shared/project-event";
import type {
  ProofreadingDialogState,
  ProofreadingPendingConfirmation,
} from "@frontend/pages/proofreading-page/proofreading-page-ui-types";
import type {
  AppTableScrollAnchor,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import type {
  ProofreadingFilterOptions,
  ProofreadingFilterPanelState,
  ProofreadingItem,
  ProofreadingManualStatusCode,
  ProofreadingSearchScope,
  ProofreadingVisibleItem,
} from "@shared/proofreading/proofreading-types";

export const PROOFREADING_REQUIRED_SECTIONS: ProjectDataSection[] = [
  "project",
  "items",
  "quality",
  "proofreading",
];

// session 恢复排序的白名单，避免旧列 id 进入列表查询。
const PROOFREADING_SORT_COLUMN_IDS = new Set(["src", "dst", "status"]);

// 切断 session 快照引用，避免页面排序对象被外部复用。
function clone_app_table_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  return sort_state === null
    ? null
    : {
        column_id: sort_state.column_id,
        direction: sort_state.direction,
      };
}

export function normalize_proofreading_sort_state(
  sort_state: AppTableSortState | null,
): AppTableSortState | null {
  if (sort_state === null || !PROOFREADING_SORT_COLUMN_IDS.has(sort_state.column_id)) {
    return null;
  }

  return clone_app_table_sort_state(sort_state);
}

export type UseProofreadingPageStateResult = {
  cache_status: "idle" | "refreshing" | "ready" | "error";
  list_revisions: ProjectDataSectionRevisions;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
  is_refreshing: boolean;
  is_writing: boolean;
  readonly: boolean;
  search_keyword: string;
  replace_text: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
  invalid_regex_message: string | null;
  current_filters: ProofreadingFilterOptions;
  filter_dialog_filters: ProofreadingFilterOptions;
  filter_panel: ProofreadingFilterPanelState;
  filter_panel_loading: boolean;
  visible_items: ProofreadingVisibleItem[];
  visible_row_count: number;
  sort_state: AppTableSortState | null;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  restore_scroll_row_id: string | null;
  preserve_scroll_anchor: AppTableScrollAnchor;
  retranslating_row_ids: string[];
  filter_dialog_open: boolean;
  dialog_state: ProofreadingDialogState;
  dialog_item: ProofreadingItem | null;
  pending_confirmation: ProofreadingPendingConfirmation | null;
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
  resolve_visible_row_index_async: (row_id: string) => Promise<number | undefined>;
  resolve_visible_row_ids_range: (range: { start: number; count: number }) => Promise<string[]>;
  read_visible_range: (range: { start: number; count: number }) => void;
  handle_table_selection_error: (error: unknown) => void;
  open_filter_dialog: () => void;
  close_filter_dialog: () => void;
  update_filter_dialog_filters: (next_filters: ProofreadingFilterOptions) => void;
  confirm_filter_dialog_filters: () => Promise<void>;
  open_edit_dialog: (row_id: string) => void;
  request_close_dialog: () => void;
  update_dialog_draft: (patch: Partial<ProofreadingDialogState["draft_item"]>) => void;
  save_dialog_entry: () => Promise<void>;
  replace_next_visible_match: () => Promise<void>;
  replace_all_visible_matches: () => Promise<void>;
  request_retranslate_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_clear_translation_row_ids: (row_ids: string[], preferred_row_id?: string | null) => void;
  request_set_translation_status_row_ids: (
    row_ids: string[],
    status: ProofreadingManualStatusCode,
    preferred_row_id?: string | null,
  ) => void;
  confirm_pending_confirmation: () => Promise<void>;
  close_pending_confirmation: () => void;
};
