import type { ProjectStoreQualityState } from "@/app/project-runtime/project-store";
import {
  PROOFREADING_NO_WARNING_CODE,
  PROOFREADING_STATUS_ORDER,
  PROOFREADING_WARNING_CODES,
  build_proofreading_row_id,
  clone_proofreading_filter_options,
  compress_proofreading_text,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  normalize_proofreading_filter_options,
  resolve_proofreading_status_sort_rank,
  type ProofreadingClientItem,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingFilterPanelTermEntry,
  type ProofreadingGlossaryTerm,
  type ProofreadingListView,
  type ProofreadingSearchScope,
  type ProofreadingVisibleItem,
} from "@/pages/proofreading-page/types";
import { TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE } from "@/pages/proofreading-page/text-preserve-smart-patterns";
import type { AppTableSortState } from "@/widgets/app-table/app-table-types";

const PROOFREADING_SIMILARITY_THRESHOLD = 0.8;
const PROOFREADING_RETRY_THRESHOLD = 2;
const PROOFREADING_SKIPPED_WARNING_STATUSES = new Set([
  "NONE",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "DUPLICATED",
]);
const PROOFREADING_REVIEW_EXCLUDED_STATUSES = new Set(["DUPLICATED", "RULE_SKIPPED"]);
const PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES = new Set([
  "NONE",
  "PROCESSED",
  "ERROR",
  "PROCESSED_IN_PAST",
]);
const HIRAGANA_REGEX = /[\u3040-\u309F]/u;
const KATAKANA_REGEX = /[\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/u;
const HANGEUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/u;

type ProofreadingRuntimeGlossaryEntry = {
  src: string;
  dst: string;
};

export type ProofreadingRuntimeItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  status: string;
  text_type: string;
  retry_count: number;
};

export type ProofreadingRuntimeHydrationInput = {
  project_id: string;
  revision: number;
  total_item_count: number;
  items: ProofreadingRuntimeItemRecord[];
  quality: ProjectStoreQualityState;
  source_language: string;
};

export type ProofreadingRuntimeDeltaInput = {
  project_id: string;
  revision: number;
  total_item_count: number;
  items: ProofreadingRuntimeItemRecord[];
};

export type ProofreadingListViewQuery = {
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
};

export type ProofreadingFilterPanelQuery = {
  filters: ProofreadingFilterOptions;
};

export type ProofreadingRuntimeSyncState = {
  revision: number;
  project_id: string;
  total_item_count: number;
  review_item_count: number;
  warning_item_count: number;
  default_filters: ProofreadingFilterOptions;
};

type ProofreadingRuntimeState = {
  project_id: string;
  revision: number;
  total_item_count: number;
  quality: ProjectStoreQualityState;
  source_language: string;
  raw_item_by_id: Map<string, ProofreadingRuntimeItemRecord>;
  natural_item_ids: string[];
  evaluated_item_by_id: Map<string, ProofreadingClientItem>;
  status_count_by_code: Map<string, number>;
  warning_count_by_code: Map<string, number>;
  file_count_by_path: Map<string, number>;
  glossary_term_count_map: Map<string, ProofreadingFilterPanelTermEntry>;
  review_item_count: number;
  warning_item_count: number;
  default_filters: ProofreadingFilterOptions;
};

type ProofreadingFilterDimension = "warning_types" | "statuses" | "file_paths" | "glossary_terms";

const PROOFREADING_NATURAL_SORT_STATE: AppTableSortState = {
  column_id: "file",
  direction: "ascending",
};

function compare_text(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hans-CN");
}

function normalize_sort_direction(direction: "ascending" | "descending"): number {
  return direction === "ascending" ? 1 : -1;
}

function compare_runtime_items(
  left_item: ProofreadingRuntimeItemRecord,
  right_item: ProofreadingRuntimeItemRecord,
): number {
  const file_result = compare_text(left_item.file_path, right_item.file_path);
  if (file_result !== 0) {
    return file_result;
  }

  const row_result = left_item.row_number - right_item.row_number;
  if (row_result !== 0) {
    return row_result;
  }

  return left_item.item_id - right_item.item_id;
}

function compare_visible_items(
  left_item: ProofreadingClientItem,
  right_item: ProofreadingClientItem,
  sort_state: AppTableSortState,
): number {
  const direction = normalize_sort_direction(sort_state.direction);

  if (sort_state.column_id === "file") {
    const file_path_result = compare_text(left_item.file_path, right_item.file_path);
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

    return compare_text(left_item.status, right_item.status) * direction;
  }

  if (sort_state.column_id === "src") {
    return compare_text(left_item.src, right_item.src) * direction;
  }

  if (sort_state.column_id === "dst") {
    return compare_text(left_item.dst, right_item.dst) * direction;
  }

  return 0;
}

