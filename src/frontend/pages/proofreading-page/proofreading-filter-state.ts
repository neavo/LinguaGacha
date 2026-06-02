import { JsonTool } from "@shared/utils/json-tool";
import {
  clone_proofreading_filter_options,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
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
  warning_types: ProofreadingFilterChoice<string>;
  statuses: ProofreadingFilterChoice<string>;
  file_paths: ProofreadingFilterChoice<string>;
  glossary_terms: ProofreadingFilterChoice<ProofreadingGlossaryTerm>;
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

function clone_glossary_term(term: ProofreadingGlossaryTerm): ProofreadingGlossaryTerm {
  return [term[0], term[1]] as const;
}

/**
 * 术语二元组比较使用源文和译文共同组成稳定 key，避免数组引用影响意图判断。
 */
function build_glossary_term_key(term: ProofreadingGlossaryTerm): string {
  return `${term[0]}→${term[1]}`;
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
 * 术语筛选按术语内容比较，保证同一术语 tuple 被克隆后仍能识别默认意图。
 */
function are_glossary_terms_equal(
  left_terms: ProofreadingGlossaryTerm[],
  right_terms: ProofreadingGlossaryTerm[],
): boolean {
  if (left_terms.length !== right_terms.length) {
    return false;
  }

  const left_signature = left_terms.map(build_glossary_term_key).sort().join("\n");
  const right_signature = right_terms.map(build_glossary_term_key).sort().join("\n");
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

/**
 * 将已物化的术语筛选值恢复成筛选意图，用户改动过的术语列表才固化为显式选择。
 */
function resolve_glossary_term_filter_choice(args: {
  values: ProofreadingGlossaryTerm[];
  default_values: ProofreadingGlossaryTerm[];
}): ProofreadingFilterChoice<ProofreadingGlossaryTerm> {
  return are_glossary_terms_equal(args.values, args.default_values)
    ? create_default_filter_choice()
    : create_selected_filter_choice(args.values, clone_glossary_term);
}

export function create_empty_filter_options(): ProofreadingFilterOptions {
  return {
    warning_types: [],
    statuses: [],
    file_paths: [],
    glossary_terms: [],
    include_without_glossary_miss: true,
  };
}

export function create_default_proofreading_filter_selection(
  default_filters: ProofreadingFilterOptions = create_empty_filter_options(),
): ProofreadingFilterSelection {
  return {
    warning_types: create_default_filter_choice(),
    statuses: create_default_filter_choice(),
    file_paths: create_default_filter_choice(),
    glossary_terms: create_default_filter_choice(),
    include_without_glossary_miss: default_filters.include_without_glossary_miss,
  };
}

export function create_selected_proofreading_filter_selection(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterSelection {
  return {
    warning_types: create_selected_filter_choice(filters.warning_types, (value) => value),
    statuses: create_selected_filter_choice(filters.statuses, (value) => value),
    file_paths: create_selected_filter_choice(filters.file_paths, (value) => value),
    glossary_terms: create_selected_filter_choice(filters.glossary_terms, clone_glossary_term),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  };
}

export function clone_proofreading_filter_selection(
  selection: ProofreadingFilterSelection,
): ProofreadingFilterSelection {
  return {
    warning_types: clone_filter_choice(selection.warning_types, (value) => value),
    statuses: clone_filter_choice(selection.statuses, (value) => value),
    file_paths: clone_filter_choice(selection.file_paths, (value) => value),
    glossary_terms: clone_filter_choice(selection.glossary_terms, clone_glossary_term),
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
    warning_types: resolve_string_filter_choice({
      values: args.filters.warning_types,
      default_values: args.default_filters.warning_types,
    }),
    statuses: resolve_string_filter_choice({
      values: args.filters.statuses,
      default_values: args.default_filters.statuses,
    }),
    file_paths: resolve_string_filter_choice({
      values: args.filters.file_paths,
      default_values: args.default_filters.file_paths,
    }),
    glossary_terms: resolve_glossary_term_filter_choice({
      values: args.filters.glossary_terms,
      default_values: args.default_filters.glossary_terms,
    }),
    include_without_glossary_miss: args.filters.include_without_glossary_miss,
  };
}

export function materialize_proofreading_filters(
  selection: ProofreadingFilterSelection,
  default_filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return {
    warning_types: materialize_filter_choice(
      selection.warning_types,
      default_filters.warning_types,
      (value) => value,
    ),
    statuses: materialize_filter_choice(selection.statuses, default_filters.statuses, (value) => {
      return value;
    }),
    file_paths: materialize_filter_choice(
      selection.file_paths,
      default_filters.file_paths,
      (value) => value,
    ),
    glossary_terms: materialize_filter_choice(
      selection.glossary_terms,
      default_filters.glossary_terms,
      clone_glossary_term,
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

function serialize_glossary_terms(glossary_terms: ProofreadingGlossaryTerm[]): string[][] {
  return glossary_terms.map((term) => [term[0], term[1]]);
}

export function build_filter_signature(filters: ProofreadingFilterOptions): string {
  return JsonTool.stringifyStrict({
    warning_types: [...filters.warning_types].sort(),
    statuses: [...filters.statuses].sort(),
    file_paths: [...filters.file_paths].sort(),
    glossary_terms: serialize_glossary_terms(filters.glossary_terms).sort(
      (left_term, right_term) => {
        return left_term.join("→").localeCompare(right_term.join("→"), "zh-Hans-CN");
      },
    ),
    include_without_glossary_miss: filters.include_without_glossary_miss,
  });
}

export function clone_proofreading_filters(
  filters: ProofreadingFilterOptions,
): ProofreadingFilterOptions {
  return clone_proofreading_filter_options(filters);
}
