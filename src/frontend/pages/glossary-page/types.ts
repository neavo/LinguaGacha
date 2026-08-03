import type { QualityStatisticsDependencySnapshot } from "@shared/quality/quality-statistics";

export type { GlossaryEntry } from "@shared/quality/glossary";
import type { GlossaryEntry } from "@shared/quality/glossary";

export type GlossaryEntryId = string;

export type GlossaryDialogMode = "create" | "edit";

export type GlossaryDialogState = {
  open: boolean;
  mode: GlossaryDialogMode;
  target_entry_id: GlossaryEntryId | null;
  insert_after_entry_id: GlossaryEntryId | null;
  draft_entry: GlossaryEntry;
  dirty: boolean;
  saving: boolean;
};

export type GlossaryFilterScope = "all" | "src" | "dst" | "info";

export type GlossaryFilterState = {
  keyword: string;
  scope: GlossaryFilterScope;
  is_regex: boolean;
};

export type GlossaryHitState = {
  running: boolean;
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  completed_entry_ids: GlossaryEntryId[];
  matched_count_by_entry_id: Record<GlossaryEntryId, number>;
  subset_parent_labels_by_entry_id: Record<GlossaryEntryId, string[]>;
};

export type GlossaryHitBadgeKind = "matched" | "unmatched" | "related";

export type GlossaryHitBadgeState = {
  kind: GlossaryHitBadgeKind;
  matched_count: number;
  subset_parent_labels: string[];
  tooltip: string;
};

export type GlossarySortField = "src" | "dst" | "info" | "rule" | "hit";

export type GlossarySortDirection = "ascending" | "descending";

export type GlossarySortState =
  | {
      field: null;
      direction: null;
    }
  | {
      field: GlossarySortField;
      direction: GlossarySortDirection;
    };

export type GlossaryVisibleEntry = {
  entry: GlossaryEntry;
  entry_id: GlossaryEntryId;
  source_index: number;
};

export type GlossaryConfirmState =
  | {
      open: false;
      kind: null;
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    }
  | {
      open: true;
      kind: "delete-selection" | "delete-preset" | "reset" | "overwrite-preset";
      selection_count: number;
      preset_name: string;
      preset_input_value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    };
