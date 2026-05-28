import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectItemPublicRecord } from "@base/item";

import type { ProjectQuerySectionRevisions } from "@/project/query/project-section-revisions-query";

// NameFieldExtractionGlossaryQuerySlice 是姓名提取页实际需要的术语规则切片。
export type NameFieldExtractionGlossaryQuerySlice = {
  entries?: unknown;
};

// NameFieldExtractionQueryResponse 只包含提取流程依赖的 item、术语和 revision。
export type NameFieldExtractionQueryResponse = {
  projectPath: string;
  sectionRevisions?: ProjectQuerySectionRevisions;
  items?: ProjectItemPublicRecord[];
  glossary?: NameFieldExtractionGlossaryQuerySlice;
};

// 姓名字段提取页只读取后端 query view，避免为一次性提取流程订阅项目事实。
export async function read_name_field_extraction_query(): Promise<NameFieldExtractionQueryResponse> {
  return await api_fetch<NameFieldExtractionQueryResponse>(
    "/api/project/query/name-field-extraction",
    {},
  );
}
