import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { TextReplacementVariantConfig } from "@frontend/pages/text-replacement-page/config";

export type TextReplacementSectionRevisions = Record<string, number | undefined>;

export type TextReplacementQualityRuleQuerySlice = {
  enabled?: unknown;
  mode?: unknown;
  entries?: unknown;
};

export type TextReplacementQualityRuleQueryResponse = {
  projectPath: string;
  sectionRevisions?: TextReplacementSectionRevisions;
  qualityRule?: TextReplacementQualityRuleQuerySlice;
};

type TextReplacementRevisionsResponse = {
  sectionRevisions?: TextReplacementSectionRevisions;
};

// 替换规则页只读取当前变体的质量规则 view，write 仍走统一提交管线。
export async function read_text_replacement_quality_rule(
  rule_type: TextReplacementVariantConfig["rule_type"],
): Promise<TextReplacementQualityRuleQueryResponse> {
  return await api_fetch<TextReplacementQualityRuleQueryResponse>("/api/quality/rules/view", {
    rule_type,
  });
}

// 替换规则页只读取当前页面保存动作所需 revision。
export async function read_text_replacement_section_revisions(): Promise<TextReplacementSectionRevisions> {
  const response = await api_fetch<TextReplacementRevisionsResponse>("/api/workbench/view", {});
  return response.sectionRevisions ?? {};
}
