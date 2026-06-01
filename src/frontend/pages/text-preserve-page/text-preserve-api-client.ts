import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type TextPreserveSectionRevisions = Record<string, number | undefined>;

export type TextPreserveQualityRuleQuerySlice = {
  enabled?: unknown;
  mode?: unknown;
  entries?: unknown;
};

export type TextPreserveQualityRuleQueryResponse = {
  projectPath: string;
  sectionRevisions?: TextPreserveSectionRevisions;
  qualityRule?: TextPreserveQualityRuleQuerySlice;
};

type TextPreserveRevisionsResponse = {
  sectionRevisions?: TextPreserveSectionRevisions;
};

// 保留文本页只读取自身质量规则视图，写入仍走统一提交管线。
export async function read_text_preserve_quality_rule(
  rule_type: string,
): Promise<TextPreserveQualityRuleQueryResponse> {
  return await api_fetch<TextPreserveQualityRuleQueryResponse>("/api/quality/rules/view", {
    rule_type,
  });
}

// 保留文本页只读取自身保存动作所需 revision。
export async function read_text_preserve_section_revisions(): Promise<TextPreserveSectionRevisions> {
  const response = await api_fetch<TextPreserveRevisionsResponse>("/api/workbench/snapshot", {});
  return response.sectionRevisions ?? {};
}
