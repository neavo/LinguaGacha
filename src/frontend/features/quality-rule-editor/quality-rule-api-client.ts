import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type QualityRuleSectionRevisions = Record<string, number | undefined>;
export type QualityRuleType = "glossary" | "pre_replacement" | "post_replacement" | "text_preserve";

export type QualityRuleQuerySlice = {
  enabled?: unknown;
  mode?: unknown;
  entries?: unknown;
};

export type QualityRuleQueryResponse = {
  projectPath: string;
  sectionRevisions?: QualityRuleSectionRevisions;
  qualityRule?: QualityRuleQuerySlice;
};

/**
 * 通过统一质量规则查询入口读取指定规则切片，页面负责在边界处窄化载荷。
 */
export async function query_quality_rules(
  rule_type: QualityRuleType,
): Promise<QualityRuleQueryResponse> {
  return await api_fetch<QualityRuleQueryResponse>("/api/quality/rules/query", {
    rule_type,
  });
}
