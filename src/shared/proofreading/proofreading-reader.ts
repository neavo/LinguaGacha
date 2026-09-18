import type { PDFDocumentRecord, PDFPageRecord } from "../pdf";
import {
  build_proofreading_page_row_id,
  proofreading_page_status,
  type ProofreadingRow,
  type ProofreadingFile,
} from "./proofreading-types";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import {
  PROOFREADING_WARNING_CODES,
  PROOFREADING_NO_WARNING_CODE,
  PROOFREADING_OUTCOME_GROUPS,
  clone_proofreading_filter_options,
  create_empty_proofreading_filter_options,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  resolve_proofreading_outcomes,
  type ProofreadingClientItem,
  type ProofreadingEvaluatedItem,
  type ProofreadingEvaluation,
  type ProofreadingContextItem,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingFilterPanelTermEntry,
  type ProofreadingListView,
  type ProofreadingItemRecord,
  type ProofreadingSearchScope,
  type ProofreadingWarningSummary,
  type ProofreadingWarningCode,
} from "./proofreading-types";
import {
  build_proofreading_visible_items,
  create_proofreading_client_item,
  compare_proofreading_runtime_items,
  compare_proofreading_text,
  sort_proofreading_items,
} from "./list";
import { AppError } from "../error";
import type { ProjectChangeItemFieldPatch } from "../project-event";
import { apply_project_item_field_patch } from "../project/project-item-update";
import type { TextPreserveRule } from "../text/text-preserve-rules";
import type { TextProcessingConfig } from "../text/text-types";
import { create_text_keywords_matcher, type TextKeywordsMatcher } from "../text/text-pattern";
import type { ProofreadingSortState } from "./list";
import {
  buildProofreadingEvaluationContext,
  evaluateProofreadingItem,
  type ProofreadingEvaluationContext,
} from "./proofreading-evaluator";
import { Item } from "../../domain/item";
import { read_item_source_text_parts, read_item_translation_text_parts } from "../item-text";

export type { ProofreadingItemRecord } from "./proofreading-types";

type ProofreadingRevisions = {
  files: number;
  items: number;
  quality: number;
  proofreading: number;
  pdf?: number;
};

// 全量同步输入包含项目分段 revision、质量规则快照和完整文本处理配置。
export type ProofreadingSyncInput = {
  projectId: string;
  revisions: ProofreadingRevisions;
  total_item_count: number;
  upsertItems: ProofreadingItemRecord[];
  quality: QualitySnapshot;
  processingConfig: TextProcessingConfig;
};

export type ProofreadingEvaluatedSlice = {
  evaluations: { item_id: number; evaluation: ProofreadingEvaluation }[]; // 请求身份与配置由调用方保留的输入快照拥有。
};

// 已评估同步输入由 worker 结果和主线程质量快照组合而成。
type ProofreadingEvaluatedSyncInput = ProofreadingSyncInput & {
  evaluations: ProofreadingEvaluatedSlice["evaluations"];
};

// 增量输入只携带变化 item，质量规则和文本处理配置沿用已同步状态。
type ProofreadingDeltaInput = {
  projectId: string;
  revisions: ProofreadingRevisions;
  total_item_count: number;
  upsertItems: ProofreadingItemRecord[];
  patchItemIds: number[];
  fieldPatch: ProjectChangeItemFieldPatch | null;
  deleteItemIds: number[];
};

// 列表视图查询把筛选、搜索、排序和虚拟窗口边界集中传入运行态。
export type ProofreadingListViewQuery = {
  filters: ProofreadingFilterOptions;
  keyword: string;
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  sort_state: ProofreadingSortState | null;
  window_start?: number;
  window_count?: number;
  // 稳定行锚点优先于 window_start，让新视图一次返回目标附近窗口。
  window_anchor?: {
    row_id: string;
    offset: number;
  };
};

// Agent warning 查询只读取真实警告，并使用自然顺序的偏移分页。
export type ProofreadingWarningQuery = {
  warning_types: ProofreadingWarningCode[];
  statuses?: string[];
  file_paths?: string[];
  keywords: string[];
  scope: ProofreadingSearchScope;
  offset: number;
  limit: number;
};