function sort_visible_items(
  items: ProofreadingClientItem[],
  sort_state: AppTableSortState | null,
): ProofreadingClientItem[] {
  const effective_sort_state = sort_state ?? PROOFREADING_NATURAL_SORT_STATE;

  return [...items].sort((left_item, right_item) => {
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

    return compare_text(left_item.row_id, right_item.row_id);
  });
}

function normalize_regex_pattern_for_javascript(pattern: string): string {
  return pattern.replace(/\\U([0-9a-fA-F]{8})/gu, (_match, hex: string) => {
    return `\\u{${hex.replace(/^0+/, "") || "0"}}`;
  });
}

function create_global_regex(pattern: string): RegExp | null {
  try {
    return new RegExp(normalize_regex_pattern_for_javascript(pattern), "giu");
  } catch {
    return null;
  }
}

function escape_regular_expression(source_text: string): string {
  return source_text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function create_search_pattern(keyword: string, is_regex: boolean): RegExp | null {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return null;
  }

  if (is_regex) {
    return new RegExp(normalized_keyword, "iu");
  }

  return new RegExp(escape_regular_expression(normalized_keyword), "iu");
}

function matches_search_pattern(
  text: string,
  search_pattern: RegExp | null,
  keyword: string,
  is_regex: boolean,
): boolean {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return true;
  }

  if (search_pattern === null) {
    return true;
  }

  if (is_regex) {
    return search_pattern.test(text);
  }

  return text.toLocaleLowerCase().includes(normalized_keyword.toLocaleLowerCase());
}

function matches_proofreading_search_scope(args: {
  item: ProofreadingClientItem;
  search_pattern: RegExp | null;
  keyword: string;
  is_regex: boolean;
  scope: ProofreadingSearchScope;
}): boolean {
  if (args.scope === "src") {
    return matches_search_pattern(args.item.src, args.search_pattern, args.keyword, args.is_regex);
  }

  if (args.scope === "dst") {
    return matches_search_pattern(args.item.dst, args.search_pattern, args.keyword, args.is_regex);
  }

  return (
    matches_search_pattern(args.item.src, args.search_pattern, args.keyword, args.is_regex) ||
    matches_search_pattern(args.item.dst, args.search_pattern, args.keyword, args.is_regex)
  );
}

function normalize_runtime_item(record: unknown): ProofreadingRuntimeItemRecord | null {
  if (typeof record !== "object" || record === null) {
    return null;
  }

  const candidate = record as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id)) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    status: String(candidate.status ?? ""),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

function create_text_preserve_regex(args: {
  mode: string;
  text_type: string;
  entries: Array<Record<string, unknown>>;
}): RegExp | null {
  if (args.mode === "off") {
    return null;
  }

  const raw_patterns =
    args.mode === "custom"
      ? args.entries.flatMap((entry) => {
          const pattern = String(entry.src ?? "").trim();
          return pattern === "" ? [] : [pattern];
        })
      : [
          ...(TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[
            (args.text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE
              ? args.text_type
              : "NONE") as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE
          ] ?? TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE.NONE),
        ];

  const valid_patterns = raw_patterns.flatMap((pattern) => {
    return create_global_regex(pattern) === null
      ? []
      : [`(?:${normalize_regex_pattern_for_javascript(pattern)})`];
  });
  if (valid_patterns.length === 0) {
    return null;
  }

  return create_global_regex(valid_patterns.join("|"));
}

function strip_preserved_segments(text: string, sample_regex: RegExp | null): string {
  if (sample_regex === null) {
    return text;
  }

  return text.replace(sample_regex, "");
}

function collect_non_blank_preserved_segments(text: string, sample_regex: RegExp | null): string[] {
  if (sample_regex === null) {
    return [];
  }

  const segments: string[] = [];
  for (const match of text.matchAll(sample_regex)) {
    const segment = match[0]?.replace(/\s+/gu, "") ?? "";
    if (segment !== "") {
      segments.push(segment);
    }
  }
  return segments;
}

function replace_all_literal(text: string, search_text: string, replace_text: string): string {
  if (search_text === "") {
    return text;
  }

  return text.split(search_text).join(replace_text);
}

