import { CaseSensitive, Regex } from "lucide-react";
import { useMemo } from "react";

import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { TextReplacementContextMenuContent } from "@frontend/pages/text-replacement-page/components/text-replacement-context-menu";
import type {
  TextReplacementEntryId,
  TextReplacementHitBadgeState,
  TextReplacementVisibleEntry,
} from "@frontend/pages/text-replacement-page/types";
import { Card, CardContent, CardHeader, CardTitle } from "@frontend/shadcn/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { QualityRuleHitBadge } from "@frontend/features/quality-rule-editor/quality-rule-hit-badge";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import { AppTableDragIndicator } from "@frontend/widgets/app-table/app-table-drag-indicator";

type TextReplacementTableProps = {
  title_key: LocaleKey;
  entries: TextReplacementVisibleEntry[];
  sort_state: AppTableSortState | null;
  drag_disabled: boolean;
  hit_running: boolean;
  hit_ready: boolean;
  readonly: boolean;
  selected_entry_ids: TextReplacementEntryId[];
  active_entry_id: TextReplacementEntryId | null;
  anchor_entry_id: TextReplacementEntryId | null;
  restore_scroll_entry_id: TextReplacementEntryId | null;
  hit_badge_by_entry_id: Record<TextReplacementEntryId, TextReplacementHitBadgeState>;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (entry_id: TextReplacementEntryId) => void;
  on_toggle_regex: (next_value: boolean) => Promise<void>;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
  on_reorder: (
    active_entry_id: TextReplacementEntryId,
    over_entry_id: TextReplacementEntryId,
  ) => Promise<void>;
  on_query_entry_source: (entry_id: TextReplacementEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: TextReplacementEntryId) => void;
};

type TextReplacementRuleMenuState = "enabled" | "disabled" | "mixed";

/**
 * 右键已选行时作用于整组选择；右键未选行时只作用于该行。
 */
function resolve_text_replacement_context_target_entry_ids(
  row_id: TextReplacementEntryId,
  selected_entry_ids: TextReplacementEntryId[],
): TextReplacementEntryId[] {
  if (selected_entry_ids.includes(row_id)) {
    return selected_entry_ids;
  }

  return [row_id];
}

/**
 * 汇总批量目标的布尔规则状态，供菜单呈现选中、未选中或混合态。
 */
function resolve_text_replacement_rule_menu_state(args: {
  entry_by_id: Map<TextReplacementEntryId, TextReplacementVisibleEntry>;
  target_entry_ids: TextReplacementEntryId[];
  pick_value: (entry: TextReplacementVisibleEntry) => boolean;
}): TextReplacementRuleMenuState {
  let has_enabled = false;
  let has_disabled = false;

  for (const entry_id of args.target_entry_ids) {
    const target_entry = args.entry_by_id.get(entry_id);
    if (target_entry === undefined) {
      continue;
    }

    if (args.pick_value(target_entry)) {
      has_enabled = true;
    } else {
      has_disabled = true;
    }

    if (has_enabled && has_disabled) {
      return "mixed";
    }
  }

  if (has_enabled) {
    return "enabled";
  }

  if (has_disabled) {
    return "disabled";
  }

  return "mixed";
}

/** 交互控件和滚动条不应成为框选手势的起点。 */
function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-text-replacement-ignore-box-select="true"]',
        '[data-app-table-ignore-box-select="true"]',
        '[data-slot="scroll-area-scrollbar"]',
        '[data-slot="scroll-area-thumb"]',
        '[data-slot="scroll-area-corner"]',
      ].join(", "),
    ) !== null
  );
}

/** 行内交互控件自行处理点击，不应同时改变行选择。 */
function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-text-replacement-ignore-row-click="true"]',
        '[data-app-table-ignore-row-click="true"]',
      ].join(", "),
    ) !== null
  );
}

