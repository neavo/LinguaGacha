import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import {
  PROOFREADING_NO_WARNING_CODE,
  PROOFREADING_STATUS_ORDER,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_CODES,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  clone_proofreading_filter_options,
  format_proofreading_glossary_term,
  normalize_proofreading_filter_options,
  resolve_proofreading_filter_source_items,
  resolve_proofreading_status_sort_rank,
  type ProofreadingFilterOptions,
  type ProofreadingGlossaryTerm,
  type ProofreadingItem,
  type ProofreadingSnapshot,
} from "@/pages/proofreading-page/types";
import { Badge } from "@/shadcn/badge";
import { Button } from "@/shadcn/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shadcn/empty";
import { Input } from "@/shadcn/input";
import { ScrollArea } from "@/shadcn/scroll-area";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";

type ProofreadingFilterDialogProps = {
  open: boolean;
  snapshot: ProofreadingSnapshot;
  current_filters: ProofreadingFilterOptions;
  on_confirm: (next_filters: ProofreadingFilterOptions) => Promise<void>;
  on_close: () => void;
};

type ProofreadingFilterDimension =
  | "warning_types"
  | "statuses"
  | "file_paths"
  | "glossary_terms";

type ProofreadingTermCountEntry = {
  term: ProofreadingGlossaryTerm;
  count: number;
};

function build_term_key(term: ProofreadingGlossaryTerm): string {
  return format_proofreading_glossary_term(term);
}

function item_has_glossary_miss(item: ProofreadingItem): boolean {
  return item.failed_glossary_terms.length > 0;
}

function item_matches_glossary_filter(
  item: ProofreadingItem,
  filters: ProofreadingFilterOptions,
): boolean {
  if (!item_has_glossary_miss(item)) {
    return filters.include_without_glossary_miss;
  }

  const selected_term_key_set = new Set(
    filters.glossary_terms.map((term) => build_term_key(term)),
  );
  if (selected_term_key_set.size === 0) {
    return false;
  }

  return item.failed_glossary_terms.some((term) => {
    return selected_term_key_set.has(build_term_key(term));
  });
}

function filter_items_by_context(args: {
  items: ProofreadingItem[];
  filters: ProofreadingFilterOptions;
  ignored_dimensions?: ProofreadingFilterDimension[];
}): ProofreadingItem[] {
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
      selected_warning_set !== null
      && !item_warning_codes.some((warning) => selected_warning_set.has(warning))
    ) {
      return false;
    }

    if (
      selected_status_set !== null
      && !selected_status_set.has(item.status)
    ) {
      return false;
    }

    if (
      selected_file_path_set !== null
      && !selected_file_path_set.has(item.file_path)
    ) {
      return false;
    }

    if (
      glossary_filter_enabled
      && !item_matches_glossary_filter(item, args.filters)
    ) {
      return false;
    }

    return true;
  });
}

function build_status_values(args: {
  items: ProofreadingItem[];
  filters: ProofreadingFilterOptions;
}): string[] {
  const known_statuses: string[] = [...PROOFREADING_STATUS_ORDER];
  const known_status_set = new Set(known_statuses);
  const extra_statuses = [...new Set([
    ...args.items.map((item) => item.status),
    ...args.filters.statuses,
  ])].filter((status) => !known_status_set.has(status));

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
  items: ProofreadingItem[];
  filters: ProofreadingFilterOptions;
}): string[] {
  const known_warnings: string[] = [...PROOFREADING_WARNING_CODES];
  const known_warning_set = new Set(known_warnings);
  const dynamic_warnings = args.items.flatMap((item) => {
    return item.warnings.length > 0 ? item.warnings : [PROOFREADING_NO_WARNING_CODE];
  });
  const extra_warnings = [...new Set([
    ...dynamic_warnings,
    ...args.filters.warning_types,
  ])].filter((warning) => !known_warning_set.has(warning));

  extra_warnings.sort((left_warning, right_warning) => {
    return left_warning.localeCompare(right_warning);
  });

  return [...known_warnings, ...extra_warnings];
}

function build_status_count_by_code(items: ProofreadingItem[]): Record<string, number> {
  const next_count_by_code: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_code[item.status] = (next_count_by_code[item.status] ?? 0) + 1;
  });
  return next_count_by_code;
}

