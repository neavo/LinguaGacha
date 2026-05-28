import type { QualityRulesRuntimeState } from "@/project/quality/quality-runtime-state";
import {
  applyQualityRuntimeReplacements,
  buildQualityRuntimeContext,
  collectNonBlankQualityPreservedSegments,
  createQualityTextPreserveRule,
  partitionQualityRuntimeGlossaryTerms,
  stripQualityPreservedSegments,
  type QualityRuntimeContext,
} from "@/project/quality/quality-runtime-context";
import {
  PROOFREADING_NO_WARNING_CODE,
  PROOFREADING_STATUS_ORDER,
  PROOFREADING_WARNING_CODES,
  clone_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  normalize_proofreading_filter_options,
  resolve_default_proofreading_statuses,
  resolve_default_proofreading_warning_types,
  resolve_proofreading_status_sort_rank,
  type ProofreadingClientItem,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingFilterPanelTermEntry,
  type ProofreadingGlossaryTerm,
  type ProofreadingListView,
  type ProofreadingSearchScope,
  type ProofreadingVisibleItem,
  type ProofreadingWarningFragmentsByCode,
} from "@/pages/proofreading-page/types";
import {
  build_proofreading_visible_items,
  compare_proofreading_runtime_items,
  compare_proofreading_text,
  create_proofreading_client_item,
  sort_proofreading_client_items,
} from "@/pages/proofreading-page/proofreading-list-runtime";
import { InternalInvariantError } from "@shared/error";
import type { ProjectChangeItemFieldPatch } from "@shared/project-event";
import type { TextPreserveRule } from "@shared/text/text-preserve-rules";
import { create_text_keyword_matcher, type TextKeywordMatcher } from "@shared/text/text-pattern";
import {
  collect_translation_residue_fragments,
  has_translation_retry_reached_review_threshold,
  has_translation_similarity_issue,
} from "@shared/text/translation-quality-rules";
import type { AppTableSortState } from "@/widgets/app-table/app-table-types";

// 跳过类状态仍要进入筛选统计，但不参与警告计算
const PROOFREADING_SKIPPED_WARNING_STATUSES = new Set([
  "NONE",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "DUPLICATED",
]);

// 校对列表 hydrate 使用的最小 item 行，字段来自 items section
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

export type ProofreadingRuntimeRevisions = {
  items: number;
  quality: number;
  proofreading: number;
};

// 全量 hydrate 输入包含项目分段 revision、质量规则快照和当前源/目标语言
export type ProofreadingRuntimeHydrationInput = {
  projectId: string;
  revisions: ProofreadingRuntimeRevisions;
  total_item_count: number;
  upsertItems: ProofreadingRuntimeItemRecord[];
  quality: QualityRulesRuntimeState;
  sourceLanguage: string;
  targetLanguage: string;
};

export type ProofreadingRuntimeEvaluatedSliceResult = {
  projectId: string;
  revisions: ProofreadingRuntimeRevisions;
  total_item_count: number;
  sourceLanguage: string;
  targetLanguage: string;
  rawItems: ProofreadingRuntimeItemRecord[];
  evaluatedItems: ProofreadingClientItem[];
};

export type ProofreadingRuntimeEvaluatedHydrationInput = {
  projectId: string;
  revisions: ProofreadingRuntimeRevisions;
  total_item_count: number;
  rawItems: ProofreadingRuntimeItemRecord[];
  evaluatedItems: ProofreadingClientItem[];
  quality: QualityRulesRuntimeState;
  sourceLanguage: string;
  targetLanguage: string;
};

// 增量输入只携带变化 item，质量规则和源语言沿用已 hydrate 状态
export type ProofreadingRuntimeDeltaInput = {
  projectId: string;
  revisions: ProofreadingRuntimeRevisions;
  total_item_count: number;
  upsertItems: ProofreadingRuntimeItemRecord[];
  patchItemIds: number[];
  fieldPatch: ProjectChangeItemFieldPatch | null;
  deleteItemIds: number[];
};

// 列表视图查询把筛选、搜索、排序和虚拟窗口边界集中传入运行态
export type ProofreadingListViewQuery = {
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: AppTableSortState | null;
  window_start?: number;
  window_count?: number;
};

// 筛选面板查询只关心当前筛选条件，不需要窗口信息
export type ProofreadingFilterPanelQuery = {
  filters: ProofreadingFilterOptions;
};

// 已构建列表视图的窗口读取请求，view_id 用来隔离过期缓存
export type ProofreadingListWindowQuery = {
  view_id: string;
  start: number;
  count: number;
};

// 行 id 范围读取用于表格选择和批量操作，不需要传回完整 item
export type ProofreadingRowIdsRangeQuery = {
  view_id: string;
  start: number;
  count: number;
};

// 行索引解析留在列表运行态内执行，避免页面为定位一行拉取完整视图
export type ProofreadingRowIndexQuery = {
  view_id: string;
  row_id: string;
};

// 按行 id 回读 item，供编辑弹窗或批量操作获取当前缓存事实
export type ProofreadingItemsByRowIdsQuery = {
  row_ids: string[];
};

// 列表窗口响应保持轻量，只返回当前窗口内的可见行
export type ProofreadingListWindow = {
  view_id: string;
  start: number;
  row_count: number;
  rows: ProofreadingVisibleItem[];
};

// 同步状态是页面判断列表缓存是否可继续复用的最小凭据，语言变化必须触发全量重建
export type ProofreadingRuntimeSyncState = {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  revisions: ProofreadingRuntimeRevisions;
  defaultFilters: ProofreadingFilterOptions;
};

