import {
  count_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
  get_name_field_filter_error,
  type NameFieldFilterState,
  type NameFieldRow,
  type NameFieldSortState,
} from "../../../shared/name-field-extraction/name-field-extraction";

export type NameFieldExtractionWorkerTaskInput = {
  items: Array<Record<string, unknown>>;
  glossary_entries: Array<Record<string, unknown>>;
  filter: NameFieldFilterState;
  sort: NameFieldSortState;
};

export type NameFieldExtractionWorkerTaskResult = {
  rows: NameFieldRow[];
  counts: {
    total: number;
    translated: number;
    untranslated: number;
    error: number;
  };
  invalid_regex_message: string | null;
};

export function run_name_field_extraction_worker_task(
  input: NameFieldExtractionWorkerTaskInput,
): NameFieldExtractionWorkerTaskResult {
  const rows = extract_name_field_rows({
    items: input.items,
    glossary_entries: input.glossary_entries,
  });
  const filtered_rows = filter_name_field_rows({
    rows,
    filter_state: input.filter,
    sort_state: input.sort,
  });
  return {
    rows: filtered_rows,
    counts: count_name_field_rows(rows),
    invalid_regex_message: get_name_field_filter_error(input.filter),
  };
}
