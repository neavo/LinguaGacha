export type { GlossaryEntry } from "@shared/quality/glossary";
import type { GlossaryEntry } from "@shared/quality/glossary";

export type GlossaryEntryId = string;
/** 创建草稿尚未分配项目身份，编辑草稿保留既有身份。 */
export type GlossaryEntryDraft =
  import("@frontend/features/quality-rule-editor/use-quality-rule-editing").QualityRuleDraft<GlossaryEntry>;

export type GlossaryDialogMode = "create" | "edit";

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

export type GlossarySortDirection = "ascending" | "descending";

export type GlossarySortState =
  | import("@frontend/widgets/app-table/app-table-types").AppTableSortState
  | null;

export type GlossaryVisibleEntry =
  import("@frontend/features/quality-rule-editor/quality-rule-filtering").QualityRuleVisibleEntry<GlossaryEntry>;
