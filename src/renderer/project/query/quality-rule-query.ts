import { api_fetch } from "@/app/desktop/desktop-api";
import type { QualityRuleKind } from "@domain/quality";

import type { ProjectQuerySectionRevisions } from "@/project/query/project-section-revisions-query";

// ProjectQualityRuleQuerySlice 是质量规则页面编辑单个规则所需的最小切片。
export type ProjectQualityRuleQuerySlice = {
  enabled?: unknown;
  mode?: unknown;
  entries?: unknown;
};

// ProjectQualityRuleQueryResponse 携带当前规则 view 和 mutation 所需 section revision。
export type ProjectQualityRuleQueryResponse = {
  projectPath: string;
  sectionRevisions?: ProjectQuerySectionRevisions;
  qualityRule?: ProjectQualityRuleQuerySlice;
};

// 质量规则页只从后端 query 读取项目事实，mutation 仍走统一提交管线。
/**
 * 读取当前场景需要的稳定数据。
 */
export async function read_project_quality_rule(
  rule_type: QualityRuleKind,
): Promise<ProjectQualityRuleQueryResponse> {
  return await api_fetch<ProjectQualityRuleQueryResponse>("/api/project/query/quality-rule", {
    rule_type,
  });
}
