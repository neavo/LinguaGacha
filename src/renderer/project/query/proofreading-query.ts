import { api_fetch } from "@/app/desktop/desktop-api";
import type { ProofreadingClientItem } from "@/pages/proofreading-page/types";
import type { ProofreadingRuntimeHydrationInput } from "@/pages/proofreading-page/proofreading-list-service";
import type { ProjectDataSectionRevisions } from "@shared/project-event";

// ProofreadingQueryRow 是按 row id 回读时后端返回的最小校对行。
type ProofreadingQueryRow = {
  row_id?: string;
  item?: Partial<ProofreadingClientItem> & Record<string, unknown>;
};

// ProofreadingItemsByRowIdsResponse 服务编辑和批量 mutation 前的小范围事实回读。
type ProofreadingItemsByRowIdsResponse = {
  sectionRevisions?: ProjectDataSectionRevisions;
  rows?: ProofreadingQueryRow[];
};

// ProofreadingRuntimeSnapshotResponse 服务校对列表运行态全量 hydrate。
type ProofreadingRuntimeSnapshotResponse = {
  projectPath?: string;
  sectionRevisions?: ProjectDataSectionRevisions;
  runtimeSnapshot?: {
    items?: Array<Record<string, unknown>>;
    quality?: unknown;
    total_item_count?: number;
  };
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
    { row_ids },
  );
  const rows = Array.isArray(response.rows) ? response.rows : [];
  return rows.flatMap((row) => {
    const item = row.item;
    if (item === undefined) {
      return [];
    }
    return [
      {
        item_id: Number(item.item_id ?? row.row_id ?? 0),
        file_path: String(item.file_path ?? ""),
        row_number: Number(item.row_number ?? item.row ?? 0),
        src: String(item.src ?? ""),
        dst: String(item.dst ?? ""),
        status: String(item.status ?? "NONE"),
        retry_count: Number(item.retry_count ?? 0),
        warnings: [],
        warning_fragments_by_code: {},
        applied_glossary_terms: [],
        failed_glossary_terms: [],
        row_id: String(row.row_id ?? item.item_id ?? ""),
        compressed_src: String(item.compressed_src ?? item.src ?? ""),
        compressed_dst: String(item.compressed_dst ?? item.dst ?? ""),
      },
    ];
  });
}

/**
 * 读取校对列表全量 hydrate 输入，并把后端 query 快照收窄成本地运行态字段。
 */
export async function read_proofreading_runtime_hydration_input(args: {
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<
  ProofreadingRuntimeHydrationInput & { section_revisions: ProjectDataSectionRevisions }
> {
  const response = await api_fetch<ProofreadingRuntimeSnapshotResponse>(
    "/api/project/query/proofreading",
    { runtime_snapshot: true },
  );
  const runtime_snapshot = response.runtimeSnapshot ?? {};
  const section_revisions = response.sectionRevisions ?? {};
  const items = Array.isArray(runtime_snapshot.items) ? runtime_snapshot.items : [];
  return {
    projectId: String(response.projectPath ?? ""),
    revisions: {
      items: section_revisions.items ?? 0,
      quality: section_revisions.quality ?? 0,
      proofreading: section_revisions.proofreading ?? 0,
    },
    total_item_count: Number(runtime_snapshot.total_item_count ?? items.length),
    upsertItems: items.flatMap((item) => {
      const item_id = Number(item.item_id ?? item.id ?? 0);
      if (!Number.isInteger(item_id) || item_id <= 0) {
        return [];
      }
      return [
        {
          item_id,
          file_path: String(item.file_path ?? ""),
          row_number: Number(item.row_number ?? item.row ?? 0),
          src: String(item.src ?? ""),
          dst: String(item.dst ?? ""),
          status: String(item.status ?? "NONE"),
          text_type: String(item.text_type ?? "NONE"),
          retry_count: Number(item.retry_count ?? 0),
        },
      ];
    }),
    quality: runtime_snapshot.quality as ProofreadingRuntimeHydrationInput["quality"],
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage,
    section_revisions,
  };
}