export type ProofreadingWarningPage = {
  total_item_count: number;
  items: ProofreadingClientItem[];
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

// 上下文查询固定读取同文件自然顺序邻项，不接收当前列表 view_id。
export type ProofreadingContextQuery = {
  row_id: string;
};

// 列表窗口响应保持轻量，只返回当前窗口内的可见行
export type ProofreadingListWindow = {
  view_id: string;
  start: number;
  row_count: number;
  rows: ProofreadingRow[];
};

// 同步状态是页面判断列表缓存是否可继续复用的最小凭据，语言变化必须触发全量重建
export type ProofreadingSyncState = {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  revisions: ProofreadingRevisions;
  defaultFilters: ProofreadingFilterOptions;
  files: ProofreadingFile[];
};

// 校对完整运行态，GUI 列表与 Agent warning 查询共享同一份评估事实。
type ProofreadingReaderState = {
  projectId: string;
  revisions: ProofreadingRevisions;
  total_item_count: number;
  quality: QualitySnapshot;
  processingConfig: TextProcessingConfig;
  quality_context: ProofreadingEvaluationContext;
  sample_rule_cache: Map<string, TextPreserveRule>;
  page_by_id: Map<string, PDFPageRecord>;
  files: ProofreadingFile[];
  item_by_id: Map<string, ProofreadingEvaluatedItem>;
  natural_item_ids: string[]; // 上下文沿工程文件顺序与数值 item_id 排列。
  default_item_ids: string[] | null; // 默认列表沿文件名、行号、字符串 row_id 排列，按需生成。
  outcome_count_by_code: Map<string, number>; // 全部状态用于筛选面板的可选结果。
  translated_outcome_count_by_code: Map<string, number>; // 仅成功条目用于默认警告选项与警告摘要。
  file_count_by_path: Map<string, number>;
  glossary_term_count_map: Map<string, ProofreadingFilterPanelTermEntry>;
  defaultFilters: ProofreadingFilterOptions;
};

type ProofreadingItemChange = {
  item_id: string; // 变更记录统一使用 row id 字符串，直接对接列表缓存
  removed_from_runtime: boolean; // 只有后端 tombstone 能改变旧结果视图的成员集合
  natural_order_changed: boolean; // 文件、行号或 item_id 变化会影响所有排序的兜底顺序
};

// 列表视图缓存只保存显式查询生成的稳定行 ID 序列，让用户在筛选校对后能先确认重翻结果
type ProofreadingListViewCache = {
  view_id: string;
  projectId: string;
  ordered_row_ids: string[];
  // 让恢复滚动按 row id O(1) 定位，不需要把完整视图传回渲染进程。
  row_index_by_id: Map<string, number>;
};

// 单次筛选查询的预编译上下文，避免在每个 item 上重复构造 Set
type ProofreadingFilterContext = {
  outcome_set: Set<string> | null; // null 表示当前查询忽略翻译结果维度
  file_path_set: Set<string> | null; // null 表示当前查询忽略 file 维度
  glossary_filter_enabled: boolean; // false 表示当前查询忽略术语维度
  glossary_entry_id_set: Set<string>; // 术语缺失筛选直接使用稳定条目身份
  include_without_glossary_miss: boolean; // 是否保留没有术语缺失的条目
};

// 单次搜索查询的预编译上下文，普通文本走包含匹配，正则只编译一次
type ProofreadingSearchContext = {
  matcher: TextKeywordsMatcher; // 由共享文本规则生成的稳定匹配器
  scope: ProofreadingSearchScope; // 当前搜索范围：原文、译文或两者
};

// 内部公共查询形状允许 GUI 完整筛选和 Agent 部分筛选共用一次解析。
type ProofreadingItemsReadQuery = {
  filters: Partial<ProofreadingFilterOptions>;
  keywords: string[];
  scope: ProofreadingSearchScope;
  is_regex: boolean;
  case_sensitive: boolean;
  sort_state: ProofreadingSortState | null;
};

// 查询结果同时携带非法正则诊断，调用方决定展示或转成工具错误。
type ResolvedProofreadingItems = {
  items: ProofreadingEvaluatedItem[];
  invalid_regex_message: string | null;
};

const PROOFREADING_DEFAULT_WINDOW_COUNT = 160; // 默认窗口大小控制每次返回量，防止大项目一次复制全量行
const PROOFREADING_CONTEXT_RADIUS = 2; // 固定前后各两条，避免 UI 与 reader 各自维护窗口语义

/**
 * 在响应边界构造展示字段并隔离可变数组，运行态不持有展示文本副本。
 */
function to_client_item(item: ProofreadingEvaluatedItem): ProofreadingClientItem {
  return create_proofreading_client_item({
    item,
    warnings: item.warnings,
    warning_fragments_by_code: item.warning_fragments_by_code,
    glossary_applications: item.glossary_applications,
  });
}

/**
 * 字符串去重保持首次出现顺序，筛选项和 warning 片段都依赖这个稳定性
 */
function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 外部筛选输入可能不完整，必须和默认筛选合并后再参与计算
 */
function normalize_runtime_filter_options(args: {
  filters: Partial<ProofreadingFilterOptions> | undefined;
  defaultFilters: ProofreadingFilterOptions;
}): ProofreadingFilterOptions {
  const filters = args.filters;
  const has_outcomes = Array.isArray(filters?.outcomes);
  const has_file_paths = Array.isArray(filters?.file_paths);
  const has_glossary_entry_ids = Array.isArray(filters?.glossary_entry_ids);
  const has_include_without_glossary_miss =
    typeof filters?.include_without_glossary_miss === "boolean";

  const glossary_entry_ids = has_glossary_entry_ids
    ? unique_strings((filters?.glossary_entry_ids ?? []).map((value) => String(value)))
    : [];

  return {
    outcomes: has_outcomes
      ? unique_strings((filters?.outcomes ?? []).map((value) => String(value)))
      : [...args.defaultFilters.outcomes],
    file_paths: has_file_paths
      ? unique_strings((filters?.file_paths ?? []).map((value) => String(value)))
      : [...args.defaultFilters.file_paths],
    glossary_entry_ids: has_glossary_entry_ids
      ? glossary_entry_ids
      : [...args.defaultFilters.glossary_entry_ids],
    include_without_glossary_miss: has_include_without_glossary_miss
      ? Boolean(filters?.include_without_glossary_miss)
      : args.defaultFilters.include_without_glossary_miss,
  };
}

/**
 * 术语 miss 只看字段级落实结果。
 */
function item_has_glossary_miss(item: ProofreadingEvaluatedItem): boolean {
  return item.glossary_applications.some((application) =>
    application.fields.some((field) => !field.applied),
  );
}

/**
 * 将可选校对筛选值编译成单次查询上下文，大列表过滤时直接复用集合
 */
function create_proofreading_filter_context(args: {
  filters: Partial<ProofreadingFilterOptions>;
}): ProofreadingFilterContext {
  const glossary_filter_enabled =
    args.filters.glossary_entry_ids !== undefined ||
    args.filters.include_without_glossary_miss !== undefined;

  return {
    outcome_set: args.filters.outcomes === undefined ? null : new Set(args.filters.outcomes),
    file_path_set: args.filters.file_paths === undefined ? null : new Set(args.filters.file_paths),
    glossary_filter_enabled,
    glossary_entry_id_set: glossary_filter_enabled
      ? new Set(args.filters.glossary_entry_ids ?? [])
      : new Set<string>(),
    include_without_glossary_miss: args.filters.include_without_glossary_miss ?? false,
  };
}

/**
 * 搜索上下文统一使用共享文本规则，普通关键字不再为每个候选文本创建 RegExp
 */
function create_proofreading_search_context(args: {
  keywords: string[];
  is_regex: boolean;
  scope: ProofreadingSearchScope;
  case_sensitive: boolean;
}): ProofreadingSearchContext {
  return {
    matcher: create_text_keywords_matcher({
      keywords: args.keywords,
      is_regex: args.is_regex,
      case_sensitive: args.case_sensitive,
    }),
    scope: args.scope,
  };
}

/**
 * 术语筛选支持“无术语缺失”开关和指定 miss 术语列表两种语义
 */
function item_matches_glossary_filter(
  item: ProofreadingEvaluatedItem,
  context: ProofreadingFilterContext,
): boolean {
  if (!context.glossary_filter_enabled) {
    return true;
  }

  if (!item_has_glossary_miss(item)) {
    return context.include_without_glossary_miss;
  }

  if (context.glossary_entry_id_set.size === 0) {
    return false;
  }

  return item.glossary_applications.some((application) => {
    return (
      context.glossary_entry_id_set.has(application.entry_id) &&
      application.fields.some((field) => !field.applied)
    );
  });
}

/**
 * 单个 item 必须同时满足翻译结果、文件和术语筛选
 */
function item_matches_filter_context(
  item: ProofreadingEvaluatedItem,
  context: ProofreadingFilterContext,
): boolean {
  if (context.outcome_set !== null) {
    const outcome_set = context.outcome_set;
    const matches =
      item.status === "PROCESSED"
        ? item.warnings.length === 0
          ? outcome_set.has(PROOFREADING_NO_WARNING_CODE)
          : item.warnings.some((warning) => outcome_set.has(warning))
        : outcome_set.has(item.status);
    if (!matches) {
      return false;
    }
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
  item: ProofreadingEvaluatedItem;
  search_context: ProofreadingSearchContext;
}): boolean {
  if (
    args.search_context.matcher.keywords.length === 0 ||
    args.search_context.matcher.invalid_regex !== null
  ) {
    return true;
  }

  if (args.search_context.scope === "src") {
    return read_item_source_text_parts(args.item).some((part) => {
      return args.search_context.matcher.matches(part.text);
    });
  }

  if (args.search_context.scope === "dst") {
    return read_item_translation_text_parts(args.item).some((part) => {
      return args.search_context.matcher.matches(part.text);
    });
  }

  return (
    read_item_source_text_parts(args.item).some((part) => {
      return args.search_context.matcher.matches(part.text);
    }) ||
    read_item_translation_text_parts(args.item).some((part) => {
      return args.search_context.matcher.matches(part.text);
    })
  );
}

/**
 * 计数 map 支持正负增量，归零时删除键避免面板出现空值项
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
 * 增量更新时同步维护所有计数索引，避免每次变更都全量重建
 */
function apply_counter_delta(args: {
  state: ProofreadingReaderState;
  item: ProofreadingEvaluatedItem;
  delta: number;
}): void {
  increment_map_count(args.state.file_count_by_path, args.item.file_path, args.delta);
  for (const outcome of resolve_proofreading_outcomes(args.item)) {
    increment_map_count(args.state.outcome_count_by_code, outcome, args.delta);
    if (args.item.status === "PROCESSED") {
      increment_map_count(args.state.translated_outcome_count_by_code, outcome, args.delta);
    }
  }

  args.item.glossary_applications.forEach((application) => {
    if (application.fields.every((field) => field.applied)) return;
    const previous_entry = args.state.glossary_term_count_map.get(application.entry_id);
    const next_count = (previous_entry?.count ?? 0) + args.delta;
    if (next_count <= 0) {
      args.state.glossary_term_count_map.delete(application.entry_id);
      return;
    }

    args.state.glossary_term_count_map.set(application.entry_id, {
      entry_id: application.entry_id,
      src: application.src,
      dst: application.dst,
      count: next_count,
    });
  });
}

/**
 * 单条 raw item 更新会同步重评估警告和所有筛选计数，并输出自然顺序和删除剪裁需要的变更记录。
 */
function upsert_runtime_item_in_state(
  state: ProofreadingReaderState,
  item: ProofreadingItemRecord,
): ProofreadingItemChange {
  const item_key = String(item.item_id);
  const previous = state.item_by_id.get(item_key);
  const natural_order_changed =
    previous === undefined || compare_proofreading_runtime_items(previous, item) !== 0;
  if (previous !== undefined) apply_counter_delta({ state, item: previous, delta: -1 });
  const next: ProofreadingEvaluatedItem = {
    ...item,
    ...evaluateProofreadingItem({
      item,
      quality_context: state.quality_context,
      quality: state.quality,
      processingConfig: state.processingConfig,
      sample_rule_cache: state.sample_rule_cache,
    }),
  };
  state.item_by_id.set(item_key, next);
  apply_counter_delta({ state, item: next, delta: 1 });
  return { item_id: item_key, removed_from_runtime: false, natural_order_changed };
}

/**
 * 删除也产出同形变更记录，列表缓存不需要关心增量来源是 tombstone 还是 upsert。
 */
function delete_runtime_item_from_state(
  state: ProofreadingReaderState,
  item_id: string,
): ProofreadingItemChange {
  const previous = state.item_by_id.get(item_id);
  if (previous !== undefined) apply_counter_delta({ state, item: previous, delta: -1 });
  state.item_by_id.delete(item_id);
  return {
    item_id,
    removed_from_runtime: previous !== undefined,
    natural_order_changed: previous !== undefined,
  };
}

/**
 * 默认筛选选择分组声明的常用范围，并稳定追加运行时新增的成功检查类型。
 */
function buildDefaultFiltersFromState(state: ProofreadingReaderState): ProofreadingFilterOptions {
  const known_outcomes = PROOFREADING_OUTCOME_GROUPS.flatMap((group) => [...group.outcome_codes]);
  const known_outcome_set = new Set<string>(known_outcomes);
  const default_outcomes = PROOFREADING_OUTCOME_GROUPS.filter(
    (group) => group.selected_by_default,
  ).flatMap((group) => [...group.outcome_codes]);
  const extra_outcomes = [...state.translated_outcome_count_by_code.keys()]
    .filter((outcome) => !known_outcome_set.has(outcome))
    .sort((left, right) => left.localeCompare(right));

  const file_paths = state.files.map((file) => file.file_path).sort(compare_proofreading_text);
  const glossary_entry_ids = [...state.glossary_term_count_map.keys()].sort(
    compare_proofreading_text,
  );

  return {
    outcomes: [...default_outcomes, ...extra_outcomes],
    file_paths,
    glossary_entry_ids,
    include_without_glossary_miss: true,
  };
}

/**
 * 自然顺序缓存只保存 row id，避免排序结果复制完整条目导致内存翻倍
 */
function rebuild_natural_item_ids(state: ProofreadingReaderState): void {
  state.default_item_ids = null;
  state.natural_item_ids = [...state.item_by_id.values()]
    .sort(compare_proofreading_runtime_items)
    .map((item) => String(item.item_id));
}

/** 视图序号隔离每次查询，修订号标识该视图对应的数据版本。 */
function build_revision_signature(revisions: ProofreadingRevisions): string {
  return `${revisions.items.toString()}:${revisions.quality.toString()}:${revisions.proofreading.toString()}`;
}

/**
 * 页面只需要同步凭据和默认筛选，完整条目继续留在校对运行态内部按窗口读取
 */
function build_sync_state(state: ProofreadingReaderState): ProofreadingSyncState {
  return {
    projectId: state.projectId,
    sourceLanguage: state.processingConfig.source_language,
    targetLanguage: state.processingConfig.target_language,
    revisions: { ...state.revisions },
    defaultFilters: clone_proofreading_filter_options(state.defaultFilters),
    files: state.files.map((file) => ({ ...file })),
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
 * 根据缓存 row id 切片回读当前窗口，确保排序与筛选只在构建列表视图时发生一次
 */
function build_window_rows(args: {
  state: ProofreadingReaderState;
  ordered_row_ids: string[];
  start: number;
  count: number;
}): ProofreadingRow[] {
  return args.ordered_row_ids
    .slice(args.start, args.start + args.count)
    .flatMap((row_id): ProofreadingRow[] => {
      const item = args.state.item_by_id.get(row_id);
      if (item) return build_proofreading_visible_items([to_client_item(item)]);
      const record = args.state.page_by_id.get(row_id);
      if (!record) return [];
      const { file_path, page } = record;
      const translation = page.translation;
      return [
        {
          kind: "page",
          row_id,
          page: {
            file_path,
            page: page.page,
            status: proofreading_page_status(translation),
          },
        },
      ];
    });
}

// 统一维护有序 id 列表和反向索引，避免增量更新忘记重建索引。
function create_list_view_cache(args: {
  view_id: string;
  projectId: string;
  ordered_row_ids: string[];
}): ProofreadingListViewCache {
  return {
    view_id: args.view_id,
    projectId: args.projectId,
    ordered_row_ids: args.ordered_row_ids,
    row_index_by_id: new Map(
      args.ordered_row_ids.map((item_id, index) => {
        return [item_id, index] as const;
      }),
    ),
  };
}

/**
 * worker 返回 ID 与评估事实，原始正文由调用方保留的同次输入快照提供。
 */
export function evaluateProofreadingSlice(
  input: ProofreadingSyncInput,
): ProofreadingEvaluatedSlice {
  const quality_context = buildProofreadingEvaluationContext(input.quality);
  const sample_rule_cache = new Map<string, TextPreserveRule>();
  return {
    evaluations: input.upsertItems.map((item) => ({
      item_id: item.item_id,
      evaluation: evaluateProofreadingItem({
        item,
        quality_context,
        quality: input.quality,
        processingConfig: input.processingConfig,
        sample_rule_cache,
      }),
    })),
  };
}

/**
 * 主运行态从已评估分片重建唯一完整运行态，筛选统计和列表缓存仍只在这里维护。
 */
function create_run_state_from_evaluated(
  input: ProofreadingEvaluatedSyncInput,
): ProofreadingReaderState {
  const state: ProofreadingReaderState = {
    projectId: input.projectId,
    revisions: { ...input.revisions },
    total_item_count: input.total_item_count,
    quality: input.quality,
    processingConfig: { ...input.processingConfig },
    quality_context: buildProofreadingEvaluationContext(input.quality),
    sample_rule_cache: new Map(),
    item_by_id: new Map(),
    page_by_id: new Map(),
    files: [],
    natural_item_ids: [],
    default_item_ids: null,
    outcome_count_by_code: new Map(),
    translated_outcome_count_by_code: new Map(),
    file_count_by_path: new Map(),
    glossary_term_count_map: new Map(),
    defaultFilters: create_empty_proofreading_filter_options(),
  };
  const evaluations = new Map(
    input.evaluations.map(({ item_id, evaluation }) => [item_id, evaluation]),
  );
  for (const item of input.upsertItems) {
    const evaluation = evaluations.get(item.item_id);
    if (evaluation === undefined)
      throw new AppError("runtime.internal_invariant", {
        diagnostic_context: { reason: "proofreading_evaluation_missing", item_id: item.item_id },
      });
    const evaluated: ProofreadingEvaluatedItem = { ...item, ...evaluation };
    state.item_by_id.set(String(item.item_id), evaluated);
    apply_counter_delta({ state, item: evaluated, delta: 1 });
  }
  rebuild_natural_item_ids(state);
  state.files = [...state.file_count_by_path].map(([file_path, count]) => ({
    file_path,
    kind: "item",
    count,
  }));
  state.defaultFilters = buildDefaultFiltersFromState(state);
  return state;
}

/**
 * 查询沿默认列表顺序收集结果，避免重复排序；上下文继续使用独立的工程自然顺序。
 */
function collect_visible_items(args: {
  state: ProofreadingReaderState;
  filter_context: ProofreadingFilterContext;
  search_context: ProofreadingSearchContext;
}): ProofreadingEvaluatedItem[] {
  const matched_items: ProofreadingEvaluatedItem[] = [];
  const state = args.state;
  const ordered_ids = (state.default_item_ids ??= sort_proofreading_items(
    [...state.item_by_id.values()],
    null,
  ).map((item) => String(item.item_id)));
  ordered_ids.forEach((item_id) => {
    const item = args.state.item_by_id.get(item_id);
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

/** 共享校对筛选、搜索与排序核心，不读写 GUI 列表视图状态。 */
function resolve_proofreading_items(
  state: ProofreadingReaderState,
  query: ProofreadingItemsReadQuery,
): ResolvedProofreadingItems {
  const filter_context = create_proofreading_filter_context({ filters: query.filters });
  const search_context = create_proofreading_search_context({
    keywords: query.keywords,
    is_regex: query.is_regex,
    scope: query.scope,
    case_sensitive: query.case_sensitive,
  });
  const items = collect_visible_items({ state, filter_context, search_context });
  const uses_default_order =
    query.sort_state === null ||
    (query.sort_state.column_id === "file" && query.sort_state.direction === "ascending");
  return {
    items: uses_default_order ? items : sort_proofreading_items(items, query.sort_state),
    invalid_regex_message: search_context.matcher.invalid_regex?.message ?? null,
  };
}

/**
 * item 增量提交后只从当前结果快照剪除 tombstone；字段变化只刷新行内容，不重新执行筛选或排序。
 * 这保证重翻修复术语命中后，行仍停留在当前筛选结果里供用户检查其它问题。
 */
function apply_item_changes_to_list_view_cache(args: {
  cache: ProofreadingListViewCache | null;
  changes: ProofreadingItemChange[];
}): ProofreadingListViewCache | null {
  if (args.cache === null || args.changes.length === 0) {
    return args.cache;
  }

  const deleted_item_ids = new Set(
    args.changes.filter((change) => change.removed_from_runtime).map((change) => change.item_id),
  );
  if (deleted_item_ids.size === 0) {
    return args.cache;
  }

  const next_ordered_row_ids = args.cache.ordered_row_ids.filter((item_id) => {
    return !deleted_item_ids.has(item_id);
  });
  return create_list_view_cache({
    view_id: args.cache.view_id,
    projectId: args.cache.projectId,
    ordered_row_ids: next_ordered_row_ids,
  });
}

/**
 * 创建校对运行态实例，集中管理评估事实、GUI 列表缓存和筛选面板数据。
 */
export function createProofreadingReader() {
  let state: ProofreadingReaderState | null = null; // 当前项目的完整运行态，dispose 或跨项目同步前不得泄露给渲染层
  let list_view_cache: ProofreadingListViewCache | null = null; // 最近一次列表视图的排序结果缓存，窗口滚动只读取 id 切片
  let next_list_view_id = 0; // 视图 id 单调递增，避免同 revision 下筛选条件变化时复用旧窗口请求

  return {
    /** 页面快照独立同步，不触发文本评估，也不改变旧视图的排序成员。 */
    sync_pages(
      documents: PDFDocumentRecord[],
      files: { rel_path: string; file_type: string }[],
      revision: number,
    ): ProofreadingSyncState {
      if (state === null) throw new AppError("runtime.internal_invariant");
      const previous_pages = state.page_by_id;
      state.page_by_id = new Map(
        documents.flatMap(({ file_path, document }) =>
          document.pages.map(
            (page) =>
              [
                build_proofreading_page_row_id(file_path, page.page),
                { file_path, page: structuredClone(page) },
              ] as const,
          ),
        ),
      );
      const page_counts = new Map(
        documents.map(({ file_path, document }) => [file_path, document.pages.length]),
      );
      state.files = files.map(({ rel_path, file_type }) => ({
        file_path: rel_path,
        kind: file_type === "PDF" ? "page" : "item",
        count: page_counts.get(rel_path) ?? state!.file_count_by_path.get(rel_path) ?? 0,
      }));
      state.revisions = { ...state.revisions, pdf: revision };
      state.defaultFilters = buildDefaultFiltersFromState(state);
      const deleted_page_ids = new Set(
        [...previous_pages.keys()].filter((id) => !state!.page_by_id.has(id)),
      );
      if (list_view_cache && deleted_page_ids.size > 0)
        list_view_cache = create_list_view_cache({
          ...list_view_cache,
          ordered_row_ids: list_view_cache.ordered_row_ids.filter(
            (id) => !deleted_page_ids.has(id),
          ),
        });
      return build_sync_state(state);
    },
    /**
     * 合并已评估分片并重建完整运行态，最终索引仍由主 reader 持有。
     */
    sync_evaluated_full(input: ProofreadingEvaluatedSyncInput): ProofreadingSyncState {
      state = create_run_state_from_evaluated(input);
      list_view_cache = null;
      return build_sync_state(state);
    },
    /**
     * 应用项目事件流中的条目增量，同时维护计数、自然顺序和默认筛选
     */
    apply_item_delta(input: ProofreadingDeltaInput): ProofreadingSyncState {
      if (state === null || state.projectId !== input.projectId) {
        throw new AppError("runtime.internal_invariant", {
          diagnostic_context: { reason: "proofreading_runtime_requires_project_sync" },
        });
      }

      const current_state = state;
      const revisions = input.revisions;
      let should_rebuild_natural_order = input.total_item_count !== current_state.total_item_count;

      if (
        revisions.quality !== current_state.revisions.quality ||
        revisions.proofreading < current_state.revisions.proofreading
      ) {
        throw new AppError("runtime.internal_invariant", {
          diagnostic_context: {
            reason: "proofreading_runtime_delta_revision_incompatible",
            current_revisions: current_state.revisions,
            input_revisions: revisions,
          },
        });
      }

      current_state.revisions = { ...revisions, pdf: current_state.revisions.pdf };
      current_state.total_item_count = input.total_item_count;

      const item_changes: ProofreadingItemChange[] = [];
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
        const previous_item = current_state.item_by_id.get(item_key);
        if (previous_item === undefined) {
          return;
        }
        const patched_item = apply_project_item_field_patch(previous_item, input.fieldPatch);
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
        const change = upsert_runtime_item_in_state(current_state, raw_item);
        item_changes.push(change);
        if (change.natural_order_changed) {
          should_rebuild_natural_order = true;
        }
      });

      if (should_rebuild_natural_order) {
        rebuild_natural_item_ids(current_state);
      }

      current_state.files = current_state.files.map((file) =>
        file.kind === "item"
          ? { ...file, count: current_state.file_count_by_path.get(file.file_path) ?? 0 }
          : file,
      );
      current_state.defaultFilters = buildDefaultFiltersFromState(current_state);
      list_view_cache = apply_item_changes_to_list_view_cache({
        cache: list_view_cache,
        changes: item_changes,
      });
      return build_sync_state(current_state);
    },
    /**
     * 构建一次新的列表视图，完成筛选、搜索、排序并缓存 row id 顺序供后续窗口读取
     */
    read_list_view(query: ProofreadingListViewQuery): ProofreadingListView {
      if (state === null) {
        return create_empty_proofreading_list_view();
      }

      const filters = normalize_runtime_filter_options({
        filters: query.filters,
        defaultFilters: state.defaultFilters,
      });
      const resolved = resolve_proofreading_items(state, {
        filters,
        keywords: [query.keyword],
        is_regex: query.is_regex,
        scope: query.scope,
        case_sensitive: false,
        sort_state: state.page_by_id.size === 0 ? query.sort_state : null,
      });
      next_list_view_id += 1;
      const revision_signature = build_revision_signature(state.revisions);
      const view_id = `${state.projectId}:${revision_signature}:${next_list_view_id.toString()}`;
      let ordered_row_ids = resolved.items.map((item) => String(item.item_id));
      if (state.page_by_id.size > 0) {
        // 内容条件属于文本校对；原稿页只消费公共文件范围与搜索。
        const file_paths = new Set(filters.file_paths);
        const search = create_proofreading_search_context({
          keywords: [query.keyword],
          scope: query.scope,
          is_regex: query.is_regex,
          case_sensitive: false,
        });
        const pages = [...state.page_by_id.values()].filter((record) => {
          if (!file_paths.has(record.file_path)) return false;
          if (search.matcher.keywords.length === 0 || search.matcher.invalid_regex !== null)
            return true;
          return (
            search.scope !== "src" &&
            record.page.translation?.kind === "translate" &&
            search.matcher.matches(record.page.translation.markdown)
          );
        });
        // 临时排序字段不进入运行态或响应，不把页面伪造为可编辑 Item。
        const rows = resolved.items.map((item) => ({
          item_id: String(item.item_id),
          file_path: item.file_path,
          row_number: item.row_number,
          src: item.src,
          dst: item.dst,
          status: item.status,
        }));
        rows.push(
          ...pages.map(({ file_path, page }) => ({
            item_id: build_proofreading_page_row_id(file_path, page.page),
            file_path,
            row_number: page.page,
            src: String(page.page).padStart(12, "0"),
            dst: "", // 页面译文列只提供查看入口，排序沿文件和页码兜底。
            status: proofreading_page_status(page.translation),
          })),
        );
        ordered_row_ids = sort_proofreading_items(rows, query.sort_state).map((row) => row.item_id);
      }
      list_view_cache = create_list_view_cache({
        view_id,
        projectId: state.projectId,
        ordered_row_ids,
      });
      const anchor_offset = query.window_anchor?.offset ?? 0;
      const anchor_index =
        query.window_anchor === undefined
          ? undefined
          : list_view_cache.row_index_by_id.get(query.window_anchor.row_id);
      const window_bounds = normalize_window_bounds({
        start: anchor_index === undefined ? query.window_start : anchor_index - anchor_offset,
        count: query.window_count,
        row_count: ordered_row_ids.length,
      });

      return {
        projectId: state.projectId,
        revisions: { ...state.revisions },
        view_id,
        row_count: ordered_row_ids.length,
        window_start: window_bounds.start,
        window_rows: build_window_rows({
          state,
          ordered_row_ids,
          start: window_bounds.start,
          count: window_bounds.count,
        }),
        invalid_regex_message: resolved.invalid_regex_message,
      };
    },
    /** 读取真实 warning 分页，不创建、替换或推进 GUI 视图。 */
    read_warning_page(query: ProofreadingWarningQuery): ProofreadingWarningPage {
      if (state === null) {
        return { total_item_count: 0, items: [] };
      }

      // Agent warning 查询只消费成功条目的检查结果；不包含成功状态的显式范围直接为空。
      const warning_outcomes =
        query.statuses === undefined || query.statuses.includes("PROCESSED")
          ? query.warning_types
          : [];
      const resolved = resolve_proofreading_items(state, {
        filters: {
          outcomes: warning_outcomes,
          ...(query.file_paths === undefined ? {} : { file_paths: query.file_paths }),
        },
        keywords: query.keywords,
        scope: query.scope,
        is_regex: false,
        case_sensitive: false,
        sort_state: null,
      });
      const bounds = normalize_window_bounds({
        start: query.offset,
        count: query.limit,
        row_count: resolved.items.length,
      });
      return {
        total_item_count: resolved.items.length,
        items: resolved.items.slice(bounds.start, bounds.start + bounds.count).map(to_client_item),
      };
    },
    /** 汇总当前成功译文的真实 warning，不创建 GUI 列表视图。 */
    read_warning_summary(): ProofreadingWarningSummary {
      if (state === null) {
        return { total_count: 0, entries: [] };
      }
      const counts = state.translated_outcome_count_by_code;
      const entries = PROOFREADING_WARNING_CODES.flatMap((code) => {
        const count = counts.get(code) ?? 0;
        return count === 0 ? [] : [{ code, count }];
      });
      return { total_count: entries.reduce((sum, entry) => sum + entry.count, 0), entries };
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
        row_count: list_view_cache.ordered_row_ids.length,
      });
      return {
        view_id: list_view_cache.view_id,
        start: window_bounds.start,
        row_count: list_view_cache.ordered_row_ids.length,
        rows: build_window_rows({
          state,
          ordered_row_ids: list_view_cache.ordered_row_ids,
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
        row_count: list_view_cache.ordered_row_ids.length,
      });
      return list_view_cache.ordered_row_ids.slice(
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
        const item = current_state.item_by_id.get(row_id);
        return item === undefined ? [] : [to_client_item(item)];
      });
    },
    /**
     * 从原始自然顺序读取同文件上下文，不创建或替换当前筛选列表视图。
     */
    read_context_items(query: ProofreadingContextQuery): ProofreadingContextItem[] {
      if (state === null) {
        return [];
      }

      const current_state = state;
      const target_index = current_state.natural_item_ids.indexOf(query.row_id);
      const target_item = current_state.item_by_id.get(query.row_id);
      if (target_index < 0 || target_item === undefined) {
        return [];
      }

      const context_item_ids = [query.row_id];
      for (const direction of [-1, 1] as const) {
        let found_count = 0;
        for (
          let index = target_index + direction;
          index >= 0 &&
          index < current_state.natural_item_ids.length &&
          found_count < PROOFREADING_CONTEXT_RADIUS;
          index += direction
        ) {
          const item_id = current_state.natural_item_ids[index];
          const item = current_state.item_by_id.get(item_id);
          if (item === undefined) {
            continue;
          }
          if (item.file_path !== target_item.file_path) {
            break;
          }
          if (item.src.trim() === "") {
            continue;
          }

          if (direction < 0) {
            context_item_ids.unshift(item_id);
          } else {
            context_item_ids.push(item_id);
          }
          found_count += 1;
        }
      }

      return context_item_ids.flatMap((item_id) => {
        const item = current_state.item_by_id.get(item_id);
        if (item === undefined) {
          return [];
        }
        return [
          {
            row_id: String(item.item_id),
            row_number: item.row_number,
            src: item.src,
            dst: item.dst,
            name_src: Item.normalize_name_field(item.name_src),
            name_dst: Item.normalize_name_field(item.name_dst),
          },
        ];
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
      const context = create_proofreading_filter_context({ filters });
      const outcome_count_by_code: Record<string, number> = {};
      const terms = new Map<string, ProofreadingFilterPanelTermEntry>();
      let without_glossary_miss_count = 0;
      for (const item of state.item_by_id.values()) {
        const outcomes = resolve_proofreading_outcomes(item);
        const file_matches =
          context.file_path_set === null || context.file_path_set.has(item.file_path);
        const outcome_set = context.outcome_set;
        const outcome_matches =
          outcome_set === null || outcomes.some((value) => outcome_set.has(value));
        if (file_matches) {
          for (const outcome of outcomes) {
            outcome_count_by_code[outcome] = (outcome_count_by_code[outcome] ?? 0) + 1;
          }
        }
        if (!file_matches || !outcome_matches) continue;
        if (!item_has_glossary_miss(item)) without_glossary_miss_count++;
        if (!item.warnings.includes("GLOSSARY")) continue;
        for (const application of item.glossary_applications) {
          if (application.fields.every((field) => field.applied)) continue;
          const previous = terms.get(application.entry_id);
          terms.set(application.entry_id, {
            entry_id: application.entry_id,
            src: application.src,
            dst: application.dst,
            count: (previous?.count ?? 0) + 1,
          });
        }
      }
      const known_outcomes = PROOFREADING_OUTCOME_GROUPS.flatMap((group) => [
        ...group.outcome_codes,
      ]);
      const known_set = new Set<string>(known_outcomes);
      // 扩展选项来自当前文本结果，查询条件本身不创建面板选项。
      const extra_outcomes = [...state.outcome_count_by_code.keys()]
        .filter((value) => !known_set.has(value))
        .sort((left, right) => left.localeCompare(right));
      return {
        available_outcomes: [...known_outcomes, ...extra_outcomes],
        outcome_count_by_code,
        glossary_term_entries: [...terms.values()].sort(
          (left, right) => right.count - left.count || left.entry_id.localeCompare(right.entry_id),
        ),
        without_glossary_miss_count,
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
