import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProjectQuerySectionRevisions } from "@/project/query/project-section-revisions-query";
import type {
  NameFieldFilterState,
  NameFieldRow,
  NameFieldSortState,
} from "@/pages/name-field-extraction-page/types";

export type NameFieldExtractionGlossaryQuerySlice = {
  entries?: unknown;
};

// NameFieldExtractionQueryResponse 只包含提取流程依赖的 item、术语和 revision。
export type NameFieldExtractionQueryResponse = {
  projectPath: string;
  sectionRevisions?: ProjectQuerySectionRevisions;
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

// 姓名字段提取页只读取后端 query view，避免为一次性提取流程订阅项目事实。
/**
 * 读取当前场景需要的稳定数据。
 */
export async function read_name_field_extraction_query(args: {
  filter: NameFieldFilterState;
  sort: NameFieldSortState;
}): Promise<NameFieldExtractionQueryResponse> {
  return await api_fetch<NameFieldExtractionQueryResponse>(
    "/api/project/query/name-field-extraction",
    {
      filter: args.filter,
      sort: args.sort,
    },
  );
}
