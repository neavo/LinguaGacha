// 筛选面板表示“无警告”的虚拟 warning。
export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

// 固定警告筛选的默认展示顺序。
export const PROOFREADING_WARNING_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  "KANA",
  "HANGEUL",
  "TEXT_PRESERVE",
  "SIMILARITY",
  "GLOSSARY",
  "RETRY_THRESHOLD",
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

// 状态码到 i18n key 的公开映射。
export const PROOFREADING_STATUS_LABEL_KEY_BY_CODE = {
  NONE: "proofreading_page.status.none",
  PROCESSED: "proofreading_page.status.processed",
  EXCLUDED: "proofreading_page.status.excluded",
  RULE_SKIPPED: "proofreading_page.status.rule_skipped",
  LANGUAGE_SKIPPED: "proofreading_page.status.non_target_source_language",
  DUPLICATED: "proofreading_page.status.duplicated",
  ERROR: "proofreading_page.status.error",
} as const;

export type ProofreadingManualStatusCode = (typeof PROOFREADING_MANUAL_STATUS_CODES)[number];

// 警告码到 i18n key 的公开映射。
export const PROOFREADING_WARNING_LABEL_KEY_BY_CODE = {
  KANA: "proofreading_page.warning.kana",
  HANGEUL: "proofreading_page.warning.hangeul",
  TEXT_PRESERVE: "proofreading_page.warning.text_preserve",
  SIMILARITY: "proofreading_page.warning.similarity",
  GLOSSARY: "proofreading_page.warning.glossary",
  RETRY_THRESHOLD: "proofreading_page.warning.retry_threshold",
  NO_WARNING: "proofreading_page.filter.no_warning",
} as const;

export type ProofreadingGlossaryTerm = readonly [string, string];

export type ProofreadingWarningFragmentsByCode = {
  KANA?: string[];
  HANGEUL?: string[];
  TEXT_PRESERVE?: string[];
};

export type ProofreadingFilterOptions = {
  warning_types: string[];
  statuses: string[];
  file_paths: string[];
  glossary_terms: ProofreadingGlossaryTerm[];
  include_without_glossary_miss: boolean;
};

export type ProofreadingItem = {
  item_id: number | string;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
  status: string;
  retry_count: number;
  warnings: string[];
  warning_fragments_by_code: ProofreadingWarningFragmentsByCode;
  applied_glossary_terms: ProofreadingGlossaryTerm[];
  failed_glossary_terms: ProofreadingGlossaryTerm[];
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
  term: ProofreadingGlossaryTerm;
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
 * 术语二元组展示为稳定文本，供筛选面板和弹窗复用。
 */
export function format_proofreading_glossary_term(term: ProofreadingGlossaryTerm): string {
  return `${term[0]} -> ${term[1]}`;
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
 * 筛选项克隆会复制术语 tuple，避免页面局部修改污染缓存状态。
 */
export function clone_proofreading_filter_options(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    warning_types: [...filters.warning_types],
    statuses: [...filters.statuses],
    file_paths: [...filters.file_paths],
    glossary_terms: filters.glossary_terms.map((term) => {
      return [term[0], term[1]] as const;
    }),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

/**
 * 默认警告筛选保留已知顺序，同时把运行时出现的新警告稳定追加。
 */
export function resolve_default_proofreading_warning_types(
  available_warning_types: string[],
): string[] {
  const known_warning_types: string[] = [...PROOFREADING_WARNING_CODES];
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
import type { ItemNameField } from "../../domain/item";
