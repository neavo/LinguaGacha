import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectItemPublicRecord } from "@base/item";

import type { ProjectQuerySectionRevisions } from "@/project/query/project-section-revisions-query";

// TsConversionTextPreserveQuerySlice 是简繁转换页读取的文本保护规则切片。
export type TsConversionTextPreserveQuerySlice = {
  mode?: unknown;
  entries?: unknown;
};

// TsConversionQueryResponse 只包含转换流程依赖的 item、文本保护和 revision。
export type TsConversionQueryResponse = {
  projectPath: string;
  sectionRevisions?: ProjectQuerySectionRevisions;
  items?: ProjectItemPublicRecord[];
  textPreserve?: TsConversionTextPreserveQuerySlice;
};

// 简繁转换页只读取后端 query view，避免为了导出流程常驻订阅项目事实。
export async function read_ts_conversion_query(): Promise<TsConversionQueryResponse> {
  return await api_fetch<TsConversionQueryResponse>("/api/project/query/ts-conversion", {});
}
