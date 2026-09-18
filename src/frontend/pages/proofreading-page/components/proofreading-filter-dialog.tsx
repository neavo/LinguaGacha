import {
  clone_content_filters,
  type ProofreadingContentFilters,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Minus } from "lucide-react";

import { useI18n } from "@frontend/app/locale/locale-context";
import {
  PROOFREADING_OUTCOME_GROUP_LABEL_KEY_BY_CODE,
  PROOFREADING_STATUS_LABEL_KEY_BY_CODE,
  PROOFREADING_WARNING_LABEL_KEY_BY_CODE,
} from "@frontend/features/proofreading/proofreading-label-keys";
import {
  format_proofreading_glossary_term,
  PROOFREADING_OUTCOME_GROUPS,
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
  filters: ProofreadingContentFilters;
  panel: ProofreadingFilterPanelState;
  loading: boolean;
  on_change: (next_filters: ProofreadingContentFilters) => void;
  on_confirm: () => Promise<void>;
  on_close: () => void;
};

// 内置结果用于识别运行时新增的检查类型；扩展类型沿用“翻译成功”分组。
const KNOWN_PROOFREADING_OUTCOMES = new Set<string>(
  PROOFREADING_OUTCOME_GROUPS.flatMap((group) => [...group.outcome_codes]),
);

/** 切换一项筛选并返回新数组，供页面更新受控筛选状态。 */
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
      <Badge className="proofreading-page__filter-count-badge">{props.count.toString()}</Badge>
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
          <TooltipContent>{props.action_label}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/** 术语选项保留被截断的完整标签。 */
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
            <Badge className="proofreading-page__filter-count-badge">
              {props.count.toString()}
            </Badge>
          </button>
        }
      />
      <TooltipContent>
        <p className="proofreading-page__filter-list-row-tooltip">{props.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
/** 弹窗持有局部搜索词，筛选结果与提交动作交由页面管理。 */
export function ProofreadingFilterDialog(props: ProofreadingFilterDialogProps): JSX.Element {
  const { t } = useI18n();
  const [term_keyword, set_term_keyword] = useState("");
  const [submitting, set_submitting] = useState(false);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    set_term_keyword("");
    set_submitting(false);
  }, [props.open]);

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

  // 搜索只收窄候选显示，组选择同时覆盖全部候选术语和「无术语缺失」。
  const selected_terms = new Set(props.filters.glossary_entry_ids);
  const selected_term_count = props.panel.glossary_term_entries.filter((entry) =>
    selected_terms.has(entry.entry_id),
  ).length;
  const all_terms_selected =
    props.filters.include_without_glossary_miss &&
    selected_term_count === props.panel.glossary_term_entries.length;
  const some_terms_selected =
    props.filters.include_without_glossary_miss || selected_term_count > 0;

  /** 确认期间阻止关闭和重复提交，完成后恢复操作。 */
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
      size="lg"
      dismissBehavior={submitting ? "blocked" : "default"}
      onClose={props.on_close}
      contentClassName="h-[720px] max-h-[calc(100vh-32px)] sm:max-w-[960px]"
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
                        ...clone_content_filters(props.filters),
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
                            ...clone_content_filters(props.filters),
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

          <section
            className="proofreading-page__filter-section"
            aria-labelledby="proofreading-filter-group-glossary"
          >
            <FilterGroupHeader
              label_id="proofreading-filter-group-glossary"
              label={t("proofreading_page.filter.glossary_detail")}
              action_label={t(
                all_terms_selected
                  ? "proofreading_page.filter.deselect_group"
                  : "proofreading_page.filter.select_group",
              )}
              selected={all_terms_selected}
              partial={some_terms_selected && !all_terms_selected}
              onClick={() =>
                props.on_change({
                  ...clone_content_filters(props.filters),
                  glossary_entry_ids: all_terms_selected
                    ? []
                    : props.panel.glossary_term_entries.map((entry) => entry.entry_id),
                  include_without_glossary_miss: !all_terms_selected,
                })
              }
            />

            <Input
              className="h-[30px] px-2 text-xs leading-none md:text-xs placeholder:text-xs"
              value={term_keyword}
              placeholder={t("proofreading_page.filter.search_placeholder")}
              onChange={(event) => {
                set_term_keyword(event.target.value);
              }}
            />

            <ScrollArea className="proofreading-page__filter-list">
              <div className="proofreading-page__filter-list-body">
                {visible_term_entries.length > 0 ? (
                  <>
                    <FilterListRow
                      key="without_glossary_miss"
                      label={t("proofreading_page.filter.without_glossary_miss")}
                      count={props.panel.without_glossary_miss_count}
                      selected={props.filters.include_without_glossary_miss}
                      onClick={() => {
                        props.on_change({
                          ...clone_content_filters(props.filters),
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
                            ...clone_content_filters(props.filters),
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
                  <div className="proofreading-page__filter-empty" role="status">
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