// 列表完整运行态，所有派生筛选计数都从这里维护
type ProofreadingRuntimeState = {
  projectId: string;
  revisions: ProofreadingRuntimeRevisions;
  total_item_count: number;
  quality: QualityRulesRuntimeState;
  sourceLanguage: string;
  targetLanguage: string;
  quality_context: QualityRuntimeContext;
  sample_rule_cache: Map<string, TextPreserveRule | null>;
  raw_item_by_id: Map<string, ProofreadingRuntimeItemRecord>;
  natural_item_ids: string[];
  evaluated_item_by_id: Map<string, ProofreadingClientItem>;
  status_count_by_code: Map<string, number>;
  warning_count_by_code: Map<string, number>;
  file_count_by_path: Map<string, number>;
  glossary_term_count_map: Map<string, ProofreadingFilterPanelTermEntry>;
  defaultFilters: ProofreadingFilterOptions;
};

type ProofreadingRuntimeItemChange = {
  item_id: string; // 变更记录统一使用 row id 字符串，直接对接列表缓存
  removed_from_runtime: boolean; // 只有后端 tombstone 能改变旧结果视图的成员集合
  natural_order_changed: boolean; // 文件、行号或 item_id 变化会影响所有排序的兜底顺序
};

// 列表视图缓存只保存显式查询生成的稳定 id 序列，让用户在筛选校对后能先确认重翻结果
type ProofreadingRuntimeListViewCache = {
  view_id: string;
  projectId: string;
  ordered_item_ids: string[];
  // row_index_by_id 让恢复滚动按 row id O(1) 定位，不需要把完整视图传回 renderer。
  row_index_by_id: Map<string, number>;
};

// 筛选维度枚举用于“构建面板时忽略当前维度”的交叉统计
type ProofreadingFilterDimension = "warning_types" | "statuses" | "file_paths" | "glossary_terms";

// 单次筛选查询的预编译上下文，避免在每个 item 上重复构造 Set
type ProofreadingRuntimeFilterContext = {
  warning_type_set: Set<string> | null; // null 表示当前查询忽略 warning 维度
  status_set: Set<string> | null; // null 表示当前查询忽略 status 维度
  file_path_set: Set<string> | null; // null 表示当前查询忽略 file 维度
  glossary_filter_enabled: boolean; // false 表示当前查询忽略术语维度
  glossary_term_key_set: Set<string>; // 预归一后的术语缺失筛选键
  include_without_glossary_miss: boolean; // 是否保留没有术语缺失的条目
};

// 单次搜索查询的预编译上下文，普通文本走包含匹配，正则只编译一次
type ProofreadingRuntimeSearchContext = {
  matcher: TextKeywordMatcher; // 由共享文本规则生成的稳定匹配器
  scope: ProofreadingSearchScope; // 当前搜索范围：原文、译文或两者
};

const PROOFREADING_DEFAULT_WINDOW_COUNT = 160; // 默认窗口大小控制每次返回量，防止大项目一次复制全量行

/**
 * 列表运行态接收后端 query 结果，需要先归一成稳定 item 行
 */
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

/**
 * 字段级 patch 只合并后端事件允许的校对字段，保留列表运行态内完整 item 事实。
 */
function apply_runtime_item_field_patch(
  item: ProofreadingRuntimeItemRecord,
  patch: ProjectChangeItemFieldPatch | null,
): ProofreadingRuntimeItemRecord | null {
  if (patch === null) {
    return null;
  }
  const next_item: ProofreadingRuntimeItemRecord = { ...item };
  let touched = false;
  if (typeof patch.dst === "string" && patch.dst !== item.dst) {
    next_item.dst = patch.dst;
    touched = true;
  }
  if (patch.status !== undefined && patch.status !== item.status) {
    next_item.status = patch.status;
    touched = true;
  }
  if (typeof patch.retry_count === "number" && patch.retry_count !== item.retry_count) {
    next_item.retry_count = patch.retry_count;
    touched = true;
  }
  return touched ? next_item : null;
}

/**
 * 构造文本保护失败片段时保留源/译两边差异，供编辑弹窗定位
 */
function build_text_preserve_failed_fragments(args: {
  source_segments: string[];
  translation_segments: string[];
}): string[] {
  const failed_fragments: string[] = [];
  const max_length = Math.max(args.source_segments.length, args.translation_segments.length);

  for (let index = 0; index < max_length; index += 1) {
    const source_segment = args.source_segments[index];
    const translation_segment = args.translation_segments[index];
    if (source_segment === translation_segment) {
      continue;
    }

    if (source_segment !== undefined) {
      failed_fragments.push(source_segment);
    }
    if (translation_segment !== undefined) {
      failed_fragments.push(translation_segment);
    }
  }

  return unique_strings(failed_fragments);
}

/**
 * 单条 item 的全部校对警告在这里生成，保证列表、面板和弹窗看到同一份判断
 */