function apply_quality_replacements(
  item: ProofreadingRuntimeItemRecord,
  quality: ProjectStoreQualityState,
): { src_replaced: string; dst_replaced: string } {
  let src_replaced = item.src;
  let dst_replaced = item.dst;

  if (quality.pre_replacement.enabled) {
    for (const entry of quality.pre_replacement.entries) {
      const search_text = String(entry.src ?? "");
      const replace_text = String(entry.dst ?? "");
      src_replaced = replace_all_literal(src_replaced, search_text, replace_text);
    }
  }

  if (quality.post_replacement.enabled) {
    for (const entry of quality.post_replacement.entries) {
      const search_text = String(entry.dst ?? "");
      const replace_text = String(entry.src ?? "");
      dst_replaced = replace_all_literal(dst_replaced, search_text, replace_text);
    }
  }

  return {
    src_replaced,
    dst_replaced,
  };
}

function build_glossary_entries(
  quality: ProjectStoreQualityState,
): ProofreadingRuntimeGlossaryEntry[] {
  if (!quality.glossary.enabled) {
    return [];
  }

  return quality.glossary.entries.flatMap((entry) => {
    const src = String(entry.src ?? "").trim();
    const dst = String(entry.dst ?? "");
    return src === "" ? [] : [{ src, dst }];
  });
}

function partition_glossary_terms(args: {
  glossary_entries: ProofreadingRuntimeGlossaryEntry[];
  src_replaced: string;
  dst_replaced: string;
}): {
  failed_terms: ProofreadingGlossaryTerm[];
  applied_terms: ProofreadingGlossaryTerm[];
} {
  const failed_terms: ProofreadingGlossaryTerm[] = [];
  const applied_terms: ProofreadingGlossaryTerm[] = [];

  for (const entry of args.glossary_entries) {
    if (!args.src_replaced.includes(entry.src)) {
      continue;
    }

    const term = [entry.src, entry.dst] as const;
    if (entry.dst !== "" && args.dst_replaced.includes(entry.dst)) {
      applied_terms.push(term);
    } else {
      failed_terms.push(term);
    }
  }

  return {
    failed_terms,
    applied_terms,
  };
}

function has_similarity_error(args: {
  src_replaced: string;
  dst_replaced: string;
  sample_regex: RegExp | null;
}): boolean {
  const src = strip_preserved_segments(args.src_replaced, args.sample_regex).trim();
  const dst = strip_preserved_segments(args.dst_replaced, args.sample_regex).trim();
  if (src === "" || dst === "") {
    return false;
  }

  if (src.includes(dst) || dst.includes(src)) {
    return true;
  }

  const left_set = new Set(src);
  const right_set = new Set(dst);
  const union_size = new Set([...left_set, ...right_set]).size;
  if (union_size === 0) {
    return false;
  }

  let intersection_size = 0;
  for (const value of left_set) {
    if (right_set.has(value)) {
      intersection_size += 1;
    }
  }

  return intersection_size / union_size > PROOFREADING_SIMILARITY_THRESHOLD;
}

