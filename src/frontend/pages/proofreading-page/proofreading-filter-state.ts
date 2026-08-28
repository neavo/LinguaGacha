import { JsonTool } from "@shared/utils/json-tool";
import {
  create_empty_proofreading_filter_options,
  type ProofreadingFilterOptions,
  type ProofreadingSearchScope,
} from "@shared/proofreading/proofreading-types";

export type ProofreadingFilterChoice<T> =
  | {
      mode: "default";
    }
  | {
      mode: "selected";
      values: T[];
    };

export type ProofreadingFilterSelection = {
  outcomes: ProofreadingFilterChoice<string>;
  file_paths: ProofreadingFilterChoice<string>;
  glossary_entry_ids: ProofreadingFilterChoice<string>;
  include_without_glossary_miss: boolean;
};

export type ProofreadingViewFilterState = {
  selection: ProofreadingFilterSelection;
  search_keyword: string;
  search_scope: ProofreadingSearchScope;
  is_regex: boolean;
};

function create_default_filter_choice<T>(): ProofreadingFilterChoice<T> {
  return {
    mode: "default",
  };
}

function create_selected_filter_choice<T>(
  values: T[],
  clone_value: (value: T) => T,
): ProofreadingFilterChoice<T> {
  return {
    mode: "selected",
    values: values.map((value) => clone_value(value)),
  };
}

function clone_filter_choice<T>(
  choice: ProofreadingFilterChoice<T>,
  clone_value: (value: T) => T,
): ProofreadingFilterChoice<T> {
  if (choice.mode === "default") {
    return create_default_filter_choice();
  }

  return create_selected_filter_choice(choice.values, clone_value);
}

function materialize_filter_choice<T>(
  choice: ProofreadingFilterChoice<T>,
  default_values: T[],
  clone_value: (value: T) => T,
): T[] {
  const source_values = choice.mode === "default" ? default_values : choice.values;
  return source_values.map((value) => clone_value(value));
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
}): ProofreadingFilterChoice<string> {
  return are_string_values_equal(args.values, args.default_values)
    ? create_default_filter_choice()
    : create_selected_filter_choice(args.values, (value) => value);
}

/** 页面沿用领域内短名称，空载荷由 shared 协议构造器统一拥有。 */
export function create_empty_filter_options(): ProofreadingFilterOptions {
  return create_empty_proofreading_filter_options();
}

export function create_default_proofreading_filter_selection(
  default_filters: ProofreadingFilterOptions = create_empty_filter_options(),
): ProofreadingFilterSelection {
  return {
    outcomes: create_default_filter_choice(),
    file_paths: create_default_filter_choice(),
    glossary_entry_ids: create_default_filter_choice(),
    include_without_glossary_miss: default_filters.include_without_glossary_miss,
  };
}

export function create_selected_proofreading_filter_selection(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterSelection {
  return {
    outcomes: create_selected_filter_choice(filters.outcomes, (value) => value),
    file_paths: create_selected_filter_choice(filters.file_paths, (value) => value),
    glossary_entry_ids: create_selected_filter_choice(filters.glossary_entry_ids, (value) => value),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

export function clone_proofreading_filter_selection(
  selection: ProofreadingFilterSelection,
): ProofreadingFilterSelection {
  return {
    outcomes: clone_filter_choice(selection.outcomes, (value) => value),
    file_paths: clone_filter_choice(selection.file_paths, (value) => value),
    glossary_entry_ids: clone_filter_choice(selection.glossary_entry_ids, (value) => value),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

/**
 * 确认筛选弹窗时从最终筛选值反推意图，避免未改动的默认筛选被保存成旧快照。
 */
export function resolve_proofreading_filter_selection_from_filters(args: {
  filters: ProofreadingFilterOptions;
  default_filters: ProofreadingFilterOptions;
}): ProofreadingFilterSelection {
  return {
    outcomes: resolve_string_filter_choice({
      values: args.filters.outcomes,
      default_values: args.default_filters.outcomes,
    }),
    file_paths: resolve_string_filter_choice({
      values: args.filters.file_paths,
      default_values: args.default_filters.file_paths,
    }),
    glossary_entry_ids: resolve_string_filter_choice({
      values: args.filters.glossary_entry_ids,
      default_values: args.default_filters.glossary_entry_ids,
    }),
    include_without_glossary_miss: args.filters.include_without_glossary_miss,
  };
}

export function materialize_proofreading_filters(
  selection: ProofreadingFilterSelection,
  default_filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    outcomes: materialize_filter_choice(
      selection.outcomes,
      default_filters.outcomes,
      (value) => value,
    ),
    file_paths: materialize_filter_choice(
      selection.file_paths,
      default_filters.file_paths,
      (value) => value,
    ),
    glossary_entry_ids: materialize_filter_choice(
      selection.glossary_entry_ids,
      default_filters.glossary_entry_ids,
      (value) => value,
    ),
    include_without_glossary_miss: selection.include_without_glossary_miss,
  };
}

export function create_empty_proofreading_view_filter_state(): ProofreadingViewFilterState {
  return {
    selection: create_default_proofreading_filter_selection(),
    search_keyword: "",
    search_scope: "all",
    is_regex: false,
  };
}

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

export function build_filter_signature(filters: ProofreadingFilterOptions): string {
  return JsonTool.stringifyStrict({
    outcomes: [...filters.outcomes].sort(),
    file_paths: [...filters.file_paths].sort(),
    glossary_entry_ids: [...filters.glossary_entry_ids].sort(),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  });
}
