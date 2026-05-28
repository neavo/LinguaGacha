// PROOFREADING_NO_WARNING_CODE 是筛选面板表示“无警告”的虚拟 warning。
export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

// PROOFREADING_WARNING_CODES 固定警告筛选的默认展示顺序。
export const PROOFREADING_WARNING_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  "KANA",
  "HANGEUL",
  "TEXT_PRESERVE",
  "SIMILARITY",
  "GLOSSARY",
  "RETRY_THRESHOLD",
] as const;

const PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES = ["NONE", "PROCESSED", "ERROR"] as const;

// PROOFREADING_MANUAL_STATUS_CODES 是设置翻译状态菜单的唯一状态词表。
export const PROOFREADING_MANUAL_STATUS_CODES = ["NONE", "PROCESSED", "EXCLUDED"] as const;

// PROOFREADING_STATUS_ORDER 同时服务排序和默认状态筛选。
export const PROOFREADING_STATUS_ORDER = [
  "NONE",
  "PROCESSED",
  "ERROR",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "RULE_SKIPPED",
  "DUPLICATED",
] as const;

// PROOFREADING_STATUS_LABEL_KEY_BY_CODE 是状态码到 i18n key 的公开映射。
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

// PROOFREADING_WARNING_LABEL_KEY_BY_CODE 是警告码到 i18n key 的公开映射。
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
  status: string;
  retry_count: number;
  warnings: string[];
  warning_fragments_by_code: ProofreadingWarningFragmentsByCode;
  applied_glossary_terms: ProofreadingGlossaryTerm[];
  failed_glossary_terms: ProofreadingGlossaryTerm[];
};

export type ProofreadingRuntimeItemRecord = {
  item_id: number;
  file_path: string;
  file_order?: number;
  row_number: number;
  src: string;
  dst: string;
  status: string;
  text_type: string;
  retry_count: number;
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

export type ProofreadingDialogState = {
  open: boolean;
  target_row_id: string | null;
  draft_dst: string;
  saving: boolean;
};

export type ProofreadingSearchScope = "all" | "src" | "dst";

export type ProofreadingConfirmationKind = "retranslate" | "clear-translations";

export type ProofreadingPendingConfirmation = {
  kind: ProofreadingConfirmationKind; // 只有高风险操作进入确认流，状态设置走直接提交。
  target_row_ids: string[];
  preferred_row_id: string | null;
  submitting: boolean;
};

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

function resolve_proofreading_filter_source_items(items: ProofreadingItem[]): ProofreadingItem[] {
  return [...items];
}

/**
 * 默认状态筛选固定展示可操作状态，只有没有默认集合时才回退到可用状态。
 */
export function resolve_default_proofreading_statuses(available_statuses: string[]): string[] {
  const ordered_default_statuses = PROOFREADING_STATUS_ORDER.filter((status) => {
    return PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES.includes(
      status as (typeof PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES)[number],
    );
  });
  const extra_default_statuses = PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES.filter((status) => {
    return !PROOFREADING_STATUS_ORDER.includes(status);
  });

  return ordered_default_statuses.length > 0 || extra_default_statuses.length > 0
    ? [...ordered_default_statuses, ...extra_default_statuses]
    : available_statuses;
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

function normalize_glossary_terms(
  glossary_terms: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }> | undefined,
): ProofreadingGlossaryTerm[] {
  if (!Array.isArray(glossary_terms)) {
    return [];
  }

  return glossary_terms
    .map((term) => {
      if (Array.isArray(term) && term.length >= 2) {
        return [String(term[0] ?? ""), String(term[1] ?? "")] as const;
      }

      if (typeof term === "object" && term !== null && !Array.isArray(term)) {
        const term_record = term as { src?: string; dst?: string };
        return [String(term_record.src ?? ""), String(term_record.dst ?? "")] as const;
      }

      return null;
    })
    .filter((term): term is ProofreadingGlossaryTerm => {
      return term !== null && (term[0] !== "" || term[1] !== "");
    });
}

function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

function build_default_proofreading_filter_options(
  items: ProofreadingItem[],
): ProofreadingFilterOptions {
  const source_items = resolve_proofreading_filter_source_items(items);
  const available_statuses = unique_strings(source_items.map((item) => item.status));
  const available_warning_types = new Set<string>([PROOFREADING_NO_WARNING_CODE]);
  const available_file_paths = new Set<string>();
  const available_glossary_terms = new Map<string, ProofreadingGlossaryTerm>();

  source_items.forEach((item) => {
    available_file_paths.add(item.file_path);

    if (item.warnings.length === 0) {
      available_warning_types.add(PROOFREADING_NO_WARNING_CODE);
    } else {
      item.warnings.forEach((warning) => {
        available_warning_types.add(warning);
      });
    }

    item.failed_glossary_terms.forEach((term) => {
      available_glossary_terms.set(`${term[0]}→${term[1]}`, term);
    });
  });

  return {
    warning_types: resolve_default_proofreading_warning_types([...available_warning_types]),
    statuses: resolve_default_proofreading_statuses(available_statuses),
    file_paths: [...available_file_paths],
    glossary_terms: [...available_glossary_terms.values()],
    include_without_glossary_miss: true,
  };
}

/**
 * 归一化页面传入筛选项，缺失字段由当前 item 集合派生默认值。
 */
export function normalize_proofreading_filter_options(
  filters: Partial<ProofreadingFilterOptions> | undefined,
  items: ProofreadingItem[],
): ProofreadingFilterOptions {
  const fallback_filters = build_default_proofreading_filter_options(items);
  const has_warning_types = Array.isArray(filters?.warning_types);
  const has_statuses = Array.isArray(filters?.statuses);
  const has_file_paths = Array.isArray(filters?.file_paths);
  const has_glossary_terms = Array.isArray(filters?.glossary_terms);
  const has_include_without_glossary_miss =
    typeof filters?.include_without_glossary_miss === "boolean";
  const warning_types = has_warning_types
    ? unique_strings((filters?.warning_types ?? []).map((value) => String(value)))
    : [];
  const statuses = has_statuses
    ? unique_strings((filters?.statuses ?? []).map((value) => String(value)))
    : [];
  const file_paths = has_file_paths
    ? unique_strings((filters?.file_paths ?? []).map((value) => String(value)))
    : [];
  const glossary_terms = has_glossary_terms
    ? normalize_glossary_terms(filters?.glossary_terms)
    : [];

  return {
    warning_types: has_warning_types ? warning_types : fallback_filters.warning_types,
    statuses: has_statuses ? statuses : fallback_filters.statuses,
    file_paths: has_file_paths ? file_paths : fallback_filters.file_paths,
    glossary_terms: has_glossary_terms ? glossary_terms : fallback_filters.glossary_terms,
    include_without_glossary_miss: has_include_without_glossary_miss
      ? Boolean(filters?.include_without_glossary_miss)
      : fallback_filters.include_without_glossary_miss,
  };
}

/**
 * 空列表 view 用于运行态尚未 hydrate 或请求失效时的安全回退。
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
