import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type CustomPromptSectionRevisions = Record<string, number | undefined>;

type CustomPromptRevisionsResponse = {
  sectionRevisions?: CustomPromptSectionRevisions;
};

// 自定义提示词页只读取保存提示词需要的 revision。
export async function read_custom_prompt_section_revisions(): Promise<CustomPromptSectionRevisions> {
  const response = await api_fetch<CustomPromptRevisionsResponse>("/api/workbench/snapshot", {});
  return response.sectionRevisions ?? {};
}
