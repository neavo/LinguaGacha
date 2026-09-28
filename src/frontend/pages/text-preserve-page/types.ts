import type { QualityRuleTextPreserveEntry as TextPreserveEntry } from "@domain/quality";

export type {
  QualityRuleTextPreserveEntry as TextPreserveEntry,
  TextPreserveMode,
} from "@domain/quality";

export type TextPreserveEntryId = string;
/** 创建草稿尚未分配项目身份，编辑草稿保留既有身份。 */
export type TextPreserveEntryDraft =
  import("@frontend/features/quality-rule-editor/use-quality-rule-editing").QualityRuleDraft<TextPreserveEntry>;

export type TextPreserveDialogMode = "create" | "edit";

export type TextPreserveFilterScope = "all" | "src" | "info";

export type TextPreserveFilterState = {
  keyword: string;
  scope: TextPreserveFilterScope;
  is_regex: boolean;
};

export type TextPreserveHitState = {
  running: boolean; // 首次分析是否仍在计算
  entry_ids: TextPreserveEntryId[] | null; // null 表示尚无可展示结果
  hits_by_entry_id: Record<TextPreserveEntryId, number>; // 已完成规则的 item 命中数
};

export type TextPreserveHitBadgeKind = "matched" | "unmatched";

export type TextPreserveHitBadgeState = {
  kind: TextPreserveHitBadgeKind;
  hits: number;
  tooltip: string;
};

export type TextPreserveVisibleEntry =
  import("@frontend/features/quality-rule-editor/use-quality-rule-table").QualityRuleVisibleEntry<TextPreserveEntry>;
