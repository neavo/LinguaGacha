import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
  clone_proofreading_filter_options,
  format_proofreading_glossary_term,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
  type ProofreadingGlossaryTerm,
} from "@/pages/proofreading-page/types";
import { Badge } from "@/shadcn/badge";
import { Button } from "@/shadcn/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shadcn/empty";
import { Input } from "@/shadcn/input";
import { ScrollArea } from "@/shadcn/scroll-area";
import { AppPageDialog } from "@/widgets/app-page-dialog/app-page-dialog";

type ProofreadingFilterDialogProps = {
  open: boolean;
  filters: ProofreadingFilterOptions;
  panel: ProofreadingFilterPanelState;
  loading: boolean;
  on_change: (next_filters: ProofreadingFilterOptions) => void;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

function build_term_key(term: ProofreadingGlossaryTerm): string {
  return format_proofreading_glossary_term(term);
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
      <span className="proofreading-page__filter-toggle-label">{props.label}</span>
      <Badge
        variant="secondary"
        className="proofreading-page__filter-count-badge proofreading-page__filter-count-badge--toggle justify-center tabular-nums"
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
      <span className="proofreading-page__filter-list-row-copy">{props.label}</span>
      <Badge
        variant="secondary"
        className="proofreading-page__filter-count-badge min-w-5 justify-center tabular-nums"
      >
        {props.count.toString()}
      </Badge>
    </button>
  );
}

export function ProofreadingFilterDialog(props: ProofreadingFilterDialogProps): JSX.Element {
  const { t } = useI18n();
  const [file_keyword, set_file_keyword] = useState("");
  const [term_keyword, set_term_keyword] = useState("");
  const [submitting, set_submitting] = useState(false);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    set_file_keyword("");
    set_term_keyword("");
    set_submitting(false);
  }, [props.open]);

  const visible_file_paths = useMemo(() => {
    const normalized_keyword = file_keyword.trim().toLocaleLowerCase();
    if (normalized_keyword === "") {
      return props.panel.available_file_paths;
    }

    return props.panel.available_file_paths.filter((file_path) => {
      return file_path.toLocaleLowerCase().includes(normalized_keyword);
    });
  }, [file_keyword, props.panel.available_file_paths]);

  const visible_term_entries = useMemo(() => {
    const normalized_keyword = term_keyword.trim().toLocaleLowerCase();
    if (normalized_keyword === "") {
      return props.panel.glossary_term_entries;
    }

    return props.panel.glossary_term_entries.filter((entry) => {
      return build_term_key(entry.term).toLocaleLowerCase().includes(normalized_keyword);
    });
  }, [props.panel.glossary_term_entries, term_keyword]);

  async function handle_confirm(): Promise<void> {
    set_submitting(true);
    try {
      await props.on_confirm();
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
                {props.loading ? (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              <div className="proofreading-page__filter-toggle-grid">
                {props.panel.available_statuses.map((status) => {
                  const label_key =
                    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
                      status as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
                    ];
                  return (
                    <FilterToggleButton
                      key={status}
                      label={label_key === undefined ? status : t(label_key)}
                      count={props.panel.status_count_by_code[status] ?? 0}
                      selected={props.filters.statuses.includes(status)}
                      onClick={() => {
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          statuses: toggle_string(props.filters.statuses, status),
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
                {props.panel.available_warning_types.map((warning) => {
                  const label_key =
                    PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
                      warning as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
                    ];
                  return (
                    <FilterToggleButton
                      key={warning}
                      label={label_key === undefined ? warning : t(label_key)}
                      count={props.panel.warning_count_by_code[warning] ?? 0}
                      selected={props.filters.warning_types.includes(warning)}
                      onClick={() => {
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          warning_types: toggle_string(props.filters.warning_types, warning),
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
                      props.on_change({
                        ...clone_proofreading_filter_options(props.filters),
                        file_paths: [...props.panel.all_file_paths],
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
                      props.on_change({
                        ...clone_proofreading_filter_options(props.filters),
                        file_paths: [],
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
                      count={props.panel.file_count_by_path[file_path] ?? 0}
                      selected={props.filters.file_paths.includes(file_path)}
                      onClick={() => {
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          file_paths: toggle_string(props.filters.file_paths, file_path),
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
                    props.on_change({
                      ...clone_proofreading_filter_options(props.filters),
                      glossary_terms: props.panel.glossary_term_entries.map((entry) => entry.term),
                      include_without_glossary_miss: true,
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
                    props.on_change({
                      ...clone_proofreading_filter_options(props.filters),
                      glossary_terms: [],
                      include_without_glossary_miss: false,
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
                  count={props.panel.without_glossary_miss_count}
                  selected={props.filters.include_without_glossary_miss}
                  onClick={() => {
                    props.on_change({
                      ...clone_proofreading_filter_options(props.filters),
                      include_without_glossary_miss: !props.filters.include_without_glossary_miss,
                    });
                  }}
                />
                {visible_term_entries.length > 0 ? (
                  visible_term_entries.map((entry) => (
                    <FilterListRow
                      key={build_term_key(entry.term)}
                      label={build_term_key(entry.term)}
                      count={entry.count}
                      selected={props.filters.glossary_terms.some((term) => {
                        return build_term_key(term) === build_term_key(entry.term);
                      })}
                      onClick={() => {
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          glossary_terms: toggle_term(props.filters.glossary_terms, entry.term),
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
                      <EmptyTitle>{t("proofreading_page.filter.no_glossary_error")}</EmptyTitle>
                      <EmptyDescription>
                        {t("proofreading_page.filter.no_glossary_error_description")}
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
