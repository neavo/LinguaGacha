import {
  build_proofreading_visible_items,
  create_proofreading_client_item,
  sort_proofreading_client_items,
} from "@/pages/proofreading-page/proofreading-list-runtime";
import { create_empty_proofreading_list_view, type ProofreadingListView } from "./types";
import { create_text_keyword_matcher } from "@shared/text/text-pattern";
import type { AppTableSortState } from "@/widgets/app-table/app-table-types";

export type ProofreadingBasicRuntimeItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  status: string;
  text_type: string;
  retry_count: number;
};

export type ProofreadingBasicRuntimeHydrationInput = {
  projectId: string;
  revisions: {
    items: number;
    quality: number;
    proofreading: number;
  };
  total_item_count: number;
  upsertItems: ProofreadingBasicRuntimeItemRecord[];
};

type ProofreadingBasicListViewQuery = {
  keyword: string;
  scope: "all" | "src" | "dst";
  is_regex: boolean;
  sort_state: AppTableSortState | null;
  window_start?: number;
  window_count?: number;
};

export const PROOFREADING_BASIC_VIEW_MARKER = ":basic:"; // view_id 标记基础列表，避免误读完整质量列表缓存。

/**
 * 基础列表只消费后端 query item 快照，用于质量 hydrate 未完成前的可浏览首屏。
 */
export function build_basic_proofreading_list_view(args: {
  input: ProofreadingBasicRuntimeHydrationInput;
  query: ProofreadingBasicListViewQuery;
}): ProofreadingListView {
  if (args.input.upsertItems.length === 0) {
    return create_empty_proofreading_list_view();
  }

  const matcher = create_text_keyword_matcher({
    keyword: args.query.keyword,
    is_regex: args.query.is_regex,
    case_sensitive: false,
  });
  const items = args.input.upsertItems.flatMap((item) => {
    if (matcher.invalid_regex_message === null) {
      const matched =
        args.query.scope === "src"
          ? matcher.matches(item.src)
          : args.query.scope === "dst"
            ? matcher.matches(item.dst)
            : matcher.matches(item.src) || matcher.matches(item.dst);
      if (!matched) {
        return [];
      }
    }

    // 基础行明确置空质量派生字段，等待完整 hydrate 后再替换为完整行模型。
    return [
      create_proofreading_client_item({
        item,
        warnings: [],
        warning_fragments_by_code: {},
        applied_terms: [],
        failed_terms: [],
      }),
    ];
  });
  const sorted_items = sort_proofreading_client_items(items, args.query.sort_state);
  const window_start = Math.min(
    Math.max(0, Math.trunc(args.query.window_start ?? 0)),
    sorted_items.length,
  );
  const window_count = Math.max(0, Math.trunc(args.query.window_count ?? sorted_items.length));
  const window_items = sorted_items.slice(window_start, window_start + window_count);

  return {
    projectId: args.input.projectId,
    revisions: { ...args.input.revisions },
    view_id: `${args.input.projectId}${PROOFREADING_BASIC_VIEW_MARKER}${args.input.revisions.items.toString()}:${args.input.revisions.quality.toString()}:${args.input.revisions.proofreading.toString()}`,
    row_count: sorted_items.length,
    window_start,
    window_rows: build_proofreading_visible_items(window_items),
    invalid_regex_message: matcher.invalid_regex_message,
  };
}