function create_proofreading_client_item(args: {
  item: ProofreadingRuntimeItemRecord;
  warnings: string[];
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
    warnings: [...args.warnings],
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

function evaluate_proofreading_item(args: {
  item: ProofreadingRuntimeItemRecord;
  glossary_entries: ProofreadingRuntimeGlossaryEntry[];
  quality: ProjectStoreQualityState;
  source_language: string;
  sample_regex_cache: Map<string, RegExp | null>;
}): ProofreadingClientItem | null {
  if (args.item.src.trim() === "" || PROOFREADING_REVIEW_EXCLUDED_STATUSES.has(args.item.status)) {
    return null;
  }

  const warnings: string[] = [];
  const failed_terms: ProofreadingGlossaryTerm[] = [];
  const applied_terms: ProofreadingGlossaryTerm[] = [];
  const sample_regex_cache_key = `${args.item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`;
  let sample_regex = args.sample_regex_cache.get(sample_regex_cache_key);
  if (sample_regex === undefined) {
    sample_regex = create_text_preserve_regex({
      mode: args.quality.text_preserve.mode,
      text_type: args.item.text_type,
      entries: args.quality.text_preserve.entries,
    });
    args.sample_regex_cache.set(sample_regex_cache_key, sample_regex);
  }

  if (PROOFREADING_SKIPPED_WARNING_STATUSES.has(args.item.status) || args.item.dst === "") {
    return create_proofreading_client_item({
      item: args.item,
      warnings,
      failed_terms,
      applied_terms,
    });
  }

  const { src_replaced, dst_replaced } = apply_quality_replacements(args.item, args.quality);
  const normalized_dst = strip_preserved_segments(args.item.dst, sample_regex);
  if (
    args.source_language === "JA" &&
    (HIRAGANA_REGEX.test(normalized_dst) || KATAKANA_REGEX.test(normalized_dst))
  ) {
    warnings.push("KANA");
  }

  if (args.source_language === "KO" && HANGEUL_REGEX.test(normalized_dst)) {
    warnings.push("HANGEUL");
  }

  if (
    collect_non_blank_preserved_segments(src_replaced, sample_regex).join("\u0000") !==
    collect_non_blank_preserved_segments(dst_replaced, sample_regex).join("\u0000")
  ) {
    warnings.push("TEXT_PRESERVE");
  }

  if (
    has_similarity_error({
      src_replaced,
      dst_replaced,
      sample_regex,
    })
  ) {
    warnings.push("SIMILARITY");
  }

  if (args.glossary_entries.length > 0) {
    const glossary_result = partition_glossary_terms({
      glossary_entries: args.glossary_entries,
      src_replaced,
      dst_replaced,
    });
    failed_terms.push(...glossary_result.failed_terms);
    applied_terms.push(...glossary_result.applied_terms);
    if (glossary_result.failed_terms.length > 0) {
      warnings.push("GLOSSARY");
    }
  }

  if (args.item.retry_count >= PROOFREADING_RETRY_THRESHOLD) {
    warnings.push("RETRY_THRESHOLD");
  }

  return create_proofreading_client_item({
    item: args.item,
    warnings,
    failed_terms,
    applied_terms,
  });
}

function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`;
}

function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

function clone_glossary_term(term: ProofreadingGlossaryTerm): ProofreadingGlossaryTerm {
  return [term[0], term[1]] as const;
}

function normalize_runtime_filter_options(args: {
  filters: Partial<ProofreadingFilterOptions> | undefined;
  default_filters: ProofreadingFilterOptions;
}): ProofreadingFilterOptions {
  const filters = args.filters;
  const has_warning_types = Array.isArray(filters?.warning_types);
  const has_statuses = Array.isArray(filters?.statuses);
  const has_file_paths = Array.isArray(filters?.file_paths);
  const has_glossary_terms = Array.isArray(filters?.glossary_terms);
  const has_include_without_glossary_miss =
    typeof filters?.include_without_glossary_miss === "boolean";

  const glossary_terms = has_glossary_terms
    ? unique_strings(
        (filters?.glossary_terms ?? []).flatMap((term) => {
          if (!Array.isArray(term) || term.length < 2) {
            return [];
          }

          return [build_glossary_term_key([String(term[0] ?? ""), String(term[1] ?? "")])];
        }),
      ).map((key) => {
        const [src, dst] = key.split("→");
        return [src ?? "", dst ?? ""] as const;
      })
    : [];

  return {
    warning_types: has_warning_types
      ? unique_strings((filters?.warning_types ?? []).map((value) => String(value)))
      : [...args.default_filters.warning_types],
    statuses: has_statuses
      ? unique_strings((filters?.statuses ?? []).map((value) => String(value)))
      : [...args.default_filters.statuses],
    file_paths: has_file_paths
      ? unique_strings((filters?.file_paths ?? []).map((value) => String(value)))
      : [...args.default_filters.file_paths],
    glossary_terms: has_glossary_terms
      ? glossary_terms
      : args.default_filters.glossary_terms.map(clone_glossary_term),
    include_without_glossary_miss: has_include_without_glossary_miss
      ? Boolean(filters?.include_without_glossary_miss)
      : args.default_filters.include_without_glossary_miss,
  };
}

function item_has_glossary_miss(item: ProofreadingClientItem): boolean {
  return item.failed_glossary_terms.length > 0;
}

function item_matches_glossary_filter(
  item: ProofreadingClientItem,
  filters: ProofreadingFilterOptions,
): boolean {
  if (!item_has_glossary_miss(item)) {
    return filters.include_without_glossary_miss;
  }

  const selected_term_key_set = new Set(
    filters.glossary_terms.map((term) => build_glossary_term_key(term)),
  );
  if (selected_term_key_set.size === 0) {
    return false;
  }

  return item.failed_glossary_terms.some((term) => {
    return selected_term_key_set.has(build_glossary_term_key(term));
  });
}

function item_matches_filters(
  item: ProofreadingClientItem,
  filters: ProofreadingFilterOptions,
): boolean {
  const item_warning_codes =
    item.warnings.length > 0 ? item.warnings : [PROOFREADING_NO_WARNING_CODE];
  const selected_warning_set = new Set(filters.warning_types);
  if (!item_warning_codes.some((warning) => selected_warning_set.has(warning))) {
    return false;
  }

  const selected_status_set = new Set(filters.statuses);
  if (!selected_status_set.has(item.status)) {
    return false;
  }

  const selected_file_path_set = new Set(filters.file_paths);
  if (!selected_file_path_set.has(item.file_path)) {
    return false;
  }

  return item_matches_glossary_filter(item, filters);
}

function filter_items_by_context(args: {
  items: ProofreadingClientItem[];
  filters: ProofreadingFilterOptions;
  ignored_dimensions?: ProofreadingFilterDimension[];
}): ProofreadingClientItem[] {
  const ignored_dimension_set = new Set(args.ignored_dimensions ?? []);
  const selected_warning_set = ignored_dimension_set.has("warning_types")
    ? null
    : new Set(args.filters.warning_types);
  const selected_status_set = ignored_dimension_set.has("statuses")
    ? null
    : new Set(args.filters.statuses);
  const selected_file_path_set = ignored_dimension_set.has("file_paths")
    ? null
    : new Set(args.filters.file_paths);
  const glossary_filter_enabled = !ignored_dimension_set.has("glossary_terms");

  return args.items.filter((item) => {
    const item_warning_codes =
      item.warnings.length > 0 ? item.warnings : [PROOFREADING_NO_WARNING_CODE];

    if (
      selected_warning_set !== null &&
      !item_warning_codes.some((warning) => selected_warning_set.has(warning))
    ) {
      return false;
    }

    if (selected_status_set !== null && !selected_status_set.has(item.status)) {
      return false;
    }

    if (selected_file_path_set !== null && !selected_file_path_set.has(item.file_path)) {
      return false;
    }

    if (glossary_filter_enabled && !item_matches_glossary_filter(item, args.filters)) {
      return false;
    }

    return true;
  });
}

function build_status_values(args: {
  items: ProofreadingClientItem[];
  filters: ProofreadingFilterOptions;
}): string[] {
  const known_statuses: string[] = [...PROOFREADING_STATUS_ORDER];
  const known_status_set = new Set(known_statuses);
  const extra_statuses = [
    ...new Set([...args.items.map((item) => item.status), ...args.filters.statuses]),
  ].filter((status) => !known_status_set.has(status));

  extra_statuses.sort((left_status, right_status) => {
    const left_rank = resolve_proofreading_status_sort_rank(left_status);
    const right_rank = resolve_proofreading_status_sort_rank(right_status);
    if (left_rank !== right_rank) {
      return left_rank - right_rank;
    }

    return left_status.localeCompare(right_status);
  });

  return [...known_statuses, ...extra_statuses];
}

function build_warning_values(args: {
  items: ProofreadingClientItem[];
  filters: ProofreadingFilterOptions;
}): string[] {
  const known_warnings: string[] = [...PROOFREADING_WARNING_CODES];
  const known_warning_set = new Set(known_warnings);
  const dynamic_warnings = args.items.flatMap((item) => {
    return item.warnings.length > 0 ? item.warnings : [PROOFREADING_NO_WARNING_CODE];
  });
  const extra_warnings = [...new Set([...dynamic_warnings, ...args.filters.warning_types])].filter(
    (warning) => !known_warning_set.has(warning),
  );

  extra_warnings.sort((left_warning, right_warning) => {
    return left_warning.localeCompare(right_warning);
  });

  return [...known_warnings, ...extra_warnings];
}

function build_status_count_by_code(items: ProofreadingClientItem[]): Record<string, number> {
  const next_count_by_code: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_code[item.status] = (next_count_by_code[item.status] ?? 0) + 1;
  });
  return next_count_by_code;
}

function build_warning_count_by_code(items: ProofreadingClientItem[]): Record<string, number> {
  const next_count_by_code: Record<string, number> = {
    [PROOFREADING_NO_WARNING_CODE]: 0,
  };

  items.forEach((item) => {
    if (item.warnings.length === 0) {
      next_count_by_code[PROOFREADING_NO_WARNING_CODE] =
        (next_count_by_code[PROOFREADING_NO_WARNING_CODE] ?? 0) + 1;
      return;
    }

    item.warnings.forEach((warning) => {
      next_count_by_code[warning] = (next_count_by_code[warning] ?? 0) + 1;
    });
  });

  return next_count_by_code;
}

function build_file_count_by_path(items: ProofreadingClientItem[]): Record<string, number> {
  const next_count_by_path: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_path[item.file_path] = (next_count_by_path[item.file_path] ?? 0) + 1;
  });
  return next_count_by_path;
}

function build_term_count_entries(args: {
  items: ProofreadingClientItem[];
}): ProofreadingFilterPanelTermEntry[] {
  const next_term_count_map = new Map<string, ProofreadingFilterPanelTermEntry>();

  args.items.forEach((item) => {
    if (!item.warnings.includes("GLOSSARY")) {
      return;
    }

    item.failed_glossary_terms.forEach((term) => {
      const term_key = build_glossary_term_key(term);
      const previous_entry = next_term_count_map.get(term_key);
      next_term_count_map.set(term_key, {
        term,
        count: (previous_entry?.count ?? 0) + 1,
      });
    });
  });

  return [...next_term_count_map.values()].sort((left_entry, right_entry) => {
    if (left_entry.count !== right_entry.count) {
      return right_entry.count - left_entry.count;
    }

    return build_glossary_term_key(left_entry.term).localeCompare(
      build_glossary_term_key(right_entry.term),
    );
  });
}

function increment_map_count(map: Map<string, number>, key: string, delta: number): void {
  const next_count = (map.get(key) ?? 0) + delta;
  if (next_count <= 0) {
    map.delete(key);
    return;
  }

  map.set(key, next_count);
}

function apply_counter_delta(args: {
  state: ProofreadingRuntimeState;
  item: ProofreadingClientItem;
  delta: number;
}): void {
  args.state.review_item_count += args.delta;
  if (args.item.warnings.length > 0) {
    args.state.warning_item_count += args.delta;
  }

  increment_map_count(args.state.status_count_by_code, args.item.status, args.delta);
  increment_map_count(args.state.file_count_by_path, args.item.file_path, args.delta);

  const item_warning_codes =
    args.item.warnings.length > 0 ? args.item.warnings : [PROOFREADING_NO_WARNING_CODE];
  item_warning_codes.forEach((warning) => {
    increment_map_count(args.state.warning_count_by_code, warning, args.delta);
  });

  args.item.failed_glossary_terms.forEach((term) => {
    const term_key = build_glossary_term_key(term);
    const previous_entry = args.state.glossary_term_count_map.get(term_key);
    const next_count = (previous_entry?.count ?? 0) + args.delta;
    if (next_count <= 0) {
      args.state.glossary_term_count_map.delete(term_key);
      return;
    }

    args.state.glossary_term_count_map.set(term_key, {
      term,
      count: next_count,
    });
  });
}

function build_default_filters_from_state(
  state: ProofreadingRuntimeState,
): ProofreadingFilterOptions {
  const available_statuses = [...state.status_count_by_code.keys()].sort(
    (left_status, right_status) => {
      const left_rank = resolve_proofreading_status_sort_rank(left_status);
      const right_rank = resolve_proofreading_status_sort_rank(right_status);
      if (left_rank !== right_rank) {
        return left_rank - right_rank;
      }

      return compare_text(left_status, right_status);
    },
  );
  const default_statuses = available_statuses.filter((status) => {
    return PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES.has(status);
  });

  const warning_type_set = new Set<string>([PROOFREADING_NO_WARNING_CODE]);
  for (const warning of state.warning_count_by_code.keys()) {
    warning_type_set.add(warning);
  }
  const warning_types = [
    ...PROOFREADING_WARNING_CODES.filter((warning) => warning_type_set.has(warning)),
    ...[...warning_type_set]
      .filter(
        (warning) =>
          !PROOFREADING_WARNING_CODES.includes(
            warning as (typeof PROOFREADING_WARNING_CODES)[number],
          ),
      )
      .sort(compare_text),
  ];

  const file_paths = [...state.file_count_by_path.keys()].sort(compare_text);
  const glossary_terms = [...state.glossary_term_count_map.values()]
    .map((entry) => entry.term)
    .sort((left_term, right_term) => {
      return compare_text(build_glossary_term_key(left_term), build_glossary_term_key(right_term));
    });

  return {
    warning_types,
    statuses: default_statuses.length > 0 ? default_statuses : available_statuses,
    file_paths,
    glossary_terms,
    include_without_glossary_miss: true,
  };
}

function rebuild_natural_item_ids(state: ProofreadingRuntimeState): void {
  state.natural_item_ids = [...state.raw_item_by_id.values()]
    .sort(compare_runtime_items)
    .map((item) => String(item.item_id));
}

function build_runtime_sync_state(state: ProofreadingRuntimeState): ProofreadingRuntimeSyncState {
  return {
    revision: state.revision,
    project_id: state.project_id,
    total_item_count: state.total_item_count,
    review_item_count: state.review_item_count,
    warning_item_count: state.warning_item_count,
    default_filters: clone_proofreading_filter_options(state.default_filters),
  };
}

function build_visible_items(items: ProofreadingClientItem[]): ProofreadingVisibleItem[] {
  return items.map((item) => {
    return {
      row_id: item.row_id,
      item,
      compressed_src: item.compressed_src,
      compressed_dst: item.compressed_dst,
    };
  });
}

function create_runtime_state(input: ProofreadingRuntimeHydrationInput): ProofreadingRuntimeState {
  const raw_item_by_id = new Map<string, ProofreadingRuntimeItemRecord>();
  const evaluated_item_by_id = new Map<string, ProofreadingClientItem>();
  const status_count_by_code = new Map<string, number>();
  const warning_count_by_code = new Map<string, number>();
  const file_count_by_path = new Map<string, number>();
  const glossary_term_count_map = new Map<string, ProofreadingFilterPanelTermEntry>();
  const glossary_entries = build_glossary_entries(input.quality);
  const sample_regex_cache = new Map<string, RegExp | null>();

  const state: ProofreadingRuntimeState = {
    project_id: input.project_id,
    revision: input.revision,
    total_item_count: input.total_item_count,
    quality: input.quality,
    source_language: input.source_language,
    raw_item_by_id,
    natural_item_ids: [],
    evaluated_item_by_id,
    status_count_by_code,
    warning_count_by_code,
    file_count_by_path,
    glossary_term_count_map,
    review_item_count: 0,
    warning_item_count: 0,
    default_filters: normalize_proofreading_filter_options(undefined, []),
  };

  input.items.forEach((raw_item) => {
    const normalized_item = normalize_runtime_item(raw_item);
    if (normalized_item === null) {
      return;
    }

    const item_key = String(normalized_item.item_id);
    raw_item_by_id.set(item_key, normalized_item);
    const evaluated_item = evaluate_proofreading_item({
      item: normalized_item,
      glossary_entries,
      quality: input.quality,
      source_language: input.source_language,
      sample_regex_cache,
    });
    if (evaluated_item === null) {
      return;
    }

    evaluated_item_by_id.set(item_key, evaluated_item);
    apply_counter_delta({
      state,
      item: evaluated_item,
      delta: 1,
    });
  });

  rebuild_natural_item_ids(state);
  state.default_filters = build_default_filters_from_state(state);
  return state;
}

function resolve_items_in_natural_order(state: ProofreadingRuntimeState): ProofreadingClientItem[] {
  return state.natural_item_ids.flatMap((item_id) => {
    const item = state.evaluated_item_by_id.get(item_id);
    return item === undefined ? [] : [item];
  });
}

export function createProofreadingRuntimeEngine() {
  let state: ProofreadingRuntimeState | null = null;

  return {
    hydrate_full(input: ProofreadingRuntimeHydrationInput): ProofreadingRuntimeSyncState {
      state = create_runtime_state({
        ...input,
        items: input.items.map((item) => {
          return normalize_runtime_item(item) ?? item;
        }),
      });
      return build_runtime_sync_state(state);
    },
    apply_item_delta(input: ProofreadingRuntimeDeltaInput): ProofreadingRuntimeSyncState {
      if (state === null || state.project_id !== input.project_id) {
        throw new Error("proofreading runtime 尚未完成项目级 hydrate。");
      }

      const current_state = state;
      const glossary_entries = build_glossary_entries(state.quality);
      const sample_regex_cache = new Map<string, RegExp | null>();
      let should_rebuild_natural_order = input.total_item_count !== current_state.total_item_count;

      current_state.revision = input.revision;
      current_state.total_item_count = input.total_item_count;

      input.items.forEach((raw_item) => {
        const normalized_item = normalize_runtime_item(raw_item);
        if (normalized_item === null) {
          return;
        }

        const item_key = String(normalized_item.item_id);
        const previous_item = current_state.raw_item_by_id.get(item_key) ?? null;
        if (previous_item === null || compare_runtime_items(previous_item, normalized_item) !== 0) {
          should_rebuild_natural_order = true;
        }

        const previous_evaluated_item = current_state.evaluated_item_by_id.get(item_key) ?? null;
        if (previous_evaluated_item !== null) {
          apply_counter_delta({
            state: current_state,
            item: previous_evaluated_item,
            delta: -1,
          });
          current_state.evaluated_item_by_id.delete(item_key);
        }

        current_state.raw_item_by_id.set(item_key, normalized_item);
        const next_evaluated_item = evaluate_proofreading_item({
          item: normalized_item,
          glossary_entries,
          quality: current_state.quality,
          source_language: current_state.source_language,
          sample_regex_cache,
        });
        if (next_evaluated_item === null) {
          return;
        }

        current_state.evaluated_item_by_id.set(item_key, next_evaluated_item);
        apply_counter_delta({
          state: current_state,
          item: next_evaluated_item,
          delta: 1,
        });
      });

      if (should_rebuild_natural_order) {
        rebuild_natural_item_ids(current_state);
      }

      current_state.default_filters = build_default_filters_from_state(current_state);
      return build_runtime_sync_state(current_state);
    },
    build_list_view(query: ProofreadingListViewQuery): ProofreadingListView {
      if (state === null) {
        return create_empty_proofreading_list_view();
      }

      const filters = normalize_runtime_filter_options({
        filters: query.filters,
        default_filters: state.default_filters,
      });
      const items_in_natural_order = resolve_items_in_natural_order(state).filter((item) => {
        return item_matches_filters(item, filters);
      });

      let invalid_regex_message: string | null = null;
      let search_pattern: RegExp | null = null;
      try {
        search_pattern = create_search_pattern(query.keyword, query.is_regex);
      } catch (error) {
        invalid_regex_message = error instanceof Error ? error.message : null;
      }

      const searched_items =
        invalid_regex_message === null
          ? items_in_natural_order.filter((item) => {
              return matches_proofreading_search_scope({
                item,
                search_pattern,
                keyword: query.keyword,
                is_regex: query.is_regex,
                scope: query.scope,
              });
            })
          : items_in_natural_order;
      const sorted_items = sort_visible_items(searched_items, query.sort_state);

      return {
        revision: state.revision,
        project_id: state.project_id,
        summary: {
          total_items: state.total_item_count,
          filtered_items: sorted_items.length,
          warning_items: sorted_items.reduce((count, item) => {
            return count + (item.warnings.length > 0 ? 1 : 0);
          }, 0),
        },
        default_filters: clone_proofreading_filter_options(state.default_filters),
        filters: clone_proofreading_filter_options(filters),
        items: build_visible_items(sorted_items),
        invalid_regex_message,
      };
    },
    build_filter_panel(query: ProofreadingFilterPanelQuery): ProofreadingFilterPanelState {
      if (state === null) {
        return create_empty_proofreading_filter_panel_state();
      }

      const filters = normalize_runtime_filter_options({
        filters: query.filters,
        default_filters: state.default_filters,
      });
      const items_in_natural_order = resolve_items_in_natural_order(state);
      const status_scope_items = filter_items_by_context({
        items: items_in_natural_order,
        filters,
        ignored_dimensions: ["statuses"],
      });
      const warning_scope_items = filter_items_by_context({
        items: items_in_natural_order,
        filters,
        ignored_dimensions: ["warning_types", "glossary_terms"],
      });
      const file_scope_items = filter_items_by_context({
        items: items_in_natural_order,
        filters,
        ignored_dimensions: ["file_paths"],
      });
      const term_scope_items = filter_items_by_context({
        items: items_in_natural_order,
        filters,
        ignored_dimensions: ["glossary_terms"],
      });
      const all_file_paths = [
        ...new Set(items_in_natural_order.map((item) => item.file_path)),
      ].sort(compare_text);
      const file_count_by_path = build_file_count_by_path(file_scope_items);

      return {
        filters: clone_proofreading_filter_options(filters),
        available_statuses: build_status_values({
          items: items_in_natural_order,
          filters,
        }),
        status_count_by_code: build_status_count_by_code(status_scope_items),
        available_warning_types: build_warning_values({
          items: items_in_natural_order,
          filters,
        }),
        warning_count_by_code: build_warning_count_by_code(warning_scope_items),
        all_file_paths,
        available_file_paths: [
          ...new Set([...Object.keys(file_count_by_path), ...filters.file_paths]),
        ].sort(compare_text),
        file_count_by_path,
        glossary_term_entries: build_term_count_entries({
          items: term_scope_items,
        }),
        without_glossary_miss_count: term_scope_items.filter((item) => {
          return !item_has_glossary_miss(item);
        }).length,
      };
    },
    dispose_project(project_id?: string): void {
      if (state === null) {
        return;
      }

      if (project_id !== undefined && project_id !== "" && state.project_id !== project_id) {
        return;
      }

      state = null;
    },
  };
}
