import {
  build_proofreading_row_id,
  compress_proofreading_text,
  resolve_proofreading_status_sort_rank,
  type ProofreadingClientItem,
  type ProofreadingVisibleItem,
  type ProofreadingWarningFragmentsByCode,
  type ProofreadingGlossaryTerm,
} from "@/pages/proofreading-page/types";
import type { AppTableSortState } from "@/widgets/app-table/app-table-types";

type ProofreadingSortableItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  status: string;
  retry_count: number;
};

// 自然排序固定为文件路径 + 行号，是所有二级排序的稳定兜底。
const PROOFREADING_NATURAL_SORT_STATE: AppTableSortState = {
  column_id: "file",
  direction: "ascending",
};

/**
 * 文本排序固定使用简体中文 locale，确保文件名和术语排序在各系统上稳定。
 */
export function compare_proofreading_text(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hans-CN");
}

/**
 * 表格排序方向转成乘数，避免每个比较器重复写升降序分支。
 */
function normalize_sort_direction(direction: "ascending" | "descending"): number {
  return direction === "ascending" ? 1 : -1;
}

/**
 * 原始 item 的自然顺序必须按文件、行号、item_id 固定，支撑虚拟列表稳定窗口。
 */
export function compare_proofreading_runtime_items(
  left_item: ProofreadingSortableItemRecord,
  right_item: ProofreadingSortableItemRecord,
): number {
  const file_result = compare_proofreading_text(left_item.file_path, right_item.file_path);
  if (file_result !== 0) {
    return file_result;
  }

  const row_result = left_item.row_number - right_item.row_number;
  if (row_result !== 0) {
    return row_result;
  }

  return left_item.item_id - right_item.item_id;
}

/**
 * 可见 item 的列排序只解释当前 UI 支持的列，未知列回退自然顺序。
 */
function compare_visible_items(
  left_item: ProofreadingClientItem,
  right_item: ProofreadingClientItem,
  sort_state: AppTableSortState,
): number {
  const direction = normalize_sort_direction(sort_state.direction);

  if (sort_state.column_id === "file") {
    const file_path_result = compare_proofreading_text(left_item.file_path, right_item.file_path);
    if (file_path_result !== 0) {
      return file_path_result * direction;
    }

    return (left_item.row_number - right_item.row_number) * direction;
  }

  if (sort_state.column_id === "status") {
    const status_rank_result =
      resolve_proofreading_status_sort_rank(left_item.status) -
      resolve_proofreading_status_sort_rank(right_item.status);
    if (status_rank_result !== 0) {
      return status_rank_result * direction;
    }

    return compare_proofreading_text(left_item.status, right_item.status) * direction;
  }

  if (sort_state.column_id === "src") {
    return compare_proofreading_text(left_item.src, right_item.src) * direction;
  }

  if (sort_state.column_id === "dst") {
    return compare_proofreading_text(left_item.dst, right_item.dst) * direction;
  }

  return 0;
}

/**
 * 可见列表排序会叠加自然顺序兜底，保证相同列值时行顺序不抖动。
 */
function compare_list_view_items(
  left_item: ProofreadingClientItem,
  right_item: ProofreadingClientItem,
  sort_state: AppTableSortState | null,
): number {
  const effective_sort_state = sort_state ?? PROOFREADING_NATURAL_SORT_STATE;
  const result = compare_visible_items(left_item, right_item, effective_sort_state);
  if (result !== 0) {
    return result;
  }

  if (effective_sort_state.column_id !== PROOFREADING_NATURAL_SORT_STATE.column_id) {
    const natural_order_result = compare_visible_items(
      left_item,
      right_item,
      PROOFREADING_NATURAL_SORT_STATE,
    );
    if (natural_order_result !== 0) {
      return natural_order_result;
    }
  }

  return compare_proofreading_text(left_item.row_id, right_item.row_id);
}

/**
 * 原地排序列表行，调用方在构建临时列表后使用，避免复制大项目窗口数组。
 */
export function sort_proofreading_client_items(
  items: ProofreadingClientItem[],
  sort_state: AppTableSortState | null,
): ProofreadingClientItem[] {
  return items.sort((left_item, right_item) => {
    return compare_list_view_items(left_item, right_item, sort_state);
  });
}

/**
 * 构建对外可见 item 时一次性压缩文本和克隆数组，避免 UI 改到缓存对象。
 */
export function create_proofreading_client_item(args: {
  item: ProofreadingSortableItemRecord;
  warnings: string[];
  warning_fragments_by_code: ProofreadingWarningFragmentsByCode;
  failed_terms: ProofreadingGlossaryTerm[];
  applied_terms: ProofreadingGlossaryTerm[];
}): ProofreadingClientItem {
  return {
    item_id: args.item.item_id,
    file_path: args.item.file_path,
    row_number: args.item.row_number,
    src: args.item.src,
    dst: args.item.dst,
    status: args.item.status,
    retry_count: args.item.retry_count,
    warnings: [...args.warnings],
    warning_fragments_by_code: {
      ...(args.warning_fragments_by_code.KANA === undefined
        ? {}
        : { KANA: [...args.warning_fragments_by_code.KANA] }),
      ...(args.warning_fragments_by_code.HANGEUL === undefined
        ? {}
        : { HANGEUL: [...args.warning_fragments_by_code.HANGEUL] }),
      ...(args.warning_fragments_by_code.TEXT_PRESERVE === undefined
        ? {}
        : { TEXT_PRESERVE: [...args.warning_fragments_by_code.TEXT_PRESERVE] }),
    },
    failed_glossary_terms: args.failed_terms.map((term) => {
      return [term[0], term[1]] as const;
    }),
    applied_glossary_terms: args.applied_terms.map((term) => {
      return [term[0], term[1]] as const;
    }),
    row_id: build_proofreading_row_id(args.item.item_id),
    compressed_src: compress_proofreading_text(args.item.src),
    compressed_dst: compress_proofreading_text(args.item.dst),
  };
}

/**
 * 列表窗口输出保留压缩文本字段，渲染层可直接复用虚拟表所需的轻量行模型。
 */
export function build_proofreading_visible_items(
  items: ProofreadingClientItem[],
): ProofreadingVisibleItem[] {
  return items.map((item) => {
    return {
      row_id: item.row_id,
      item,
      compressed_src: item.compressed_src,
      compressed_dst: item.compressed_dst,
    };
  });
}
