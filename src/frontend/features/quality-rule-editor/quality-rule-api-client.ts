import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  GlossaryEntry,
  QualityRuleKind,
  TextPreserveEntry,
  TextReplacementEntry,
} from "@domain/quality";

type QualityRuleSectionRevisions = Record<string, number | undefined>;
type QualityRuleType = QualityRuleKind;

type QualityRuleEntryByType = {
  glossary: GlossaryEntry;
  pre_replacement: TextReplacementEntry;
  post_replacement: TextReplacementEntry;
  text_preserve: TextPreserveEntry;
};

export type QualityRuleQuerySlice<TType extends QualityRuleType = QualityRuleType> = {
  enabled?: unknown;
  mode?: unknown;
  entries?: QualityRuleEntryByType[TType][];
};

type QualityRuleQueryResponse<TType extends QualityRuleType = QualityRuleType> = {
  projectPath: string;
  sectionRevisions?: QualityRuleSectionRevisions;
  qualityRule?: QualityRuleQuerySlice<TType>;
};

/**
 * 通过统一质量规则查询入口读取指定规则切片，页面负责在边界处窄化载荷。
 */
export async function query_quality_rules<TType extends QualityRuleType>(
  rule_type: TType,
): Promise<QualityRuleQueryResponse<TType>> {
  return await api_fetch<QualityRuleQueryResponse<TType>>("/api/quality/rules/query", {
    rule_type,
  });
}
