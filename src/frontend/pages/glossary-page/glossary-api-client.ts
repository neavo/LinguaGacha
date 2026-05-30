import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type GlossarySectionRevisions = Record<string, number | undefined>;

export type GlossaryQualityRuleQuerySlice = {
  enabled?: unknown;
  mode?: unknown;
  entries?: unknown;
};

export type GlossaryQualityRuleQueryResponse = {
  projectPath: string;
  sectionRevisions?: GlossarySectionRevisions;
  qualityRule?: GlossaryQualityRuleQuerySlice;
};

type GlossaryRevisionsResponse = {
  sectionRevisions?: GlossarySectionRevisions;
};

// 术语表页只读取自身质量规则视图，写入仍走统一提交管线。
export async function read_glossary_quality_rule(): Promise<GlossaryQualityRuleQueryResponse> {
  return await api_fetch<GlossaryQualityRuleQueryResponse>("/api/quality/rules/view", {
    rule_type: "glossary",
  });
}

// 术语表页只读取自身保存动作所需 revision。
export async function read_glossary_section_revisions(): Promise<GlossarySectionRevisions> {
  const response = await api_fetch<GlossaryRevisionsResponse>("/api/workbench/snapshot", {});
  return response.sectionRevisions ?? {};
}