function evaluate_proofreading_item(args: {
  item: ProofreadingRuntimeItemRecord;
  quality_context: QualityRuntimeContext;
  quality: QualityRulesRuntimeState;
  sourceLanguage: string;
  targetLanguage: string;
  sample_rule_cache: Map<string, TextPreserveRule | null>;
}): ProofreadingClientItem | null {
  const warnings: string[] = [];
  const warning_fragments_by_code: ProofreadingWarningFragmentsByCode = {};
  const failed_terms: ProofreadingGlossaryTerm[] = [];
  const applied_terms: ProofreadingGlossaryTerm[] = [];
  const sample_rule_cache_key = `${args.item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`;
  let sample_rule = args.sample_rule_cache.get(sample_rule_cache_key);
  if (sample_rule === undefined) {
    sample_rule = createQualityTextPreserveRule({
      mode: args.quality.text_preserve.mode,
      text_type: args.item.text_type,
      entries: args.quality.text_preserve.entries,
    });
    args.sample_rule_cache.set(sample_rule_cache_key, sample_rule);
  }

  if (PROOFREADING_SKIPPED_WARNING_STATUSES.has(args.item.status) || args.item.dst === "") {
    return create_proofreading_client_item({
      item: args.item,
      warnings,
      warning_fragments_by_code,
      failed_terms,
      applied_terms,
    });
  }

  const { src_replaced, dst_replaced } = applyQualityRuntimeReplacements(
    args.item,
    args.quality_context,
  );
  const normalized_dst = stripQualityPreservedSegments(args.item.dst, sample_rule);
  const residue_fragments = collect_translation_residue_fragments({
    text: normalized_dst,
    sourceLanguage: args.sourceLanguage,
  });
  const kana_fragments = residue_fragments.kana;
  if (kana_fragments.length > 0) {
    warnings.push("KANA");
    warning_fragments_by_code.KANA = kana_fragments;
  }

  const hangeul_fragments = residue_fragments.hangeul;
  if (hangeul_fragments.length > 0) {
    warnings.push("HANGEUL");
    warning_fragments_by_code.HANGEUL = hangeul_fragments;
  }

  const source_preserved_segments = collectNonBlankQualityPreservedSegments(
    src_replaced,
    sample_rule,
  );
  const translation_preserved_segments = collectNonBlankQualityPreservedSegments(
    dst_replaced,
    sample_rule,
  );
  if (source_preserved_segments.join("\u0000") !== translation_preserved_segments.join("\u0000")) {
    warnings.push("TEXT_PRESERVE");
    warning_fragments_by_code.TEXT_PRESERVE = build_text_preserve_failed_fragments({
      source_segments: source_preserved_segments,
      translation_segments: translation_preserved_segments,
    });
  }

  if (
    has_translation_similarity_issue({
      src: stripQualityPreservedSegments(src_replaced, sample_rule),
      dst: stripQualityPreservedSegments(dst_replaced, sample_rule),
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
    })
  ) {
    warnings.push("SIMILARITY");
  }

  if (args.quality_context.glossary.entries.length > 0) {
    const glossary_result = partitionQualityRuntimeGlossaryTerms({
      glossary: args.quality_context.glossary,
      src_replaced,
      dst_replaced,
    });
    failed_terms.push(...glossary_result.failed_terms);
    applied_terms.push(...glossary_result.applied_terms);
    if (glossary_result.failed_terms.length > 0) {
      warnings.push("GLOSSARY");
    }
  }

  if (has_translation_retry_reached_review_threshold(args.item.retry_count)) {
    warnings.push("RETRY_THRESHOLD");
  }

  return create_proofreading_client_item({
    item: args.item,
    warnings,
    warning_fragments_by_code,
    failed_terms,
    applied_terms,
  });
}

/**
 * 术语筛选使用稳定 key 表达二元组，避免数组引用参与比较
 */
