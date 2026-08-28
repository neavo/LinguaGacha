import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Minus } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  PROOFREADING_OUTCOME_GROUP_LABEL_KEY_BY_CODE,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
} from "@frontend/pages/proofreading-page/proofreading-label-keys";
import {
  clone_proofreading_filter_options,
  format_proofreading_glossary_term,
  PROOFREADING_OUTCOME_GROUPS,
  type ProofreadingFilterOptions,
  type ProofreadingFilterPanelState,
} from "@shared/proofreading/proofreading-types";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import { Input } from "@frontend/shadcn/input";
import { ScrollArea } from "@frontend/shadcn/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";

type ProofreadingFilterDialogProps = {
  open: boolean;
  filters: ProofreadingFilterOptions;
  panel: ProofreadingFilterPanelState;
  loading: boolean;
  on_change: (next_filters: ProofreadingFilterOptions) => void;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

// 内置结果用于识别运行时新增的检查类型；扩展类型沿用“翻译成功”分组。
const KNOWN_PROOFREADING_OUTCOMES = new Set<string>(
  PROOFREADING_OUTCOME_GROUPS.flatMap((group) => [...group.outcome_codes]),
);

function toggle_string(values: string[], target_value: string): string[] {
  return values.includes(target_value)
    ? values.filter((value) => value !== target_value)
    : [...values, target_value];
}

/** 把 shared 结果码映射为 renderer 可见标签，未知检查类型回退到原始值。 */
function outcome_label(outcome: string, t: ReturnType<typeof useI18n>["t"]): string {
  const warning_key =
    PROOFREADING_WARNING_LABEL_KEY_BY_CODE[
      outcome as keyof typeof PROOFREADING_WARNING_LABEL_KEY_BY_CODE
    ];
  if (warning_key !== undefined) {
    return t(warning_key);
  }
  const status_key =
    PROOFREADING_STATUS_LABEL_KEY_BY_CODE[
      outcome as keyof typeof PROOFREADING_STATUS_LABEL_KEY_BY_CODE
    ];
  return status_key === undefined ? outcome : t(status_key);
}

/** 结果项同时呈现选择状态与当前筛选上下文中的命中数。 */
function FilterToggleButton(props: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <AppButton
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
    </AppButton>
  );
}

