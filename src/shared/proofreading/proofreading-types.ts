import type { ItemNameField } from "../../domain/item";
import type { GlossaryApplication } from "../quality/glossary";

// 筛选面板表示“无警告”的虚拟 warning。
export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

// 真实校对警告的唯一词表。
export const PROOFREADING_WARNING_CODES = [
  "KANA",
  "HANGEUL",
  "TEXT_PRESERVE",
  "SIMILARITY",
  "GLOSSARY",
  "RETRY_THRESHOLD",
] as const;

export type ProofreadingWarningCode = (typeof PROOFREADING_WARNING_CODES)[number];

// GUI 筛选词表额外包含“无警告”虚拟值。
export const PROOFREADING_WARNING_FILTER_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  ...PROOFREADING_WARNING_CODES,
] as const;

export const PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES = ["NONE", "PROCESSED", "ERROR"] as const;

// 设置翻译状态菜单的唯一状态词表。
export const PROOFREADING_MANUAL_STATUS_CODES = ["NONE", "PROCESSED", "EXCLUDED"] as const;

// 同时服务排序和默认状态筛选。
export const PROOFREADING_STATUS_ORDER = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "RULE_SKIPPED",
  "DUPLICATED",
] as const;

export type ProofreadingManualStatusCode = (typeof PROOFREADING_MANUAL_STATUS_CODES)[number];

export type ProofreadingWarningFragmentsByCode = {
  KANA?: string[];
  HANGEUL?: string[];
  TEXT_PRESERVE?: string[];
};

export type ProofreadingFilterOptions = {
  warning_types: string[];
  statuses: string[];
  file_paths: string[];
  glossary_entry_ids: string[];
  include_without_glossary_miss: boolean;
};

export type ProofreadingItem = {
  item_id: number | string;
  file_path: string;
  internal_file_path?: string; // 详情查询按需返回格式内部路径，列表窗口不携带
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
  status: string;
  retry_count: number;
  warnings: ProofreadingWarningCode[];
  warning_fragments_by_code: ProofreadingWarningFragmentsByCode;
  glossary_applications: GlossaryApplication[];
};

export type ProofreadingItemRecord = {
  item_id: number;
  file_path: string;
  file_order?: number;
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
  status: string;
  text_type: string;
  retry_count: number;
};

// 上下文视图只跨层传输连续阅读需要的字段，不携带列表警告和压缩投影。
export type ProofreadingContextItem = {
  row_id: string;
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
};

export type ProofreadingClientItem = ProofreadingItem & {
  row_id: string;
  compressed_src: string;
  compressed_dst: string;
};

export type ProofreadingVisibleItem = {
  row_id: string;
  item: ProofreadingClientItem;
  compressed_src: string;
  compressed_dst: string;
};

export type ProofreadingListView = {
  projectId: string;
  revisions: {
    files: number;
    items: number;
    quality: number;
    proofreading: number;
  };
  view_id: string;
  row_count: number;
  window_start: number;
  window_rows: ProofreadingVisibleItem[];
  invalid_regex_message: string | null;
};

export type ProofreadingFilterPanelTermEntry = {
  entry_id: string;
  src: string;
  dst: string;
  count: number;
};

export type ProofreadingFilterPanelState = {
  available_statuses: string[];
  status_count_by_code: Record<string, number>;
  available_warning_types: string[];
  warning_count_by_code: Record<string, number>;
  all_file_paths: string[];
  available_file_paths: string[];
  file_count_by_path: Record<string, number>;
  glossary_term_entries: ProofreadingFilterPanelTermEntry[];
  without_glossary_miss_count: number;
};

export type ProofreadingSearchScope = "all" | "src" | "dst";

/**
 * row id 是校对列表和后端 item id 的字符串桥接，统一在入口处归一。
 */
export function build_proofreading_row_id(item_id: number | string): string {
  return String(item_id);
}

/**
 * 术语展示为稳定文本，供筛选面板和弹窗复用。
 */
export function format_proofreading_glossary_term(term: { src: string; dst: string }): string {
  return `${term.src} -> ${term.dst}`;
}

/**
 * 状态排序先按固定业务顺序，未知状态统一排在末尾。
 */
export function resolve_proofreading_status_sort_rank(status: string): number {
  const known_index = PROOFREADING_STATUS_ORDER.indexOf(
    status as (typeof PROOFREADING_STATUS_ORDER)[number],
  );
  return known_index >= 0 ? known_index : PROOFREADING_STATUS_ORDER.length;
}

/**
 * 压缩多行文本，保证表格单元格不会被换行打散布局。
 */
export function compress_proofreading_text(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, " ↵ ");
}

/**
 * 筛选项克隆会复制 entry id 数组，避免页面局部修改污染缓存状态。
 */
export function clone_proofreading_filter_options(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    warning_types: [...filters.warning_types],
    statuses: [...filters.statuses],
    file_paths: [...filters.file_paths],
    glossary_entry_ids: [...filters.glossary_entry_ids],
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

/**
 * 默认警告筛选保留已知顺序，同时把运行时出现的新警告稳定追加。
 */
export function resolve_default_proofreading_warning_types(
  available_warning_types: string[],
): string[] {
  const known_warning_types: string[] = [...PROOFREADING_WARNING_FILTER_CODES];
  const known_warning_type_set = new Set<string>(known_warning_types);
  const extra_warning_types = unique_strings(available_warning_types)
    .filter((warning) => !known_warning_type_set.has(warning))
    .sort((left_warning, right_warning) => {
      return left_warning.localeCompare(right_warning, "zh-Hans-CN");
    });

  return [...known_warning_types, ...extra_warning_types];
}

function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 空列表视图用于运行态尚未同步或请求失效时的安全回退。
 */
export function create_empty_proofreading_list_view(): ProofreadingListView {
  return {
    projectId: "",
    revisions: {
      files: 0,
      items: 0,
      quality: 0,
      proofreading: 0,
    },
    view_id: "",
    row_count: 0,
    window_start: 0,
    window_rows: [],
    invalid_regex_message: null,
  };
}

/**
 * 空筛选面板保留无警告计数入口，避免 UI 需要特殊判断缺失字段。
 */
export function create_empty_proofreading_filter_panel_state(): ProofreadingFilterPanelState {
  return {
    available_statuses: [],
    status_count_by_code: {},
    available_warning_types: [],
    warning_count_by_code: {
      [PROOFREADING_NO_WARNING_CODE]: 0,
    },
    all_file_paths: [],
    available_file_paths: [],
    file_count_by_path: {},
    glossary_term_entries: [],
    without_glossary_miss_count: 0,
  };
}
