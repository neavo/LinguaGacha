import type { QualityRuleTextReplacementEntry as TextReplacementEntry } from "@domain/quality";
export type { QualityRuleTextReplacementEntry as TextReplacementEntry } from "@domain/quality";

export type TextReplacementEntryId = string;
/** 创建草稿尚未分配项目身份，编辑草稿保留既有身份。 */
export type TextReplacementEntryDraft =
  import("@frontend/features/quality-rule-editor/use-quality-rule-editing").QualityRuleDraft<TextReplacementEntry>;

export type TextReplacementDialogMode = "create" | "edit";

export type TextReplacementFilterScope = "all" | "src" | "dst";

export type TextReplacementFilterState = {
  keyword: string;
  scope: TextReplacementFilterScope;
  is_regex: boolean;
};

export type TextReplacementHitState = {
  running: boolean; // 首次分析是否仍在计算
  entry_ids: TextReplacementEntryId[] | null; // null 表示尚无可展示结果
  hits_by_entry_id: Record<TextReplacementEntryId, number>; // 已完成规则的 item 命中数
  subset_parents_by_entry_id: Record<TextReplacementEntryId, string[]>; // 字面量真实包含父文本
};

export type TextReplacementHitBadgeKind = "matched" | "unmatched" | "related";

export type TextReplacementHitBadgeState = {
  kind: TextReplacementHitBadgeKind;
  hits: number;
  subset_parents: string[]; // tooltip 展示的父规则原文
  tooltip: string;
};

export type TextReplacementVisibleEntry =
  import("@frontend/features/quality-rule-editor/use-quality-rule-table").QualityRuleVisibleEntry<TextReplacementEntry>;
