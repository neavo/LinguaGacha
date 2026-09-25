import type { ItemNameField } from "../../domain/item";
import type { GlossaryApplication } from "../quality/glossary";
import type { PDFPageTranslation } from "../pdf";

// 筛选面板表示“无警告”的虚拟 warning。
export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

// 真实校对警告的唯一词表。
export const PROOFREADING_WARNING_CODES = [
  "FOREIGN_CHAR_RESIDUE",
  "SIMILARITY",
  "LINE_COUNT_MISMATCH",
  "GLOSSARY",
  "TEXT_PRESERVE",
  "PUNCTUATION_MISMATCH",
  "RETRY_THRESHOLD",
] as const;

export type ProofreadingWarningCode = (typeof PROOFREADING_WARNING_CODES)[number];

/** 警告与字段、证据一起传递；正文专属规则和条目级规则在类型上限定范围。 */
export type ProofreadingWarning =
  | {
      code: "FOREIGN_CHAR_RESIDUE";
      target_field: "dst" | "name_dst";
      fragments: string[];
    }
  | {
      code: "TEXT_PRESERVE";
      target_field: "dst" | "name_dst";
      source_fragments: string[];
      translation_fragments: string[];
    }
  | { code: "PUNCTUATION_MISMATCH" | "GLOSSARY"; target_field: "dst" | "name_dst" }
  | { code: "SIMILARITY" | "LINE_COUNT_MISMATCH"; target_field: "dst" }
  | { code: "RETRY_THRESHOLD"; target_field: null };

/** 列表、筛选和统计按条目去重，并沿用统一的规则顺序。 */
export function read_proofreading_warning_codes(
  warnings: readonly ProofreadingWarning[],
): ProofreadingWarningCode[] {
  const codes = new Set(warnings.map((warning) => warning.code));
  return PROOFREADING_WARNING_CODES.filter((code) => codes.has(code));
}

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

// 文本与页面的筛选分组统一提供显示顺序、默认选择和组内结果词表。
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

// 文本和页面共用列表状态与排序。
export const PROOFREADING_STATUS_ORDER = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "RULE_SKIPPED",
  "DUPLICATED",
] as const;

export type ProofreadingFilterOptions = {
  outcomes: ProofreadingOutcomeCode[];
  files: ProofreadingFileSelection;
  glossary_entry_ids: string[];
  include_without_glossary_miss: boolean;
};

export type ProofreadingItem = ProofreadingFileRef & {
  item_id: number | string;
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
  status: string;
  retry_count: number;
  warnings: ProofreadingWarning[];
  glossary_applications: GlossaryApplication[];
};

export type ProofreadingItemRecord = ProofreadingFileRef & {
  item_id: number;
  row_number: number;
  src: string;
  dst: string;
  name_src: ItemNameField;
  name_dst: ItemNameField;
  status: string;
  text_type: string;
  retry_count: number;
};

/** worker 只返回计算事实，原始字段由发起计算时的不可变快照提供。 */
export type ProofreadingEvaluation = Pick<ProofreadingItem, "warnings" | "glossary_applications">;

/** 单条运行态同时拥有原始字段和评估结果，不保存展示文本副本。 */
export type ProofreadingEvaluatedItem = ProofreadingItemRecord & ProofreadingEvaluation;

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
  kind: "item";
  row_id: string;
  item: ProofreadingClientItem;
  compressed_src: string;
  compressed_dst: string;
};

export type ProofreadingPageSummary = {
  file_path: string;
  page: number;
  status: "NONE" | "PROCESSED" | "RULE_SKIPPED" | "EXCLUDED";
};

export type ProofreadingRow =
  | ProofreadingVisibleItem
  | {
      kind: "page";
      row_id: string;
      page: ProofreadingPageSummary;
    };

/** 原始路径共同确定叶子身份，null 仅表示内容没有内部路径。 */
export type ProofreadingFileRef = Readonly<{
  file_path: string;
  internal_file_path: string | null;
}>;

export type ProofreadingFileSelection =
  | { mode: "default" }
  | { mode: "selected"; values: readonly ProofreadingFileRef[] };

export type ProofreadingFile = ProofreadingFileRef & { kind: "item" | "page"; count: number };

/** 使用二元组隔离容器与内部路径，原始分隔符不参与身份归一。 */
export function build_proofreading_file_key(file: ProofreadingFileRef): string {
  return JSON.stringify([file.file_path, file.internal_file_path]);
}

/** 跨层快照隔离选择数组和引用对象，默认意图保持紧凑。 */
export function clone_proofreading_file_selection(
  selection: ProofreadingFileSelection,
): ProofreadingFileSelection {
  return selection.mode === "default"
    ? { mode: "default" }
    : {
        mode: "selected",
        values: selection.values.map((file) => ({
          file_path: file.file_path,
          internal_file_path: file.internal_file_path,
        })),
      };
}

/** 页面身份按路径和原页编码，不能转换成文本写入 ID。 */
export function build_proofreading_page_row_id(file_path: string, page: number): string {
  return `page:${JSON.stringify([file_path, page])}`;
}

/** 用页面命名空间隔离文本写入入口，包含未加载的选区行。 */
export function is_proofreading_page_row_id(row_id: string): boolean {
  return row_id.startsWith("page:");
}

/** 校对展示直接映射原页处置，空正文沿用已翻译状态。 */
export function proofreading_page_status(
  translation: PDFPageTranslation,
): ProofreadingPageSummary["status"] {
  if (translation === null) return "NONE";
  if (translation.kind === "translate") return "PROCESSED";
  return translation.kind === "keep" ? "RULE_SKIPPED" : "EXCLUDED";
}

export type ProofreadingListView = {
  projectId: string;
  revisions: {
    files: number;
    items: number;
    quality: number;
    proofreading: number;
    pdf?: number;
  };
  view_id: string;
  row_count: number;
  window_start: number;
  window_rows: ProofreadingRow[];
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
  glossary_term_entries: ProofreadingFilterPanelTermEntry[];
  without_glossary_miss_count: number;
};

export type ProofreadingSearchScope = "all" | "src" | "dst";

/**
 * 把条目投影为用户可选择的结果集合；成功条目可同时命中多个检查项。
 */
export function resolve_proofreading_outcomes(item: {
  status: string;
  warnings: readonly ProofreadingWarning[];
}): ProofreadingOutcomeCode[] {
  if (item.status === "PROCESSED") {
    return item.warnings.length > 0
      ? read_proofreading_warning_codes(item.warnings)
      : [PROOFREADING_NO_WARNING_CODE];
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
    read_proofreading_warning_codes(item.warnings).forEach((code) => {
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
    files: clone_proofreading_file_selection(filters.files),
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
    files: { mode: "selected", values: [] },
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
    glossary_term_entries: [],
    without_glossary_miss_count: 0,
  };
}

export type ProofreadingPagePreviewResult = {
  image?: string;
  count?: number;
  page?: number;
};
