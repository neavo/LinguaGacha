import {
  build_proofreading_row_id,
  resolve_proofreading_status_sort_rank,
  type ProofreadingEvaluatedItem,
  type ProofreadingClientItem,
} from "./proofreading-types";

export type ProofreadingSortState = {
  column_id: string;
  direction: "ascending" | "descending";
};

const PROOFREADING_TEXT_SORTER = new Intl.Collator("zh-Hans-CN");

/** 文本比较固定 locale，文件排列位置由工程文件索引提供。 */
export function compare_proofreading_text(left: string, right: string): number {
  return PROOFREADING_TEXT_SORTER.compare(left, right);
}

/** 自然顺序统一为工程文件顺序、行号和条目 ID。 */
function compare_natural_rows(
  left: ProofreadingEvaluatedItem,
  right: ProofreadingEvaluatedItem,
  file_order: ReadonlyMap<string, number>,
): number {
  const left_path = left.file_path;
  const right_path = right.file_path;
  const file_result =
    (file_order.get(left_path) ?? Number.MAX_SAFE_INTEGER) -
    (file_order.get(right_path) ?? Number.MAX_SAFE_INTEGER);
  if (file_result !== 0) return file_result;
  const path_result = compare_proofreading_text(left_path, right_path);
  if (path_result !== 0) return path_result;
  return left.row_number - right.row_number || left.item_id - right.item_id;
}

/** 按所选列排序，值相同的条目保持自然顺序。 */
export function sort_proofreading_items(
  rows: ProofreadingEvaluatedItem[],
  sort_state: ProofreadingSortState | null,
  file_order: ReadonlyMap<string, number>,
): ProofreadingEvaluatedItem[] {
  return rows.sort((left, right) => {
    let result = 0;
    if (sort_state?.column_id === "file") {
      result = compare_proofreading_text(left.file_path, right.file_path);
    } else if (sort_state?.column_id === "status") {
      const left_status = left.status;
      const right_status = right.status;
      result =
        resolve_proofreading_status_sort_rank(left_status) -
          resolve_proofreading_status_sort_rank(right_status) ||
        compare_proofreading_text(left_status, right_status);
    } else if (sort_state?.column_id === "src" || sort_state?.column_id === "dst") {
      result = compare_proofreading_text(left[sort_state.column_id], right[sort_state.column_id]);
    }
    if (result !== 0) return result * (sort_state?.direction === "descending" ? -1 : 1);
    return compare_natural_rows(left, right, file_order);
  });
}

/**
 * 公开条目复制姓名与证据数组，供独立的查询消费者使用。
 */
export function create_proofreading_client_item(
  item: ProofreadingEvaluatedItem,
): ProofreadingClientItem {
  return structuredClone({
    item_id: item.item_id,
    file_path: item.file_path,
    internal_file_path: item.internal_file_path,
    row_number: item.row_number,
    src: item.src,
    dst: item.dst,
    name_src: item.name_src,
    name_dst: item.name_dst,
    status: item.status,
    warnings: item.warnings,
    glossary_applications: item.glossary_applications,
    row_id: build_proofreading_row_id(item.item_id),
  });
}