type TextReplacementRuleBadgeProps = {
  icon: "regex" | "case-sensitive";
  enabled: boolean;
  tooltip: string;
};
function TextReplacementRuleBadge(props: TextReplacementRuleBadgeProps): JSX.Element {
  const Icon = props.icon === "regex" ? Regex : CaseSensitive;
  const badge = (
    <span className="text-replacement-page__rule-badge-wrap">
      <span
        data-state={props.enabled ? "active" : "inactive"}
        data-text-replacement-ignore-box-select="true"
        className="text-replacement-page__rule-badge"
      >
        <Icon aria-hidden="true" />
      </span>
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p className="whitespace-pre-line">{props.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function TextReplacementTable(props: TextReplacementTableProps): JSX.Element {
  const { t } = useI18n();
  const visible_entry_by_id = useMemo(() => {
    return new Map(
      props.entries.map((entry) => {
        return [entry.entry_id, entry] as const;
      }),
    );
  }, [props.entries]);

  const columns = useMemo<AppTableColumn<TextReplacementVisibleEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("quality_editor.fields.drag"),
        head_class_name: "text-replacement-page__table-drag-head",
        cell_class_name: "text-replacement-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={String(payload.row_index + 1)}
              can_drag={payload.can_drag}
              dragging={payload.dragging}
              drag_handle={payload.drag_handle}
              show_tooltip={payload.presentation !== "overlay"}
            />
          );
        },
      },
      {
        kind: "data",
        id: "src",
        title: t("quality_editor.fields.source"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("quality_editor.sort.ascending"),
            descending: t("quality_editor.sort.descending"),
            clear: t("quality_editor.sort.clear"),
          },
        },
        head_class_name: "text-replacement-page__table-source-head",
        cell_class_name: "text-replacement-page__table-source-cell",
        render_cell: (payload) => (
          <span className="text-replacement-page__table-text">{payload.row.entry.src}</span>
        ),
      },
      {
        kind: "data",
        id: "dst",
        title: t("text_replacement_page.fields.replacement"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("quality_editor.sort.ascending"),
            descending: t("quality_editor.sort.descending"),
            clear: t("quality_editor.sort.clear"),
          },
        },
        head_class_name: "text-replacement-page__table-replacement-head",
        cell_class_name: "text-replacement-page__table-replacement-cell",
        render_cell: (payload) => (
          <span className="text-replacement-page__table-text">{payload.row.entry.dst}</span>
        ),
      },
      {
        kind: "data",
        id: "rule",
        title: t("quality_editor.fields.rule"),
        width: 120,
        align: "center",
        sortable: {
          action_labels: {
            ascending: t("quality_editor.sort.ascending"),
            descending: t("quality_editor.sort.descending"),
            clear: t("quality_editor.sort.clear"),
          },
        },
        head_class_name: "text-replacement-page__table-rule-head",
        cell_class_name: "text-replacement-page__table-rule-cell",
        render_cell: (payload) => {
          const regex_tooltip = t("quality_editor.toggle.status")
            .replace("{TITLE}", t("text_replacement_page.rule.regex"))
            .replace(
              "{STATE}",
              t(payload.row.entry.regex ? "app.toggle.enabled" : "app.toggle.disabled"),
            );
          const case_tooltip = t("quality_editor.toggle.status")
            .replace("{TITLE}", t("text_replacement_page.rule.case_sensitive"))
            .replace(
              "{STATE}",
              t(payload.row.entry.case_sensitive ? "app.toggle.enabled" : "app.toggle.disabled"),
            );

          return (
            <div className="text-replacement-page__rule-badge-group">
              <TextReplacementRuleBadge
                icon="regex"
                enabled={payload.row.entry.regex}
                tooltip={regex_tooltip}
              />
              <TextReplacementRuleBadge
                icon="case-sensitive"
                enabled={payload.row.entry.case_sensitive}
                tooltip={case_tooltip}
              />
            </div>
          );
        },
      },
      {
        kind: "data",
        id: "hit",
        title: t("text_replacement_page.fields.hit"),
        width: 92,
        align: "center",
        sortable: {
          disabled: !props.hit_ready,
          action_labels: {
            ascending: t("quality_editor.sort.ascending"),
            descending: t("quality_editor.sort.descending"),
            clear: t("quality_editor.sort.clear"),
          },
        },
        head_class_name: "text-replacement-page__table-hit-head",
        cell_class_name: "text-replacement-page__table-hit-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <QualityRuleHitBadge
              entry_id={payload.row_id}
              running={props.hit_running}
              badge_state={props.hit_badge_by_entry_id[payload.row_id] ?? null}
              badge_class_name="replacement-page__hit-badge"
              running_class_name="replacement-page__hit-badge--running"
              wrap_class_name="text-replacement-page__hit-badge-wrap"
              button_class_name="replacement-page__hit-badge-button"
              query_label={t("quality_editor.action.query")}
              relation_label={t("text_replacement_page.hit.action.search_relation")}
              on_query_entry_source={props.on_query_entry_source}
              on_search_entry_relations={props.on_search_entry_relations}
            />
          );
        },
      },
    ];
  }, [
    props.on_query_entry_source,
    props.on_search_entry_relations,
    props.hit_badge_by_entry_id,
    props.hit_ready,
    props.hit_running,
    t,
  ]);

  return (
    <Card variant="table" className="text-replacement-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t(props.title_key)}</CardTitle>
      </CardHeader>
      <CardContent className="text-replacement-page__table-card-content">
        <AppTable
          rows={props.entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={props.sort_state}
          drag_enabled={!props.drag_disabled}
          get_row_id={(entry) => entry.entry_id}
          restore_scroll_row_id={props.restore_scroll_entry_id}
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={(payload) => {
            void props.on_reorder(payload.active_row_id, payload.over_row_id);
          }}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            const target_entry_ids = resolve_text_replacement_context_target_entry_ids(
              payload.row_id,
              props.selected_entry_ids,
            );
            const regex_state = resolve_text_replacement_rule_menu_state({
              entry_by_id: visible_entry_by_id,
              target_entry_ids,
              pick_value: (entry) => entry.entry.regex,
            });
            const case_sensitive_state = resolve_text_replacement_rule_menu_state({
              entry_by_id: visible_entry_by_id,
              target_entry_ids,
              pick_value: (entry) => entry.entry.case_sensitive,
            });

            return (
              <TextReplacementContextMenuContent
                regex_state={regex_state}
                case_sensitive_state={case_sensitive_state}
                readonly={props.readonly}
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
                on_toggle_regex={props.on_toggle_regex}
                on_toggle_case_sensitive={props.on_toggle_case_sensitive}
              />
            );
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="text-replacement-page__table"
          row_class_name={() => "text-replacement-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