function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`;
}

/**
 * 字符串去重保持首次出现顺序，筛选项和 warning 片段都依赖这个稳定性
 */
function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 术语二元组是 readonly tuple，克隆后可安全传给 UI
 */
function clone_glossary_term(term: ProofreadingGlossaryTerm): ProofreadingGlossaryTerm {
  return [term[0], term[1]] as const;
}

/**
 * 外部筛选输入可能不完整，必须和默认筛选合并后再参与计算
 */
function normalize_runtime_filter_options(args: {
  filters: Partial<ProofreadingFilterOptions> | undefined;
  defaultFilters: ProofreadingFilterOptions;
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
      : [...args.defaultFilters.warning_types],
    statuses: has_statuses
      ? unique_strings((filters?.statuses ?? []).map((value) => String(value)))
      : [...args.defaultFilters.statuses],
    file_paths: has_file_paths
      ? unique_strings((filters?.file_paths ?? []).map((value) => String(value)))
      : [...args.defaultFilters.file_paths],
    glossary_terms: has_glossary_terms
      ? glossary_terms
      : args.defaultFilters.glossary_terms.map(clone_glossary_term),
    include_without_glossary_miss: has_include_without_glossary_miss
      ? Boolean(filters?.include_without_glossary_miss)
      : args.defaultFilters.include_without_glossary_miss,
  };
}

/**
 * 术语 miss 只看 failed_glossary_terms，不把已命中术语算作警告
 */
function item_has_glossary_miss(item: ProofreadingClientItem): boolean {
  return item.failed_glossary_terms.length > 0;
}

/**
 * 将 UI 筛选值编译成单次查询上下文，大列表过滤时直接复用集合
 */
function create_proofreading_filter_context(args: {
  filters: ProofreadingFilterOptions;
  ignored_dimensions?: ProofreadingFilterDimension[];
}): ProofreadingRuntimeFilterContext {
  const ignored_dimension_set = new Set(args.ignored_dimensions ?? []);
  const glossary_filter_enabled = !ignored_dimension_set.has("glossary_terms");

  return {
    warning_type_set: ignored_dimension_set.has("warning_types")
      ? null
      : new Set(args.filters.warning_types),
    status_set: ignored_dimension_set.has("statuses") ? null : new Set(args.filters.statuses),
    file_path_set: ignored_dimension_set.has("file_paths")
      ? null
      : new Set(args.filters.file_paths),
    glossary_filter_enabled,
    glossary_term_key_set: glossary_filter_enabled
      ? new Set(args.filters.glossary_terms.map((term) => build_glossary_term_key(term)))
      : new Set<string>(),
    include_without_glossary_miss: args.filters.include_without_glossary_miss,
  };
}

/**
 * 搜索上下文统一使用共享文本规则，普通关键字不再为每个候选文本创建 RegExp
 */
function create_proofreading_search_context(args: {
  keyword: string;
  is_regex: boolean;
  scope: ProofreadingSearchScope;
}): ProofreadingRuntimeSearchContext {
  return {
    matcher: create_text_keyword_matcher({
      keyword: args.keyword,
      is_regex: args.is_regex,
      case_sensitive: false,
    }),
    scope: args.scope,
  };
}

/**
 * 术语筛选支持“无术语缺失”开关和指定 miss 术语列表两种语义
 */
function item_matches_glossary_filter(
  item: ProofreadingClientItem,
  context: ProofreadingRuntimeFilterContext,
): boolean {
  if (!context.glossary_filter_enabled) {
    return true;
  }

  if (!item_has_glossary_miss(item)) {
    return context.include_without_glossary_miss;
  }

  if (context.glossary_term_key_set.size === 0) {
    return false;
  }

  return item.failed_glossary_terms.some((term) => {
    return context.glossary_term_key_set.has(build_glossary_term_key(term));
  });
}

/**
 * 单个 item 必须同时满足 warning、status、file 和术语筛选
 */
function item_matches_filter_context(
  item: ProofreadingClientItem,
  context: ProofreadingRuntimeFilterContext,
): boolean {
  const item_warning_codes =
    item.warnings.length > 0 ? item.warnings : [PROOFREADING_NO_WARNING_CODE];
  if (context.warning_type_set !== null) {
    const warning_type_set = context.warning_type_set;
    if (!item_warning_codes.some((warning) => warning_type_set.has(warning))) {
      return false;
    }
  }

  if (context.status_set !== null && !context.status_set.has(item.status)) {
    return false;
  }

  if (context.file_path_set !== null && !context.file_path_set.has(item.file_path)) {
    return false;
  }

  return item_matches_glossary_filter(item, context);
}

/**
 * 搜索范围决定比较 src、dst 还是二者任一命中；非法正则保持旧语义只提示不裁剪
 */
function matches_proofreading_search_scope(args: {
  item: ProofreadingClientItem;
  search_context: ProofreadingRuntimeSearchContext;
}): boolean {
  if (args.search_context.matcher.invalid_regex_message !== null) {
    return true;
  }

  if (args.search_context.scope === "src") {
    return args.search_context.matcher.matches(args.item.src);
  }

  if (args.search_context.scope === "dst") {
    return args.search_context.matcher.matches(args.item.dst);
  }

  return (
    args.search_context.matcher.matches(args.item.src) ||
    args.search_context.matcher.matches(args.item.dst)
  );
}

/**
 * 构建筛选面板时可忽略某个维度，得到“其它条件下该维度可选项”的计数
 */
function filter_items_by_context(args: {
  items: ProofreadingClientItem[];
  filters: ProofreadingFilterOptions;
  ignored_dimensions?: ProofreadingFilterDimension[];
}): ProofreadingClientItem[] {
  const filter_context = create_proofreading_filter_context({
    filters: args.filters,
    ignored_dimensions: args.ignored_dimensions,
  });

  return args.items.filter((item) => {
    return item_matches_filter_context(item, filter_context);
  });
}

/**
 * 状态筛选值保留已知顺序，并把运行时出现的未知状态附在后面
 */
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

/**
 * 警告筛选值保留已知顺序，同时补上动态出现的未知 warning
 */
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

/**
 * 统计当前上下文中的状态数量，筛选面板直接消费普通对象
 */
function build_status_count_by_code(items: ProofreadingClientItem[]): Record<string, number> {
  const next_count_by_code: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_code[item.status] = (next_count_by_code[item.status] ?? 0) + 1;
  });
  return next_count_by_code;
}

/**
 * 无警告项显式计入 NO_WARNING，保证“无警告”筛选有稳定计数
 */
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

/**
 * 文件路径计数按当前上下文重新计算，不复用全局计数避免筛选串味
 */
function build_file_count_by_path(items: ProofreadingClientItem[]): Record<string, number> {
  const next_count_by_path: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_path[item.file_path] = (next_count_by_path[item.file_path] ?? 0) + 1;
  });
  return next_count_by_path;
}

/**
 * 术语缺失计数按 miss 术语聚合，用于筛选面板的术语维度
 */
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

/**
 * 计数 map 支持正负 delta，归零时删除键避免面板出现空值项
 */
function increment_map_count(map: Map<string, number>, key: string, delta: number): void {
  const next_count = (map.get(key) ?? 0) + delta;
  if (next_count <= 0) {
    map.delete(key);
    return;
  }

  map.set(key, next_count);
}

/**
 * 增量更新时同步维护所有计数索引，避免每次 delta 都全量重建
 */
function apply_counter_delta(args: {
  state: ProofreadingRuntimeState;
  item: ProofreadingClientItem;
  delta: number;
}): void {
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

/**
 * 单条 raw item 更新会同步重评估警告和所有筛选计数，并输出自然顺序和删除剪裁需要的变更记录。
 */
function upsert_runtime_item_in_state(
  state: ProofreadingRuntimeState,
  normalized_item: ProofreadingRuntimeItemRecord,
): ProofreadingRuntimeItemChange {
  const item_key = String(normalized_item.item_id);
  const previous_item = state.raw_item_by_id.get(item_key) ?? null;
  const should_rebuild_natural_order =
    previous_item === null ||
    compare_proofreading_runtime_items(previous_item, normalized_item) !== 0;
  const previous_evaluated_item = state.evaluated_item_by_id.get(item_key) ?? null;
  if (previous_evaluated_item !== null) {
    apply_counter_delta({
      state,
      item: previous_evaluated_item,
      delta: -1,
    });
    state.evaluated_item_by_id.delete(item_key);
  }

  state.raw_item_by_id.set(item_key, normalized_item);
  const next_evaluated_item = evaluate_proofreading_item({
    item: normalized_item,
    quality_context: state.quality_context,
    quality: state.quality,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    sample_rule_cache: state.sample_rule_cache,
  });
  if (next_evaluated_item !== null) {
    state.evaluated_item_by_id.set(item_key, next_evaluated_item);
    apply_counter_delta({
      state,
      item: next_evaluated_item,
      delta: 1,
    });
  }
  return {
    item_id: item_key,
    removed_from_runtime: false,
    natural_order_changed: should_rebuild_natural_order,
  };
}

/**
 * 删除也产出同形变更记录，列表缓存不需要关心 delta 来源是 tombstone 还是 upsert。
 */
function delete_runtime_item_from_state(
  state: ProofreadingRuntimeState,
  item_id: string,
): ProofreadingRuntimeItemChange {
  const previous_item = state.raw_item_by_id.get(item_id) ?? null;
  const previous_evaluated_item = state.evaluated_item_by_id.get(item_id) ?? null;
  if (previous_evaluated_item !== null) {
    apply_counter_delta({
      state,
      item: previous_evaluated_item,
      delta: -1,
    });
  }
  state.raw_item_by_id.delete(item_id);
  state.evaluated_item_by_id.delete(item_id);
  return {
    item_id,
    removed_from_runtime: previous_item !== null || previous_evaluated_item !== null,
    natural_order_changed: previous_item !== null,
  };
}

/**
 * 默认筛选从当前可见事实派生，进入页面时只展示最常用的有效范围
 */
function buildDefaultFiltersFromState(state: ProofreadingRuntimeState): ProofreadingFilterOptions {
  const available_statuses = [...state.status_count_by_code.keys()].sort(
    (left_status, right_status) => {
      const left_rank = resolve_proofreading_status_sort_rank(left_status);
      const right_rank = resolve_proofreading_status_sort_rank(right_status);
      if (left_rank !== right_rank) {
        return left_rank - right_rank;
      }

      return compare_proofreading_text(left_status, right_status);
    },
  );
  const warning_type_set = new Set<string>([PROOFREADING_NO_WARNING_CODE]);
  for (const warning of state.warning_count_by_code.keys()) {
    warning_type_set.add(warning);
  }
  const warning_types = resolve_default_proofreading_warning_types([...warning_type_set]);

  const file_paths = [...state.file_count_by_path.keys()].sort(compare_proofreading_text);
  const glossary_terms = [...state.glossary_term_count_map.values()]
    .map((entry) => entry.term)
    .sort((left_term, right_term) => {
      return compare_proofreading_text(
        build_glossary_term_key(left_term),
        build_glossary_term_key(right_term),
      );
    });

  return {
    warning_types,
    statuses: resolve_default_proofreading_statuses(available_statuses),
    file_paths,
    glossary_terms,
    include_without_glossary_miss: true,
  };
}

/**
 * 自然顺序缓存只保存 row id，避免排序结果复制完整条目导致内存翻倍
 */
function rebuild_natural_item_ids(state: ProofreadingRuntimeState): void {
  state.natural_item_ids = [...state.raw_item_by_id.values()]
    .sort(compare_proofreading_runtime_items)
    .map((item) => String(item.item_id));
}

// build_revision_signature 构造跨层载荷，保证字段形状在一个入口维护。
function build_revision_signature(revisions: ProofreadingRuntimeRevisions): string {
  return `${revisions.items.toString()}:${revisions.quality.toString()}:${revisions.proofreading.toString()}`;
}

/**
 * 页面只需要同步凭据和默认筛选，完整条目继续留在列表运行态内部按窗口读取
 */
function build_runtime_sync_state(state: ProofreadingRuntimeState): ProofreadingRuntimeSyncState {
  return {
    projectId: state.projectId,
    sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage,
    revisions: { ...state.revisions },
    defaultFilters: clone_proofreading_filter_options(state.defaultFilters),
  };
}

/**
 * 虚拟窗口边界在列表运行态内收敛，调用方传入越界值时不会破坏缓存读取
 */
function normalize_window_bounds(args: {
  start: number | undefined;
  count: number | undefined;
  row_count: number;
}): { start: number; count: number } {
  const normalized_start = Math.min(
    Math.max(0, Math.trunc(args.start ?? 0)),
    Math.max(0, args.row_count),
  );
  const normalized_count = Math.max(0, Math.trunc(args.count ?? PROOFREADING_DEFAULT_WINDOW_COUNT));

  return {
    start: normalized_start,
    count: normalized_count,
  };
}

/**
 * 根据缓存 row id 切片回读当前窗口，确保排序与筛选只在构建 list view 时发生一次
 */
function build_window_rows(args: {
  state: ProofreadingRuntimeState;
  ordered_item_ids: string[];
  start: number;
  count: number;
}): ProofreadingVisibleItem[] {
  const window_item_ids = args.ordered_item_ids.slice(args.start, args.start + args.count);
  return build_proofreading_visible_items(
    window_item_ids.flatMap((item_id) => {
      const item = args.state.evaluated_item_by_id.get(item_id);
      return item === undefined ? [] : [item];
    }),
  );
}

// create_list_view_cache 统一维护有序 id 列表和反向索引，避免增量更新忘记重建索引。
function create_list_view_cache(args: {
  view_id: string;
  projectId: string;
  ordered_item_ids: string[];
}): ProofreadingRuntimeListViewCache {
  return {
    view_id: args.view_id,
    projectId: args.projectId,
    ordered_item_ids: args.ordered_item_ids,
    row_index_by_id: new Map(
      args.ordered_item_ids.map((item_id, index) => {
        return [item_id, index] as const;
      }),
    ),
  };
}

/**
 * 全量 hydrate 初始化全部索引和质量上下文，后续 delta 只在这些索引上增量维护
 */
function create_runtime_state(input: ProofreadingRuntimeHydrationInput): ProofreadingRuntimeState {
  const raw_item_by_id = new Map<string, ProofreadingRuntimeItemRecord>();
  const evaluated_item_by_id = new Map<string, ProofreadingClientItem>();
  const status_count_by_code = new Map<string, number>();
  const warning_count_by_code = new Map<string, number>();
  const file_count_by_path = new Map<string, number>();
  const glossary_term_count_map = new Map<string, ProofreadingFilterPanelTermEntry>();
  const quality_context = buildQualityRuntimeContext(input.quality);
  const sample_rule_cache = new Map<string, TextPreserveRule | null>();

  const state: ProofreadingRuntimeState = {
    projectId: input.projectId,
    revisions: { ...input.revisions },
    total_item_count: input.total_item_count,
    quality: input.quality,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    quality_context,
    sample_rule_cache,
    raw_item_by_id,
    natural_item_ids: [],
    evaluated_item_by_id,
    status_count_by_code,
    warning_count_by_code,
    file_count_by_path,
    glossary_term_count_map,
    defaultFilters: normalize_proofreading_filter_options(undefined, []),
  };

  input.upsertItems.forEach((raw_item) => {
    const normalized_item = normalize_runtime_item(raw_item);
    if (normalized_item === null) {
      return;
    }

    upsert_runtime_item_in_state(state, normalized_item);
  });

  rebuild_natural_item_ids(state);
  state.defaultFilters = buildDefaultFiltersFromState(state);
  return state;
}

/**
 * 分片 hydrate 只评估自己的 item slice，返回主运行态合并所需的原始行和质量派生行。
 */
export function evaluateProofreadingRuntimeSlice(
  input: ProofreadingRuntimeHydrationInput,
): ProofreadingRuntimeEvaluatedSliceResult {
  const quality_context = buildQualityRuntimeContext(input.quality);
  const sample_rule_cache = new Map<string, TextPreserveRule | null>();
  const rawItems: ProofreadingRuntimeItemRecord[] = [];
  const evaluatedItems: ProofreadingClientItem[] = [];

  input.upsertItems.forEach((raw_item) => {
    const normalized_item = normalize_runtime_item(raw_item);
    if (normalized_item === null) {
      return;
    }

    rawItems.push(normalized_item);
    const evaluated_item = evaluate_proofreading_item({
      item: normalized_item,
      quality_context,
      quality: input.quality,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sample_rule_cache,
    });
    if (evaluated_item !== null) {
      evaluatedItems.push(evaluated_item);
    }
  });

  return {
    projectId: input.projectId,
    revisions: { ...input.revisions },
    total_item_count: input.total_item_count,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    rawItems,
    evaluatedItems,
  };
}

/**
 * 主运行态从已评估分片重建唯一完整运行态，筛选统计和列表缓存仍只在这里维护。
 */
function create_runtime_state_from_evaluated(
  input: ProofreadingRuntimeEvaluatedHydrationInput,
): ProofreadingRuntimeState {
  const state: ProofreadingRuntimeState = {
    projectId: input.projectId,
    revisions: { ...input.revisions },
    total_item_count: input.total_item_count,
    quality: input.quality,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    quality_context: buildQualityRuntimeContext(input.quality),
    sample_rule_cache: new Map<string, TextPreserveRule | null>(),
    raw_item_by_id: new Map(),
    natural_item_ids: [],
    evaluated_item_by_id: new Map(),
    status_count_by_code: new Map(),
    warning_count_by_code: new Map(),
    file_count_by_path: new Map(),
    glossary_term_count_map: new Map(),
    defaultFilters: normalize_proofreading_filter_options(undefined, []),
  };
  const evaluated_item_by_id = new Map(
    input.evaluatedItems.map((item) => {
      return [String(item.item_id), item] as const;
    }),
  );

  input.rawItems.forEach((raw_item) => {
    const normalized_item = normalize_runtime_item(raw_item);
    if (normalized_item === null) {
      return;
    }

    const item_key = String(normalized_item.item_id);
    state.raw_item_by_id.set(item_key, normalized_item);
    const evaluated_item = evaluated_item_by_id.get(item_key);
    if (evaluated_item === undefined) {
      return;
    }

    state.evaluated_item_by_id.set(item_key, evaluated_item);
    apply_counter_delta({
      state,
      item: evaluated_item,
      delta: 1,
    });
  });

  rebuild_natural_item_ids(state);
  state.defaultFilters = buildDefaultFiltersFromState(state);
  return state;
}

/**
 * 将自然顺序 id 序列解析为可见条目，跳过已被过滤或尚未成功评估的记录
 */
function resolve_items_in_natural_order(state: ProofreadingRuntimeState): ProofreadingClientItem[] {
  return state.natural_item_ids.flatMap((item_id) => {
    const item = state.evaluated_item_by_id.get(item_id);
    return item === undefined ? [] : [item];
  });
}

/**
 * 列表查询沿自然 id 顺序流式收集结果，避免为搜索先复制一份全量 item 数组
 */
function collect_visible_items_in_natural_order(args: {
  state: ProofreadingRuntimeState;
  filter_context: ProofreadingRuntimeFilterContext;
  search_context: ProofreadingRuntimeSearchContext;
}): ProofreadingClientItem[] {
  const matched_items: ProofreadingClientItem[] = [];
  args.state.natural_item_ids.forEach((item_id) => {
    const item = args.state.evaluated_item_by_id.get(item_id);
    if (item === undefined) {
      return;
    }

    if (!item_matches_filter_context(item, args.filter_context)) {
      return;
    }

    if (
      !matches_proofreading_search_scope({
        item,
        search_context: args.search_context,
      })
    ) {
      return;
    }

    matched_items.push(item);
  });
  return matched_items;
}

/**
 * item delta 提交后只从当前结果快照剪除 tombstone；字段变化只刷新行内容，不重新执行筛选或排序。
 * 这保证重翻修复术语命中后，行仍停留在当前筛选结果里供用户检查其它问题。
 */
function apply_item_changes_to_list_view_cache(args: {
  cache: ProofreadingRuntimeListViewCache | null;
  changes: ProofreadingRuntimeItemChange[];
}): ProofreadingRuntimeListViewCache | null {
  if (args.cache === null || args.changes.length === 0) {
    return args.cache;
  }

  const deleted_item_ids = new Set(
    args.changes.filter((change) => change.removed_from_runtime).map((change) => change.item_id),
  );
  if (deleted_item_ids.size === 0) {
    return args.cache;
  }

  const next_ordered_item_ids = args.cache.ordered_item_ids.filter((item_id) => {
    return !deleted_item_ids.has(item_id);
  });
  return create_list_view_cache({
    view_id: args.cache.view_id,
    projectId: args.cache.projectId,
    ordered_item_ids: next_ordered_item_ids,
  });
}

/**
 * 创建校对列表运行态实例，集中管理项目态、列表缓存和筛选面板派生数据
 */
export function createProofreadingListService() {
  let state: ProofreadingRuntimeState | null = null; // 当前项目的完整运行态，dispose 或跨项目 hydrate 前不得泄露给渲染层
  let list_view_cache: ProofreadingRuntimeListViewCache | null = null; // 最近一次列表视图的排序结果缓存，窗口滚动只读取 id 切片
  let next_list_view_id = 0; // 视图 id 单调递增，避免同 revision 下筛选条件变化时复用旧窗口请求

  return {
    /**
     * 接收后端全量快照并重建列表索引，是每个项目进入校对页的起点
     */
    hydrate_full(input: ProofreadingRuntimeHydrationInput): ProofreadingRuntimeSyncState {
      state = create_runtime_state({
        ...input,
        upsertItems: input.upsertItems.map((item) => {
          return normalize_runtime_item(item) ?? item;
        }),
      });
      list_view_cache = null;
      return build_runtime_sync_state(state);
    },
    /**
     * 评估 hydrate 分片，供未来并行化时复用同一质量派生算法。
     */
    evaluate_hydration_slice(input: ProofreadingRuntimeHydrationInput) {
      return evaluateProofreadingRuntimeSlice(input);
    },
    /**
     * 合并已评估分片并重建完整运行态，最终索引仍由主 service 持有。
     */
    hydrate_evaluated_full(
      input: ProofreadingRuntimeEvaluatedHydrationInput,
    ): ProofreadingRuntimeSyncState {
      state = create_runtime_state_from_evaluated(input);
      list_view_cache = null;
      return build_runtime_sync_state(state);
    },
    /**
     * 应用项目事件流中的条目增量，同时维护计数、自然顺序和默认筛选
     */
    apply_item_delta(input: ProofreadingRuntimeDeltaInput): ProofreadingRuntimeSyncState {
      if (state === null || state.projectId !== input.projectId) {
        throw new InternalInvariantError({
          diagnostic_context: { reason: "proofreading_runtime_requires_project_hydrate" },
        });
      }

      const current_state = state;
      const revisions = input.revisions;
      let should_rebuild_natural_order = input.total_item_count !== current_state.total_item_count;

      if (
        revisions.quality !== current_state.revisions.quality ||
        revisions.proofreading < current_state.revisions.proofreading
      ) {
        throw new InternalInvariantError({
          diagnostic_context: {
            reason: "proofreading_runtime_delta_revision_incompatible",
            current_revisions: current_state.revisions,
            input_revisions: revisions,
          },
        });
      }

      current_state.revisions = revisions;
      current_state.total_item_count = input.total_item_count;

      const item_changes: ProofreadingRuntimeItemChange[] = [];
      const delete_item_ids = new Set(input.deleteItemIds.map((item_id) => String(item_id)));
      for (const item_id of delete_item_ids) {
        const change = delete_runtime_item_from_state(current_state, item_id);
        item_changes.push(change);
        if (change.natural_order_changed) {
          should_rebuild_natural_order = true;
        }
      }

      input.patchItemIds.forEach((item_id) => {
        const item_key = String(item_id);
        const previous_item = current_state.raw_item_by_id.get(item_key);
        if (previous_item === undefined) {
          return;
        }
        const patched_item = apply_runtime_item_field_patch(previous_item, input.fieldPatch);
        if (patched_item === null) {
          return;
        }
        const change = upsert_runtime_item_in_state(current_state, patched_item);
        item_changes.push(change);
        if (change.natural_order_changed) {
          should_rebuild_natural_order = true;
        }
      });

      input.upsertItems.forEach((raw_item) => {
        const normalized_item = normalize_runtime_item(raw_item);
        if (normalized_item === null) {
          return;
        }

        const change = upsert_runtime_item_in_state(current_state, normalized_item);
        item_changes.push(change);
        if (change.natural_order_changed) {
          should_rebuild_natural_order = true;
        }
      });

      if (should_rebuild_natural_order) {
        rebuild_natural_item_ids(current_state);
      }

      current_state.defaultFilters = buildDefaultFiltersFromState(current_state);
      list_view_cache = apply_item_changes_to_list_view_cache({
        cache: list_view_cache,
        changes: item_changes,
      });
      return build_runtime_sync_state(current_state);
    },
    /**
     * 构建一次新的列表视图，完成筛选、搜索、排序并缓存 row id 顺序供后续窗口读取
     */
    build_list_view(query: ProofreadingListViewQuery): ProofreadingListView {
      if (state === null) {
        return create_empty_proofreading_list_view();
      }

      const filters = normalize_runtime_filter_options({
        filters: query.filters,
        defaultFilters: state.defaultFilters,
      });
      const filter_context = create_proofreading_filter_context({ filters });
      const search_context = create_proofreading_search_context({
        keyword: query.keyword,
        is_regex: query.is_regex,
        scope: query.scope,
      });
      const sorted_items = sort_proofreading_client_items(
        collect_visible_items_in_natural_order({
          state,
          filter_context,
          search_context,
        }),
        query.sort_state,
      );
      next_list_view_id += 1;
      const revision_signature = build_revision_signature(state.revisions);
      const view_id = `${state.projectId}:${revision_signature}:${next_list_view_id.toString()}`;
      const ordered_item_ids = sorted_items.map((item) => String(item.item_id));
      list_view_cache = create_list_view_cache({
        view_id,
        projectId: state.projectId,
        ordered_item_ids,
      });
      const window_bounds = normalize_window_bounds({
        start: query.window_start,
        count: query.window_count,
        row_count: ordered_item_ids.length,
      });

      return {
        projectId: state.projectId,
        revisions: { ...state.revisions },
        view_id,
        row_count: ordered_item_ids.length,
        window_start: window_bounds.start,
        window_rows: build_window_rows({
          state,
          ordered_item_ids,
          start: window_bounds.start,
          count: window_bounds.count,
        }),
        invalid_regex_message: search_context.matcher.invalid_regex_message,
      };
    },
    /**
     * 读取已构建列表视图的窗口切片，失效 view_id 直接返回空窗口防止旧请求覆盖新 UI
     */
    read_list_window(query: ProofreadingListWindowQuery): ProofreadingListWindow {
      if (
        state === null ||
        list_view_cache === null ||
        list_view_cache.view_id !== query.view_id ||
        list_view_cache.projectId !== state.projectId
      ) {
        return {
          view_id: query.view_id,
          start: 0,
          row_count: 0,
          rows: [],
        };
      }

      const window_bounds = normalize_window_bounds({
        start: query.start,
        count: query.count,
        row_count: list_view_cache.ordered_item_ids.length,
      });
      return {
        view_id: list_view_cache.view_id,
        start: window_bounds.start,
        row_count: list_view_cache.ordered_item_ids.length,
        rows: build_window_rows({
          state,
          ordered_item_ids: list_view_cache.ordered_item_ids,
          start: window_bounds.start,
          count: window_bounds.count,
        }),
      };
    },
    /**
     * 返回当前列表窗口的 row id，供渲染层做选择、批量操作和延迟取详情
     */
    read_row_ids_range(query: ProofreadingRowIdsRangeQuery): string[] {
      if (
        state === null ||
        list_view_cache === null ||
        list_view_cache.view_id !== query.view_id ||
        list_view_cache.projectId !== state.projectId
      ) {
        return [];
      }

      const window_bounds = normalize_window_bounds({
        start: query.start,
        count: query.count,
        row_count: list_view_cache.ordered_item_ids.length,
      });
      return list_view_cache.ordered_item_ids.slice(
        window_bounds.start,
        window_bounds.start + window_bounds.count,
      );
    },
    /**
     * 按 row id 在当前列表视图缓存内解析索引，滚动恢复不需要跨线程传输完整 id 列表
     */
    resolve_row_index(query: ProofreadingRowIndexQuery): number | undefined {
      if (
        state === null ||
        list_view_cache === null ||
        list_view_cache.view_id !== query.view_id ||
        list_view_cache.projectId !== state.projectId
      ) {
        return undefined;
      }

      return list_view_cache.row_index_by_id.get(query.row_id);
    },
    /**
     * 按 row id 精确回读条目，避免详情面板为了少量行重新构建完整列表视图
     */
    read_items_by_row_ids(query: ProofreadingItemsByRowIdsQuery): ProofreadingClientItem[] {
      if (state === null) {
        return [];
      }

      const current_state = state;
      return query.row_ids.flatMap((row_id) => {
        const item = current_state.evaluated_item_by_id.get(row_id);
        return item === undefined ? [] : [item];
      });
    },
    /**
     * 构建筛选面板的可选项和计数，每个维度在计算自身时忽略对应筛选以保留可恢复选项
     */
    build_filter_panel(query: ProofreadingFilterPanelQuery): ProofreadingFilterPanelState {
      if (state === null) {
        return create_empty_proofreading_filter_panel_state();
      }

      const filters = normalize_runtime_filter_options({
        filters: query.filters,
        defaultFilters: state.defaultFilters,
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
      const all_file_paths = [...state.file_count_by_path.keys()].sort(compare_proofreading_text);
      const file_count_by_path = build_file_count_by_path(file_scope_items);

      return {
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
        ].sort(compare_proofreading_text),
        file_count_by_path,
        glossary_term_entries: build_term_count_entries({
          items: term_scope_items,
        }),
        without_glossary_miss_count: term_scope_items.filter((item) => {
          return !item_has_glossary_miss(item);
        }).length,
      };
    },
    /**
     * 只释放身份完全一致的项目缓存；禁止用空项目身份清理全局状态。
     */
    dispose_project(projectId: string): void {
      if (state === null) {
        return;
      }

      if (state.projectId !== projectId) {
        return;
      }

      state = null;
      list_view_cache = null;
    },
  };
}
