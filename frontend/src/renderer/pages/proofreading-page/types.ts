export const PROOFREADING_NO_WARNING_CODE = "NO_WARNING" as const;

export const PROOFREADING_WARNING_CODES = [
  PROOFREADING_NO_WARNING_CODE,
  "KANA",
  "HANGEUL",
  "TEXT_PRESERVE",
  "SIMILARITY",
  "GLOSSARY",
  "RETRY_THRESHOLD",
] as const;

const PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES = [
  "NONE",
  "PROCESSING",
  "PROCESSED",
  "PROCESSED_IN_PAST",
  "ERROR",
] as const;

export const PROOFREADING_STATUS_ORDER = [
  "NONE",
  "PROCESSING",
  "PROCESSED",
  "PROCESSED_IN_PAST",
  "ERROR",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "RULE_SKIPPED",
  "DUPLICATED",
] as const;

export const PROOFREADING_STATUS_LABEL_KEY_BY_CODE = {
  NONE: "proofreading_page.status.none",
  PROCESSING: "proofreading_page.status.processing",
  PROCESSED: "proofreading_page.status.processed",
  PROCESSED_IN_PAST: "proofreading_page.status.processed_in_past",
  EXCLUDED: "proofreading_page.status.excluded",
  RULE_SKIPPED: "proofreading_page.status.rule_skipped",
  LANGUAGE_SKIPPED: "proofreading_page.status.non_target_source_language",
  DUPLICATED: "proofreading_page.status.duplicated",
  ERROR: "proofreading_page.status.error",
} as const;

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

export type ProofreadingSummary = {
  total_items: number;
  filtered_items: number;
  warning_items: number;
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
  warnings: string[];
  applied_glossary_terms: ProofreadingGlossaryTerm[];
  failed_glossary_terms: ProofreadingGlossaryTerm[];
};

export type ProofreadingClientItem = ProofreadingItem & {
  row_id: string;
  compressed_src: string;
  compressed_dst: string;
};

export type ProofreadingSnapshot = {
  revision: number;
  project_id: string;
  readonly: boolean;
  summary: ProofreadingSummary;
  filters: ProofreadingFilterOptions;
  items: ProofreadingClientItem[];
};

type ProofreadingMutationResult = {
  revision: number;
  changed_item_ids: Array<number | string>;
  items: ProofreadingClientItem[];
  summary: ProofreadingSummary;
};

export type ProofreadingVisibleItem = {
  row_id: string;
  item: ProofreadingClientItem;
  compressed_src: string;
  compressed_dst: string;
};

export type ProofreadingListView = {
  revision: number;
  project_id: string;
  summary: ProofreadingSummary;
  default_filters: ProofreadingFilterOptions;
  filters: ProofreadingFilterOptions;
  items: ProofreadingVisibleItem[];
  invalid_regex_message: string | null;
};

export type ProofreadingFilterPanelTermEntry = {
  term: ProofreadingGlossaryTerm;
  count: number;
};

export type ProofreadingFilterPanelState = {
  filters: ProofreadingFilterOptions;
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

type ProofreadingPayloadGlossaryTerm = ProofreadingGlossaryTerm | { src?: string; dst?: string };

type ProofreadingPayloadItem = Partial<ProofreadingItem> & {
  applied_glossary_terms?: ProofreadingPayloadGlossaryTerm[];
  failed_glossary_terms?: ProofreadingPayloadGlossaryTerm[];
};

export type ProofreadingMutationPayload = {
  result?: {
    revision?: number;
    changed_item_ids?: Array<number | string>;
    summary?: Partial<ProofreadingSummary>;
    items?: ProofreadingPayloadItem[];
  };
};

export type ProofreadingDialogState = {
  open: boolean;
  target_row_id: string | null;
  draft_dst: string;
  saving: boolean;
};

type ProofreadingPendingMutationKind = "replace-all" | "retranslate-items" | "reset-items";

export type ProofreadingSearchScope = "all" | "src" | "dst";

export type ProofreadingPendingMutation = {
  kind: ProofreadingPendingMutationKind;
  target_row_ids: string[];
};

export function build_proofreading_row_id(item_id: number | string): string {
  return String(item_id);
}

export function format_proofreading_glossary_term(term: ProofreadingGlossaryTerm): string {
  return `${term[0]} -> ${term[1]}`;
}

export function resolve_proofreading_status_sort_rank(status: string): number {
  const known_index = PROOFREADING_STATUS_ORDER.indexOf(
    status as (typeof PROOFREADING_STATUS_ORDER)[number],
  );
  return known_index >= 0 ? known_index : PROOFREADING_STATUS_ORDER.length;
}

export function compress_proofreading_text(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, " ↵ ");
}

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

