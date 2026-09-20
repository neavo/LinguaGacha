import {
  PROOFREADING_WARNING_CODES,
  build_proofreading_row_id,
  compress_proofreading_text,
  resolve_proofreading_status_sort_rank,
  proofreading_page_status,
  resolve_proofreading_outcomes,
  type ProofreadingEvaluatedItem,
  type ProofreadingItemRecord,
  type ProofreadingClientItem,
  type ProofreadingVisibleItem,
  type ProofreadingWarningCode,
  type ProofreadingWarningFragmentsByCode,
} from "./proofreading-types";
import type { PDFPageRecord } from "../pdf";
import type { GlossaryApplication } from "../quality/glossary";
import type { ItemNameField } from "../../domain/item";

export type ProofreadingSortState = {
  column_id: string;
  direction: "ascending" | "descending";
};

/** 查询只持有原始事实的引用，展示字段在窗口响应边界生成。 */
export type ProofreadingRowRecord =
  | { kind: "item"; row_id: string; item: ProofreadingEvaluatedItem }
  | { kind: "page"; row_id: string; record: PDFPageRecord };

const PROOFREADING_TEXT_SORTER = new Intl.Collator("zh-Hans-CN");

/** 文本比较固定 locale，文件排列位置由工程文件索引提供。 */
export function compare_proofreading_text(left: string, right: string): number {
  return PROOFREADING_TEXT_SORTER.compare(left, right);
}

/** 文本与页面使用各自记录中的文件归属。 */
export function read_proofreading_row_file_path(row: ProofreadingRowRecord): string {
  return row.kind === "item" ? row.item.file_path : row.record.file_path;
}

/** 页面处置映射为共享校对状态，文本沿用已保存状态。 */
function read_proofreading_row_status(row: ProofreadingRowRecord): string {
  return row.kind === "item"
    ? row.item.status
    : proofreading_page_status(row.record.page.translation);
}

/** 页面没有文本质量评估记录，已翻译页进入无警告集合。 */
export function resolve_proofreading_row_outcomes(row: ProofreadingRowRecord): string[] {
  return resolve_proofreading_outcomes(
    row.kind === "item"
      ? row.item
      : {
          status: read_proofreading_row_status(row),
          warnings: [],
        },
  );
}

/** 自然顺序统一为工程文件顺序、行号或页码和数值身份。 */
function compare_natural_rows(
  left: ProofreadingRowRecord,
  right: ProofreadingRowRecord,
  file_order: ReadonlyMap<string, number>,
): number {
  const left_path = read_proofreading_row_file_path(left);
  const right_path = read_proofreading_row_file_path(right);
  const file_result =
    (file_order.get(left_path) ?? Number.MAX_SAFE_INTEGER) -
    (file_order.get(right_path) ?? Number.MAX_SAFE_INTEGER);
  if (file_result !== 0) return file_result;
  const path_result = compare_proofreading_text(left_path, right_path);
  if (path_result !== 0) return path_result;
  const position_result =
    (left.kind === "item" ? left.item.row_number : left.record.page.page) -
    (right.kind === "item" ? right.item.row_number : right.record.page.page);
  if (position_result !== 0) return position_result;
  if (left.kind === "item" && right.kind === "item") return left.item.item_id - right.item.item_id;
  return compare_proofreading_text(left.row_id, right.row_id);
}

/** 页面原文列显示页码，译文列只提供预览入口。 */
function read_row_column_text(row: ProofreadingRowRecord, column: "src" | "dst"): string {
  if (row.kind === "item") return row.item[column];
  return column === "src" ? String(row.record.page.page).padStart(12, "0") : "";
}

/** 临时行引用只排序一次，同列值始终沿自然顺序兜底。 */
export function sort_proofreading_rows(
  rows: ProofreadingRowRecord[],
  sort_state: ProofreadingSortState | null,
  file_order: ReadonlyMap<string, number>,
): ProofreadingRowRecord[] {
  return rows.sort((left, right) => {
    let result = 0;
    if (sort_state?.column_id === "file") {
      result = compare_proofreading_text(
        read_proofreading_row_file_path(left),
        read_proofreading_row_file_path(right),
      );
    } else if (sort_state?.column_id === "status") {
      const left_status = read_proofreading_row_status(left);
      const right_status = read_proofreading_row_status(right);
      result =
        resolve_proofreading_status_sort_rank(left_status) -
          resolve_proofreading_status_sort_rank(right_status) ||
        compare_proofreading_text(left_status, right_status);
    } else if (sort_state?.column_id === "src" || sort_state?.column_id === "dst") {
      result = compare_proofreading_text(
        read_row_column_text(left, sort_state.column_id),
        read_row_column_text(right, sort_state.column_id),
      );
    }
    if (result !== 0) return result * (sort_state?.direction === "descending" ? -1 : 1);
    return compare_natural_rows(left, right, file_order);
  });
}

/**
 * 构建对外可见 item 时一次性压缩文本和克隆数组，避免 UI 改到缓存对象。
 */
export function create_proofreading_client_item(args: {
  item: Omit<ProofreadingItemRecord, "text_type">;
  warnings: ProofreadingWarningCode[];
  warning_fragments_by_code: ProofreadingWarningFragmentsByCode;
  glossary_applications: GlossaryApplication[];
}): ProofreadingClientItem {
  return {
    item_id: args.item.item_id,
    file_path: args.item.file_path,
    internal_file_path: args.item.internal_file_path,
    row_number: args.item.row_number,
    src: args.item.src,
    dst: args.item.dst,
    name_src: clone_item_name(args.item.name_src),
    name_dst: clone_item_name(args.item.name_dst),
    status: args.item.status,
    retry_count: args.item.retry_count,
    // 与筛选和统计共用词表顺序，检查执行顺序不决定展示顺序。
    warnings: PROOFREADING_WARNING_CODES.filter((code) => args.warnings.includes(code)),
    warning_fragments_by_code: {
      ...(args.warning_fragments_by_code.FOREIGN_CHAR_RESIDUE === undefined
        ? {}
        : { FOREIGN_CHAR_RESIDUE: [...args.warning_fragments_by_code.FOREIGN_CHAR_RESIDUE] }),
      ...(args.warning_fragments_by_code.TEXT_PRESERVE === undefined
        ? {}
        : { TEXT_PRESERVE: [...args.warning_fragments_by_code.TEXT_PRESERVE] }),
    },
    glossary_applications: args.glossary_applications.map((application) => ({
      ...application,
      fields: application.fields.map((field) => ({ ...field })),
    })),
    row_id: build_proofreading_row_id(args.item.item_id),
    compressed_src: compress_proofreading_text(args.item.src),
    compressed_dst: compress_proofreading_text(args.item.dst),
  };
}

/** 隔离数组形式的姓名槽位，避免列表消费者改写条目事实。 */
function clone_item_name(value: ItemNameField): ItemNameField {
  return Array.isArray(value) ? [...value] : value;
}

/**
 * 列表窗口输出保留压缩文本字段，渲染层可直接复用虚拟表所需的轻量行模型。
 */
export function build_proofreading_visible_items(
  items: ProofreadingClientItem[],
): ProofreadingVisibleItem[] {
  return items.map((item) => {
    return {
      kind: "item",
      row_id: item.row_id,
      item,
      compressed_src: item.compressed_src,
      compressed_dst: item.compressed_dst,
    };
  });
}
