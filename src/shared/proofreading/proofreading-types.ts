import type { ItemNameField } from "../../domain/item";
import type { GlossaryApplication } from "../quality/glossary";

// 筛选面板表示“无警告”的虚拟 warning。
export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

// 真实校对警告的唯一词表。
export const PROOFREADING_WARNING_CODES = [
  "FOREIGN_CHAR_RESIDUE",
  "SIMILARITY",
  "LINE_COUNT_MISMATCH",
  "GLOSSARY",
  "TEXT_PRESERVE",
  "RETRY_THRESHOLD",
] as const;

export type ProofreadingWarningCode = (typeof PROOFREADING_WARNING_CODES)[number];

// 只有携带可定位文本片段的 warning 才进入证据字段词表。
export const PROOFREADING_WARNING_FRAGMENT_CODES = [
  "FOREIGN_CHAR_RESIDUE",
  "TEXT_PRESERVE",
] as const satisfies readonly ProofreadingWarningCode[];

export type ProofreadingWarningFragmentCode = (typeof PROOFREADING_WARNING_FRAGMENT_CODES)[number];

export type ProofreadingWarningSummaryEntry = {
  code: ProofreadingWarningCode; // 真实 warning 类型
  count: number; // 命中该 warning 的不同成功译文条目数
};

export type ProofreadingWarningSummary = {
  total_count: number; // entries count 之和，同一条目命中多类时分别计数
  entries: ProofreadingWarningSummaryEntry[]; // 按 PROOFREADING_WARNING_CODES 顺序返回非零类型
};

// 翻译成功分组包含真实检查项和“无警告”集合项。
export const PROOFREADING_TRANSLATED_OUTCOME_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  ...PROOFREADING_WARNING_CODES,
] as const;

// 分组定义统一提供显示顺序、默认选择和组内结果词表。
export const PROOFREADING_OUTCOME_GROUPS = [
  {
    code: "translated",
    selected_by_default: true,
    outcome_codes: [...PROOFREADING_TRANSLATED_OUTCOME_CODES],
  },
  {
    code: "unfinished",
    selected_by_default: true,
    outcome_codes: ["ERROR", "NONE"],
  },
  {
    code: "not_required",
    selected_by_default: false,
    outcome_codes: ["EXCLUDED", "DUPLICATED", "RULE_SKIPPED", "LANGUAGE_SKIPPED"],
  },
] as const;

// 运行时可能出现尚未进入内置词表的新检查结果，因此公开筛选值保留字符串扩展点。
export type ProofreadingOutcomeCode = string;

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

export type ProofreadingWarningFragmentsByCode = Partial<
  Record<ProofreadingWarningFragmentCode, string[]>
>;

export type ProofreadingFilterOptions = {
  outcomes: ProofreadingOutcomeCode[];
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
  available_outcomes: ProofreadingOutcomeCode[];
  outcome_count_by_code: Record<string, number>;
  all_file_paths: string[];
  available_file_paths: string[];
  file_count_by_path: Record<string, number>;
  glossary_term_entries: ProofreadingFilterPanelTermEntry[];
  without_glossary_miss_count: number;
};

export type ProofreadingSearchScope = "all" | "src" | "dst";

/**
 * 把条目投影为用户可选择的结果集合；成功条目可同时命中多个检查项。
 */
export function resolve_proofreading_outcomes(item: {
  status: string;
  warnings: string[];
}): ProofreadingOutcomeCode[] {
  if (item.status === "PROCESSED") {
    return item.warnings.length > 0 ? [...new Set(item.warnings)] : [PROOFREADING_NO_WARNING_CODE];
  }

  return [item.status];
}

/** 汇总成功译文的真实 warning；总数按各类型命中数求和。 */
export function build_proofreading_warning_summary(
  items: readonly Pick<ProofreadingItem, "status" | "warnings">[],
): ProofreadingWarningSummary {
  const count_by_code = new Map<ProofreadingWarningCode, number>();
  items.forEach((item) => {
    if (item.status !== "PROCESSED") {
      return;
    }
    new Set(item.warnings).forEach((code) => {
      count_by_code.set(code, (count_by_code.get(code) ?? 0) + 1);
    });
  });
  const entries = PROOFREADING_WARNING_CODES.flatMap((code) => {
    const count = count_by_code.get(code) ?? 0;
    return count === 0 ? [] : [{ code, count }];
  });
  return {
    total_count: entries.reduce((total, entry) => total + entry.count, 0),
    entries,
  };
}

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
    outcomes: [...filters.outcomes],
    file_paths: [...filters.file_paths],
    glossary_entry_ids: [...filters.glossary_entry_ids],
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

/**
 * 空筛选值是跨后端与 renderer 共用的缺省载荷，集中构造以保持协议形状一致。
 */
export function create_empty_proofreading_filter_options(): ProofreadingFilterOptions {
  return {
    outcomes: [],
    file_paths: [],
    glossary_entry_ids: [],
    include_without_glossary_miss: true,
  };
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
 * 空筛选面板保持完整结果形状，UI 可直接消费统一协议。
 */
export function create_empty_proofreading_filter_panel_state(): ProofreadingFilterPanelState {
  return {
    available_outcomes: [],
    outcome_count_by_code: {},
    all_file_paths: [],
    available_file_paths: [],
    file_count_by_path: {},
    glossary_term_entries: [],
    without_glossary_miss_count: 0,
  };
}