export function create_empty_proofreading_summary(): ProofreadingSummary {
  return {
    total_items: 0,
    filtered_items: 0,
    warning_items: 0,
  };
}

export function resolve_proofreading_filter_source_items(
  items: ProofreadingItem[],
): ProofreadingItem[] {
  return [...items];
}

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

function normalize_proofreading_summary(
  summary: Partial<ProofreadingSummary> | undefined,
): ProofreadingSummary {
  return {
    total_items: Number(summary?.total_items ?? 0),
    filtered_items: Number(summary?.filtered_items ?? 0),
    warning_items: Number(summary?.warning_items ?? 0),
  };
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

function normalize_proofreading_item(
  item: Partial<ProofreadingItem> & {
    applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>;
    failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>;
  },
): ProofreadingClientItem {
  const normalized_item: ProofreadingItem = {
    item_id: item.item_id ?? 0,
    file_path: String(item.file_path ?? ""),
    row_number: Number(item.row_number ?? 0),
    src: String(item.src ?? ""),
    dst: String(item.dst ?? ""),
    status: String(item.status ?? ""),
    warnings: Array.isArray(item.warnings)
      ? unique_strings(item.warnings.map((warning) => String(warning)))
      : [],
    applied_glossary_terms: normalize_glossary_terms(item.applied_glossary_terms),
    failed_glossary_terms: normalize_glossary_terms(item.failed_glossary_terms),
  };

  return {
    ...normalized_item,
    row_id: build_proofreading_row_id(normalized_item.item_id),
    compressed_src: compress_proofreading_text(normalized_item.src),
    compressed_dst: compress_proofreading_text(normalized_item.dst),
  };
}

function normalize_proofreading_items(
  items:
    | Array<
        Partial<ProofreadingItem> & {
          applied_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>;
          failed_glossary_terms?: Array<ProofreadingGlossaryTerm | { src?: string; dst?: string }>;
        }
      >
    | undefined,
): ProofreadingClientItem[] {
  return Array.isArray(items) ? items.map((item) => normalize_proofreading_item(item)) : [];
}

export function normalize_proofreading_mutation_payload(
  payload: ProofreadingMutationPayload,
): ProofreadingMutationResult {
  const result = payload.result ?? {};
  const items = normalize_proofreading_items(result.items);
  return {
    revision: Number(result.revision ?? 0),
    changed_item_ids: Array.isArray(result.changed_item_ids) ? result.changed_item_ids : [],
    items,
    summary: normalize_proofreading_summary(result.summary),
  };
}

export function create_empty_proofreading_snapshot(): ProofreadingSnapshot {
  return {
    revision: 0,
    project_id: "",
    readonly: false,
    summary: create_empty_proofreading_summary(),
    filters: {
      warning_types: [],
      statuses: [],
      file_paths: [],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
    items: [],
  };
}

export function create_empty_proofreading_list_view(): ProofreadingListView {
  return {
    revision: 0,
    project_id: "",
    summary: create_empty_proofreading_summary(),
    default_filters: {
      warning_types: [],
      statuses: [],
      file_paths: [],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
    filters: {
      warning_types: [],
      statuses: [],
      file_paths: [],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
    items: [],
    invalid_regex_message: null,
  };
}

export function create_empty_proofreading_filter_panel_state(): ProofreadingFilterPanelState {
  return {
    filters: {
      warning_types: [],
      statuses: [],
      file_paths: [],
      glossary_terms: [],
      include_without_glossary_miss: true,
    },
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
