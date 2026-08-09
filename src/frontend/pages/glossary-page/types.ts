export type { GlossaryEntry } from "@shared/quality/glossary";
import type { GlossaryEntry } from "@shared/quality/glossary";

export type GlossaryEntryId = string;
/** 创建草稿尚未分配项目身份，编辑草稿保留既有身份。 */
export type GlossaryEntryDraft = Omit<GlossaryEntry, "entry_id"> & { entry_id?: string };

export type GlossaryDialogMode = "create" | "edit";

export type GlossaryDialogState = {
  open: boolean;
  mode: GlossaryDialogMode;
  target_entry_id: GlossaryEntryId | null;
  insert_after_entry_id: GlossaryEntryId | null;
  draft_entry: GlossaryEntryDraft;
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
  running: boolean; // 首次分析是否仍在计算
  entry_ids: GlossaryEntryId[] | null; // null 表示尚无可展示结果
  hits_by_entry_id: Record<GlossaryEntryId, number>; // 已完成规则的 item 命中数
  subset_parents_by_entry_id: Record<GlossaryEntryId, string[]>; // 字面量真实包含父文本
};

export type GlossaryHitBadgeKind = "matched" | "unmatched" | "related";

export type GlossaryHitBadgeState = {
  kind: GlossaryHitBadgeKind;
  hits: number;
  subset_parents: string[]; // tooltip 展示的父规则原文
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
