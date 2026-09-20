import { JsonTool } from "@shared/utils/json-tool";
import {
  create_empty_proofreading_filter_options,
  clone_proofreading_file_selection,
  build_proofreading_file_key,
  type ProofreadingFileSelection,
  type ProofreadingFilterOptions,
  type ProofreadingSearchScope,
} from "@shared/proofreading/proofreading-types";

type ProofreadingFilterChoice =
  | {
      mode: "default";
    }
  | {
      mode: "selected";
      values: string[];
    };

export type ProofreadingFilterSelection = {
  outcomes: ProofreadingFilterChoice;
  files: ProofreadingFileSelection;
  glossary_entry_ids: ProofreadingFilterChoice;
  include_without_glossary_miss: boolean;
};

export type ProofreadingViewFilterState = {
  selection: ProofreadingFilterSelection;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
};

/** 显式选择保留空集，并隔离调用方数组。 */
function create_selected_filter_choice(values: string[]): ProofreadingFilterChoice {
  return {
    mode: "selected",
    values: [...values],
  };
}

/** 会话快照复制选择值，保留默认与显式意图的区别。 */
function clone_filter_choice(choice: ProofreadingFilterChoice): ProofreadingFilterChoice {
  if (choice.mode === "default") {
    return { mode: "default" };
  }

  return create_selected_filter_choice(choice.values);
}

/** 查询边界按最新默认值展开意图并返回独立数组。 */
function materialize_filter_choice(
  choice: ProofreadingFilterChoice,
  default_values: string[],
): string[] {
  const source_values = choice.mode === "default" ? default_values : choice.values;
  return [...source_values];
}

/**
 * 普通筛选维度按集合语义比较，筛选面板顺序变化不应把默认意图改成显式选择。
 */
function are_string_values_equal(left_values: string[], right_values: string[]): boolean {
  if (left_values.length !== right_values.length) {
    return false;
  }

  const left_signature = [...left_values].sort().join("\n");
  const right_signature = [...right_values].sort().join("\n");
  return left_signature === right_signature;
}

/**
 * 将已物化的普通筛选值恢复成筛选意图，保持未改动维度继续跟随后端默认值。
 */
function resolve_string_filter_choice(args: {
  values: string[];
  default_values: string[];
}): ProofreadingFilterChoice {
  return are_string_values_equal(args.values, args.default_values)
    ? { mode: "default" }
    : create_selected_filter_choice(args.values);
}

/** 页面沿用领域内短名称，空载荷由 shared 协议构造器统一拥有。 */
export function create_empty_filter_options(): ProofreadingFilterOptions {
  return create_empty_proofreading_filter_options();
}

/** 新视图跟随各维度默认范围。 */
export function create_default_proofreading_filter_selection(
  default_filters: ProofreadingFilterOptions = create_empty_filter_options(),
): ProofreadingFilterSelection {
  return {
    outcomes: { mode: "default" },
    files: { mode: "default" },
    glossary_entry_ids: { mode: "default" },
    include_without_glossary_miss: default_filters.include_without_glossary_miss,
  };
}

/** 固定内容筛选，文件范围沿用调用方的选择意图。 */
export function create_selected_proofreading_filter_selection(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterSelection {
  return {
    outcomes: create_selected_filter_choice(filters.outcomes),
    files: clone_proofreading_file_selection(filters.files),
    glossary_entry_ids: create_selected_filter_choice(filters.glossary_entry_ids),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

/** 复制会话选择，供页面独立修改。 */
export function clone_proofreading_filter_selection(
  selection: ProofreadingFilterSelection,
): ProofreadingFilterSelection {
  return {
    outcomes: clone_filter_choice(selection.outcomes),
    files: clone_proofreading_file_selection(selection.files),
    glossary_entry_ids: clone_filter_choice(selection.glossary_entry_ids),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

/**
 * 确认弹窗时恢复内容条件意图，文件范围直接沿用搜索条的选择。
 */
export function resolve_proofreading_filter_selection_from_filters(args: {
  filters: ProofreadingContentFilters;
  default_filters: ProofreadingContentFilters;
  file_selection: ProofreadingFileSelection;
}): ProofreadingFilterSelection {
  return {
    outcomes: resolve_string_filter_choice({
      values: args.filters.outcomes,
      default_values: args.default_filters.outcomes,
    }),
    files: clone_proofreading_file_selection(args.file_selection),
    glossary_entry_ids: resolve_string_filter_choice({
      values: args.filters.glossary_entry_ids,
      default_values: args.default_filters.glossary_entry_ids,
    }),
    include_without_glossary_miss: args.filters.include_without_glossary_miss,
  };
}

/** 内容条件按默认快照展开，文件选择直接传递意图。 */
export function materialize_proofreading_filters(
  selection: ProofreadingFilterSelection,
  default_filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    outcomes: materialize_filter_choice(selection.outcomes, default_filters.outcomes),
    files: clone_proofreading_file_selection(selection.files),
    glossary_entry_ids: materialize_filter_choice(
      selection.glossary_entry_ids,
      default_filters.glossary_entry_ids,
    ),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

/** 工程首次进入时使用默认选择和空搜索。 */
export function create_empty_proofreading_view_filter_state(): ProofreadingViewFilterState {
  return {
    selection: create_default_proofreading_filter_selection(),
    search_keyword: "",
    search_scope: "all",
    is_regex: false,
  };
}

/** 持久化页面会话时隔离可变筛选数组。 */
export function clone_proofreading_view_filter_state(
  filter_state: ProofreadingViewFilterState,
): ProofreadingViewFilterState {
  return {
    selection: clone_proofreading_filter_selection(filter_state.selection),
    search_keyword: filter_state.search_keyword,
    search_scope: filter_state.search_scope,
    is_regex: filter_state.is_regex,
  };
}

/** 查询状态作为整体发布，选择值不与调用方共享数组。 */
export function create_proofreading_view_filter_state(args: {
  selection: ProofreadingFilterSelection;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
}): ProofreadingViewFilterState {
  return {
    selection: clone_proofreading_filter_selection(args.selection),
    search_keyword: args.search_keyword,
    search_scope: args.search_scope,
    is_regex: args.is_regex,
  };
}

/** 集合排序后生成查询签名，忽略用户勾选顺序。 */
export function build_filter_signature(filters: ProofreadingFilterOptions): string {
  return JsonTool.stringifyStrict({
    outcomes: [...filters.outcomes].sort(),
    files:
      filters.files.mode === "default"
        ? filters.files
        : {
            mode: "selected",
            values: [...new Set(filters.files.values.map(build_proofreading_file_key))].sort(),
          },
    glossary_entry_ids: [...filters.glossary_entry_ids].sort(),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  });
}

export type ProofreadingContentFilters = Omit<ProofreadingFilterOptions, "files">;

/** 弹窗只拥有内容条件，文件范围始终由搜索条的查询意图提供。 */
export function clone_content_filters(
  filters: ProofreadingContentFilters,
): ProofreadingContentFilters {
  return {
    outcomes: [...filters.outcomes],
    glossary_entry_ids: [...filters.glossary_entry_ids],
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}
