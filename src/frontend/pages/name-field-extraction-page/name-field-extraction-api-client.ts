import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type {
  NameFieldFilterState,
  NameFieldRow,
  NameFieldSortState,
} from "@frontend/pages/name-field-extraction-page/types";

export type NameFieldExtractionSectionRevisions = Record<string, number | undefined>;

export type NameFieldExtractionGlossaryQuerySlice = {
  entries?: unknown;
};

// NameFieldExtractionQueryResponse 只包含提取流程依赖的 item、术语和 revision。
export type NameFieldExtractionQueryResponse = {
  projectPath: string;
  sectionRevisions?: NameFieldExtractionSectionRevisions;
  view?: {
    rows?: NameFieldRow[];
    counts?: {
      total: number;
      translated: number;
      untranslated: number;
      error: number;
    };
    invalid_regex_message?: string | null;
  };
  glossary?: NameFieldExtractionGlossaryQuerySlice;
};

type NameFieldExtractionRevisionsResponse = {
  sectionRevisions?: NameFieldExtractionSectionRevisions;
};

// 姓名字段提取页只读取后端查询视图，避免为一次性提取流程订阅项目事实。
export async function read_name_field_extraction_query(args: {
  filter: NameFieldFilterState;
  sort: NameFieldSortState;
}): Promise<NameFieldExtractionQueryResponse> {
  return await api_fetch<NameFieldExtractionQueryResponse>("/api/toolbox/name-fields/view", {
    filter: args.filter,
    sort: args.sort,
  });
}

// 姓名字段提取页的术语导入只读取提交所需 revision，不共享跨页面客户端。
export async function read_name_field_extraction_section_revisions(): Promise<NameFieldExtractionSectionRevisions> {
  const response = await api_fetch<NameFieldExtractionRevisionsResponse>(
    "/api/workbench/snapshot",
    {},
  );
  return response.sectionRevisions ?? {};
}