/** 分组标题把全选、部分选择和清空状态收口到单一可访问控件。 */
function FilterGroupHeader(props: {
  label_id: string;
  label: string;
  action_label: string;
  selected: boolean;
  partial: boolean;
  loading?: boolean;
  onClick: () => void;
}): JSX.Element {
  const checked_state = props.partial ? "mixed" : props.selected;

  return (
    <div className="proofreading-page__filter-group-header">
      <h3 id={props.label_id} className="proofreading-page__filter-group-label">
        {props.label}
      </h3>
      <div className="proofreading-page__filter-group-actions">
        {props.loading === undefined ? null : (
          <span
            className="proofreading-page__filter-loading-slot"
            data-loading={props.loading ? "true" : undefined}
            aria-hidden="true"
          >
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="checkbox"
                aria-checked={checked_state}
                aria-label={`${props.label}: ${props.action_label}`}
                className="proofreading-page__filter-group-control"
                onClick={props.onClick}
              >
                <span
                  className="proofreading-page__filter-group-indicator"
                  data-state={checked_state}
                >
                  {props.partial ? (
                    <Minus className="size-3" aria-hidden="true" />
                  ) : props.selected ? (
                    <Check className="size-3" aria-hidden="true" />
                  ) : null}
                </span>
              </button>
            }
          />
          <TooltipContent side="top" sideOffset={8}>
            {props.action_label}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function FilterListRow(props: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
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
        }
      />
      <TooltipContent side="top" sideOffset={8}>
        <p className="proofreading-page__filter-list-row-tooltip">{props.label}</p>
      </TooltipContent>
    </Tooltip>
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
      return format_proofreading_glossary_term(entry)
        .toLocaleLowerCase()
        .includes(normalized_keyword);
    });
  }, [props.panel.glossary_term_entries, term_keyword]);
  const extra_outcomes = props.panel.available_outcomes.filter(
    (outcome) => !KNOWN_PROOFREADING_OUTCOMES.has(outcome),
  );

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
          <AppButton
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={props.on_close}
          >
            {t("app.action.cancel")}
          </AppButton>
          <AppButton
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => {
              void handle_confirm();
            }}
          >
            {t("app.action.confirm")}
          </AppButton>
        </>
      }
    >
      <div className="proofreading-page__filter-dialog-scroll">
        <div className="proofreading-page__filter-layout">
          <div className="proofreading-page__filter-left-column">
            <section
              className="proofreading-page__filter-section proofreading-page__filter-section--compact-toggles"
              aria-busy={props.loading}
            >
              {PROOFREADING_OUTCOME_GROUPS.map((group) => {
                const dynamic_outcomes = group.code === "translated" ? extra_outcomes : [];
                const outcomes = [...group.outcome_codes, ...dynamic_outcomes].filter((outcome) =>
                  props.panel.available_outcomes.includes(outcome),
                );
                const selected_count = outcomes.filter((outcome) =>
                  props.filters.outcomes.includes(outcome),
                ).length;
                const all_selected = outcomes.length > 0 && selected_count === outcomes.length;
                return (
                  <div key={group.code} className="proofreading-page__filter-outcome-group">
                    <FilterGroupHeader
                      label_id={`proofreading-filter-group-${group.code}`}
                      label={t(PROOFREADING_OUTCOME_GROUP_LABEL_KEY_BY_CODE[group.code])}
                      action_label={t(
                        all_selected
                          ? "proofreading_page.filter.deselect_group"
                          : "proofreading_page.filter.select_group",
                      )}
                      selected={all_selected}
                      partial={selected_count > 0 && !all_selected}
                      loading={group.code === "translated" ? props.loading : undefined}
                      onClick={() => {
                        const next_outcomes = all_selected
                          ? props.filters.outcomes.filter((outcome) => !outcomes.includes(outcome))
                          : [...new Set([...props.filters.outcomes, ...outcomes])];
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          outcomes: next_outcomes,
                        });
                      }}
                    />
                    <div className="proofreading-page__filter-toggle-grid">
                      {outcomes.map((outcome) => (
                        <FilterToggleButton
                          key={outcome}
                          label={outcome_label(outcome, t)}
                          count={props.panel.outcome_count_by_code[outcome] ?? 0}
                          selected={props.filters.outcomes.includes(outcome)}
                          onClick={() => {
                            props.on_change({
                              ...clone_proofreading_filter_options(props.filters),
                              outcomes: toggle_string(props.filters.outcomes, outcome),
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="proofreading-page__filter-section proofreading-page__filter-section--stretch">
              <div className="proofreading-page__filter-section-head">
                <h3 className="proofreading-page__filter-section-title">
                  {t("proofreading_page.filter.file_scope")}
                </h3>
                <div className="proofreading-page__filter-section-actions">
                  <AppButton
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
                  </AppButton>
                  <AppButton
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
                  </AppButton>
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
                <AppButton
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    props.on_change({
                      ...clone_proofreading_filter_options(props.filters),
                      glossary_entry_ids: props.panel.glossary_term_entries.map(
                        (entry) => entry.entry_id,
                      ),
                      include_without_glossary_miss: true,
                    });
                  }}
                >
                  {t("proofreading_page.filter.select_all")}
                </AppButton>
                <AppButton
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    props.on_change({
                      ...clone_proofreading_filter_options(props.filters),
                      glossary_entry_ids: [],
                      include_without_glossary_miss: false,
                    });
                  }}
                >
                  {t("proofreading_page.filter.clear")}
                </AppButton>
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
                {visible_term_entries.length > 0 ? (
                  <>
                    <FilterListRow
                      key="without_glossary_miss"
                      label={t("proofreading_page.filter.without_glossary_miss")}
                      count={props.panel.without_glossary_miss_count}
                      selected={props.filters.include_without_glossary_miss}
                      onClick={() => {
                        props.on_change({
                          ...clone_proofreading_filter_options(props.filters),
                          include_without_glossary_miss:
                            !props.filters.include_without_glossary_miss,
                        });
                      }}
                    />
                    {visible_term_entries.map((entry) => (
                      <FilterListRow
                        key={entry.entry_id}
                        label={format_proofreading_glossary_term(entry)}
                        count={entry.count}
                        selected={props.filters.glossary_entry_ids.includes(entry.entry_id)}
                        onClick={() => {
                          props.on_change({
                            ...clone_proofreading_filter_options(props.filters),
                            glossary_entry_ids: toggle_string(
                              props.filters.glossary_entry_ids,
                              entry.entry_id,
                            ),
                          });
                        }}
                      />
                    ))}
                  </>
                ) : (
                  <div
                    className="proofreading-page__filter-empty proofreading-page__filter-empty--compact"
                    role="status"
                  >
                    {t("proofreading_page.filter.no_glossary_error")}
                  </div>
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </div>
    </AppPageDialog>
  );
}
