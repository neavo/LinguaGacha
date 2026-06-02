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