function build_warning_count_by_code(items: ProofreadingItem[]): Record<string, number> {
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

function build_file_count_by_path(items: ProofreadingItem[]): Record<string, number> {
  const next_count_by_path: Record<string, number> = {};
  items.forEach((item) => {
    next_count_by_path[item.file_path] = (next_count_by_path[item.file_path] ?? 0) + 1;
  });
  return next_count_by_path;
}

function build_term_count_entries(args: {
  items: ProofreadingItem[];
}): ProofreadingTermCountEntry[] {
  const next_term_count_map = new Map<string, ProofreadingTermCountEntry>();

  args.items.forEach((item) => {
    if (!item.warnings.includes("GLOSSARY")) {
      return;
    }

    item.failed_glossary_terms.forEach((term) => {
      const term_key = build_term_key(term);
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

    return build_term_key(left_entry.term).localeCompare(
      build_term_key(right_entry.term),
    );
  });
}

function toggle_string(values: string[], target_value: string): string[] {
  return values.includes(target_value)
    ? values.filter((value) => value !== target_value)
    : [...values, target_value];
}

function toggle_term(
  glossary_terms: ProofreadingGlossaryTerm[],
  target_term: ProofreadingGlossaryTerm,
): ProofreadingGlossaryTerm[] {
  const target_key = build_term_key(target_term);
  if (glossary_terms.some((term) => build_term_key(term) === target_key)) {
    return glossary_terms.filter((term) => build_term_key(term) !== target_key);
  }

  return [...glossary_terms, target_term];
}

function FilterToggleButton(props: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="proofreading-page__filter-toggle font-normal"
      data-selected={props.selected ? "true" : undefined}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="proofreading-page__filter-toggle-label">
        {props.label}
      </span>
      <Badge
        variant="secondary"
        className="proofreading-page__filter-count-badge proofreading-page__filter-count-badge--toggle justify-center font-mono tabular-nums"
      >
        {props.count.toString()}
      </Badge>
    </Button>
  );
}

function FilterListRow(props: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="proofreading-page__filter-list-row"
      data-selected={props.selected ? "true" : undefined}
      onClick={props.onClick}
    >
      <span className="proofreading-page__filter-list-row-copy">
        {props.label}
      </span>
      <Badge
        variant="secondary"
        className="proofreading-page__filter-count-badge min-w-5 justify-center font-mono tabular-nums"
      >
        {props.count.toString()}
      </Badge>
    </button>
  );
}

export function ProofreadingFilterDialog(
  props: ProofreadingFilterDialogProps,
): JSX.Element {
  const { t } = useI18n();
  const [draft_filters, set_draft_filters] =
    useState<ProofreadingFilterOptions>(() => {
      return normalize_proofreading_filter_options(
        props.current_filters,
        resolve_proofreading_filter_source_items(props.snapshot.items),
      );
    });
  const [file_keyword, set_file_keyword] = useState("");
  const [term_keyword, set_term_keyword] = useState("");
  const [submitting, set_submitting] = useState(false);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const filter_source_items = resolve_proofreading_filter_source_items(
      props.snapshot.items,
    );
    set_draft_filters(
      normalize_proofreading_filter_options(
        props.current_filters,
        filter_source_items,
      ),
    );
    set_file_keyword("");
    set_term_keyword("");
    set_submitting(false);
  }, [props.current_filters, props.open, props.snapshot.items]);

  const filter_source_items = useMemo(() => {
    return resolve_proofreading_filter_source_items(props.snapshot.items);
  }, [props.snapshot.items]);

  const available_statuses = useMemo(() => {
    return build_status_values({
      items: filter_source_items,
      filters: draft_filters,
    });
  }, [draft_filters, filter_source_items]);

  const status_scope_items = useMemo(() => {
    return filter_items_by_context({
      items: filter_source_items,
      filters: draft_filters,
      ignored_dimensions: ["statuses"],
    });
  }, [draft_filters, filter_source_items]);

  const available_warning_types = useMemo(() => {
    return build_warning_values({
      items: filter_source_items,
      filters: draft_filters,
    });
  }, [draft_filters, filter_source_items]);

  const warning_scope_items = useMemo(() => {
    return filter_items_by_context({
      items: filter_source_items,
      filters: draft_filters,
      ignored_dimensions: ["warning_types", "glossary_terms"],
    });
  }, [draft_filters, filter_source_items]);

  const all_file_paths = useMemo(() => {
    return [...new Set(filter_source_items.map((item) => item.file_path))].sort(
      (left_path, right_path) => left_path.localeCompare(right_path),
    );
  }, [filter_source_items]);

  const status_count_by_code = useMemo(() => {
    return build_status_count_by_code(status_scope_items);
  }, [status_scope_items]);

  const warning_count_by_code = useMemo(() => {
    return build_warning_count_by_code(warning_scope_items);
  }, [warning_scope_items]);

  const file_scope_items = useMemo(() => {
    return filter_items_by_context({
      items: filter_source_items,
      filters: draft_filters,
      ignored_dimensions: ["file_paths"],
    });
  }, [draft_filters, filter_source_items]);

  const file_count_by_path = useMemo(() => {
    return build_file_count_by_path(file_scope_items);
  }, [file_scope_items]);

  const available_file_paths = useMemo(() => {
    return [...new Set([
      ...Object.keys(file_count_by_path),
      ...draft_filters.file_paths,
    ])].sort((left_path, right_path) => left_path.localeCompare(right_path));
  }, [draft_filters.file_paths, file_count_by_path]);

  const term_count_entries = useMemo(() => {
    const term_scope_items = filter_items_by_context({
      items: filter_source_items,
      filters: draft_filters,
      ignored_dimensions: ["glossary_terms"],
    });

    return build_term_count_entries({
      items: term_scope_items,
    });
  }, [draft_filters, filter_source_items]);

  const without_glossary_miss_count = useMemo(() => {
    const term_scope_items = filter_items_by_context({
      items: filter_source_items,
      filters: draft_filters,
      ignored_dimensions: ["glossary_terms"],
    });

    return term_scope_items.filter((item) => !item_has_glossary_miss(item)).length;
  }, [draft_filters, filter_source_items]);

  const visible_file_paths = useMemo(() => {
    const normalized_keyword = file_keyword.trim().toLocaleLowerCase();
    if (normalized_keyword === "") {
      return available_file_paths;
    }

    return available_file_paths.filter((file_path) => {
      return file_path.toLocaleLowerCase().includes(normalized_keyword);
    });
  }, [available_file_paths, file_keyword]);

  const visible_term_entries = useMemo(() => {
    const normalized_keyword = term_keyword.trim().toLocaleLowerCase();
    if (normalized_keyword === "") {
      return term_count_entries;
    }

    return term_count_entries.filter((entry) => {
      return build_term_key(entry.term)
        .toLocaleLowerCase()
        .includes(normalized_keyword);
    });
  }, [term_count_entries, term_keyword]);

  async function handle_confirm(): Promise<void> {
    set_submitting(true);
    try {
      await props.on_confirm(clone_proofreading_filter_options(draft_filters));
    } finally {
      set_submitting(false);
    }
  }

  return (
    <AppPageDialog
      open={props.open}
      title={t("proofreading_page.action.filter")}
      size="xl"
      dismissBehavior={submitting ? "blocked" : "default"}
      onClose={props.on_close}
      contentClassName="h-[720px] max-h-[calc(100vh-32px)] sm:max-w-[1180px]"
      bodyClassName="overflow-hidden p-0"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={props.on_close}
          >
            {t("proofreading_page.action.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => {
              void handle_confirm();
            }}
          >
            {t("proofreading_page.action.confirm")}
          </Button>
        </>
      }
    >
      <div className="proofreading-page__filter-dialog-scroll">
        <div className="proofreading-page__filter-layout">
          <div className="proofreading-page__filter-left-column">
            <section className="proofreading-page__filter-section proofreading-page__filter-section--compact-toggles">
              <div className="proofreading-page__filter-section-head">
                <h3 className="proofreading-page__filter-section-title">
                  {t("proofreading_page.filter.status_title")}
                </h3>
              </div>
              <div className="proofreading-page__filter-toggle-grid">
                {available_statuses.map((status) => {
                  const label_key =
                    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
                      status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
                    ];
                  return (
                    <FilterToggleButton
                      key={status}
                      label={label_key === undefined ? status : t(label_key)}
                      count={status_count_by_code[status] ?? 0}
                      selected={draft_filters.statuses.includes(status)}
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            statuses: toggle_string(
                              previous_filters.statuses,
                              status,
                            ),
                          };
                        });
                      }}
                    />
                  );
                })}
              </div>
            </section>

            <section className="proofreading-page__filter-section proofreading-page__filter-section--compact-toggles">
              <div className="proofreading-page__filter-section-head">
                <h3 className="proofreading-page__filter-section-title">
                  {t("proofreading_page.result_check_title")}
                </h3>
              </div>
              <div className="proofreading-page__filter-toggle-grid">
                {available_warning_types.map((warning) => {
                  const label_key =
                    PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                      warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                    ];
                  return (
                    <FilterToggleButton
                      key={warning}
                      label={label_key === undefined ? warning : t(label_key)}
                      count={warning_count_by_code[warning] ?? 0}
                      selected={draft_filters.warning_types.includes(warning)}
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            warning_types: toggle_string(
                              previous_filters.warning_types,
                              warning,
                            ),
                          };
                        });
                      }}
                    />
                  );
                })}
              </div>
            </section>

            <section className="proofreading-page__filter-section proofreading-page__filter-section--stretch">
              <div className="proofreading-page__filter-section-head">
                <h3 className="proofreading-page__filter-section-title">
                  {t("proofreading_page.filter.file_scope")}
                </h3>
                <div className="proofreading-page__filter-section-actions">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      set_draft_filters((previous_filters) => {
                        return {
                          ...previous_filters,
                          file_paths: [...all_file_paths],
                        };
                      });
                    }}
                  >
                    {t("proofreading_page.filter.select_all")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      set_draft_filters((previous_filters) => {
                        return {
                          ...previous_filters,
                          file_paths: [],
                        };
                      });
                    }}
                  >
                    {t("proofreading_page.filter.clear")}
                  </Button>
                </div>
              </div>

              <Input
                className="h-[30px] px-2 text-xs leading-none md:text-xs placeholder:text-xs"
                value={file_keyword}
                placeholder={t("proofreading_page.filter.search_placeholder")}
                onChange={(event) => {
                  set_file_keyword(event.target.value);
                }}
              />

              <ScrollArea className="proofreading-page__filter-list proofreading-page__filter-list--compact">
                <div className="proofreading-page__filter-list-body proofreading-page__filter-list-body--compact">
                  {visible_file_paths.map((file_path) => (
                    <FilterListRow
                      key={file_path}
                      label={file_path}
                      count={file_count_by_path[file_path] ?? 0}
                      selected={draft_filters.file_paths.includes(file_path)}
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            file_paths: toggle_string(
                              previous_filters.file_paths,
                              file_path,
                            ),
                          };
                        });
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            </section>
          </div>

          <section className="proofreading-page__filter-section proofreading-page__filter-section--stretch">
            <div className="proofreading-page__filter-section-head">
              <h3 className="proofreading-page__filter-section-title">
                {t("proofreading_page.filter.glossary_detail")}
              </h3>
              <div className="proofreading-page__filter-section-actions">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    set_draft_filters((previous_filters) => {
                      return {
                        ...previous_filters,
                        glossary_terms: term_count_entries.map(
                          (entry) => entry.term,
                        ),
                        include_without_glossary_miss: true,
                      };
                    });
                  }}
                >
                  {t("proofreading_page.filter.select_all")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    set_draft_filters((previous_filters) => {
                      return {
                        ...previous_filters,
                        glossary_terms: [],
                        include_without_glossary_miss: false,
                      };
                    });
                  }}
                >
                  {t("proofreading_page.filter.clear")}
                </Button>
              </div>
            </div>

            <Input
              className="h-[30px] px-2 text-xs leading-none md:text-xs placeholder:text-xs"
              value={term_keyword}
              placeholder={t("proofreading_page.filter.search_placeholder")}
              onChange={(event) => {
                set_term_keyword(event.target.value);
              }}
            />

            <ScrollArea className="proofreading-page__filter-list proofreading-page__filter-list--compact">
              <div className="proofreading-page__filter-list-body proofreading-page__filter-list-body--compact">
                <FilterListRow
                  key="without_glossary_miss"
                  label={t("proofreading_page.filter.without_glossary_miss")}
                  count={without_glossary_miss_count}
                  selected={draft_filters.include_without_glossary_miss}
                  onClick={() => {
                    set_draft_filters((previous_filters) => {
                      return {
                        ...previous_filters,
                        include_without_glossary_miss:
                          !previous_filters.include_without_glossary_miss,
                      };
                    });
                  }}
                />
                {visible_term_entries.length > 0 ? (
                  visible_term_entries.map((entry) => (
                    <FilterListRow
                      key={build_term_key(entry.term)}
                      label={build_term_key(entry.term)}
                      count={entry.count}
                      selected={draft_filters.glossary_terms.some((term) => {
                        return (
                          build_term_key(term) === build_term_key(entry.term)
                        );
                      })}
                      onClick={() => {
                        set_draft_filters((previous_filters) => {
                          return {
                            ...previous_filters,
                            glossary_terms: toggle_term(
                              previous_filters.glossary_terms,
                              entry.term,
                            ),
                          };
                        });
                      }}
                    />
                  ))
                ) : (
                  <Empty
                    variant="dashed"
                    className="proofreading-page__filter-empty proofreading-page__filter-empty--compact"
                  >
                    <EmptyHeader>
                      <EmptyTitle>
                        {t("proofreading_page.filter.no_glossary_error")}
                      </EmptyTitle>
                      <EmptyDescription>
                        {t(
                          "proofreading_page.filter.no_glossary_error_description",
                        )}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </div>
    </AppPageDialog>
  );
}
