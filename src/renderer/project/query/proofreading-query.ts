import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProofreadingClientItem } from "@/pages/proofreading-page/types";
import type { ProjectDataSectionRevisions } from "@shared/project-event";

// ProofreadingQueryRow 是按 row id 回读时后端返回的最小校对行。
// ProofreadingItemsByRowIdsResponse 服务编辑和批量 mutation 前的小范围事实回读。
type ProofreadingItemsByRowIdsResponse = {
  sectionRevisions?: ProjectDataSectionRevisions;
  rows?: ProofreadingClientItem[];
};

// 校对 mutation 前按需读取后端 query 快照，避免把列表缓存当作写侧事实来源。
export async function read_proofreading_items_by_row_ids(
  row_ids: string[],
): Promise<ProofreadingClientItem[]> {
  if (row_ids.length === 0) {
    return [];
  }

  const response = await api_fetch<ProofreadingItemsByRowIdsResponse>(
    "/api/project/query/proofreading",
    { action: "items_by_row_ids", row_ids },
  );
  return Array.isArray(response.rows) ? response.rows : [];
}
