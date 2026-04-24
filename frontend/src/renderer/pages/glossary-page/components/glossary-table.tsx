import { CaseSensitive } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { GlossaryContextMenuContent } from "@/pages/glossary-page/components/glossary-context-menu";
import type {
  GlossaryEntryId,
  GlossarySortState,
  GlossaryStatisticsBadgeState,
  GlossaryVisibleEntry,
} from "@/pages/glossary-page/types";
import { Badge } from "@/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shadcn/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { AppTable } from "@/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import { AppTableDragIndicator } from "@/widgets/app-table/app-table-drag-indicator";

type GlossaryTableProps = {
  entries: GlossaryVisibleEntry[];
  sort_state: GlossarySortState;
  drag_disabled: boolean;
  statistics_ready: boolean;
  selected_entry_ids: GlossaryEntryId[];
  active_entry_id: GlossaryEntryId | null;
  anchor_entry_id: GlossaryEntryId | null;
  statistics_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState>;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (entry_id: GlossaryEntryId) => void;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
  on_reorder: (active_entry_id: GlossaryEntryId, over_entry_id: GlossaryEntryId) => Promise<void>;
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void;
};

type GlossaryRuleMenuState = "enabled" | "disabled" | "mixed";

function build_glossary_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

function resolve_glossary_context_target_entry_ids(
  row_id: GlossaryEntryId,
  selected_entry_ids: GlossaryEntryId[],
): GlossaryEntryId[] {
  if (selected_entry_ids.includes(row_id)) {
    return selected_entry_ids;
  }

  return [row_id];
}

function resolve_glossary_rule_menu_state(args: {
  entry_by_id: Map<GlossaryEntryId, GlossaryVisibleEntry>;
  target_entry_ids: GlossaryEntryId[];
  pick_value: (entry: GlossaryVisibleEntry) => boolean;
}): GlossaryRuleMenuState {
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

function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-glossary-ignore-box-select="true"]',
        '[data-app-table-ignore-box-select="true"]',
        '[data-slot="scroll-area-scrollbar"]',
        '[data-slot="scroll-area-thumb"]',
        '[data-slot="scroll-area-corner"]',
      ].join(", "),
    ) !== null
  );
}

function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      ['[data-glossary-ignore-row-click="true"]', '[data-app-table-ignore-row-click="true"]'].join(
        ", ",
      ),
    ) !== null
  );
}

function map_glossary_sort_state(sort_state: GlossarySortState): AppTableSortState | null {
  if (sort_state.field === null || sort_state.direction === null) {
    return null;
  }

  return {
    column_id: sort_state.field,
    direction: sort_state.direction,
  };
}

type GlossaryRuleBadgeProps = {
  enabled: boolean;
  tooltip: string;
};

function GlossaryRuleBadge(props: GlossaryRuleBadgeProps): JSX.Element {
  const badge = (
    <span className="glossary-page__rule-badge-wrap">
      <span
        data-state={props.enabled ? "active" : "inactive"}
        data-glossary-ignore-box-select="true"
        className="glossary-page__rule-badge"
      >
        <CaseSensitive aria-hidden="true" />
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

type GlossaryStatisticsBadgeProps = {
  entry_id: GlossaryEntryId;
  badge_state: GlossaryStatisticsBadgeState | null;
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void;
};

function GlossaryStatisticsBadge(props: GlossaryStatisticsBadgeProps): JSX.Element | null {
  const { t } = useI18n();

  if (props.badge_state === null) {
    return null;
  }

  const badge_color_class_name =
    props.badge_state.kind === "matched"
      ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
      : props.badge_state.kind === "related"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
        : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400";

  const badge = (
    <Badge className={cn("glossary-page__statistics-badge", badge_color_class_name)}>
      {props.badge_state.matched_count.toString()}
    </Badge>
  );

  const tooltip_content = (
    <TooltipContent side="top" sideOffset={8}>
      <p className="whitespace-pre-line">{props.badge_state.tooltip}</p>
    </TooltipContent>
  );

  if (props.badge_state.kind === "unmatched") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-glossary-ignore-box-select="true"
            data-glossary-ignore-row-click="true"
            className="glossary-page__statistics-badge-wrap"
          >
            {badge}
          </span>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
    );
  }

  if (props.badge_state.kind === "matched") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-glossary-ignore-box-select="true"
            data-glossary-ignore-row-click="true"
            className="glossary-page__statistics-badge-button"
            onClick={(event) => {
              event.stopPropagation();
              void props.on_query_entry_source(props.entry_id);
            }}
          >
            {badge}
          </button>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-glossary-ignore-box-select="true"
              data-glossary-ignore-row-click="true"
              className="glossary-page__statistics-badge-button"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {badge}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
      <DropdownMenuContent align="center">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void props.on_query_entry_source(props.entry_id);
            }}
          >
            {t("glossary_page.statistics.action.query_source")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              props.on_search_entry_relations(props.entry_id);
            }}
          >
            {t("glossary_page.statistics.action.search_relation")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GlossaryTable(props: GlossaryTableProps): JSX.Element {
  const { t } = useI18n();
  const visible_entry_by_id = useMemo(() => {
    return new Map(
      props.entries.map((entry) => {
        return [entry.entry_id, entry] as const;
      }),
    );
  }, [props.entries]);

  const columns = useMemo<AppTableColumn<GlossaryVisibleEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("glossary_page.fields.drag"),
        head_class_name: "glossary-page__table-drag-head",
        cell_class_name: "glossary-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={build_glossary_row_number_label(payload.row_index)}
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
        title: t("glossary_page.fields.source"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("glossary_page.sort.ascending"),
            descending: t("glossary_page.sort.descending"),
            clear: t("glossary_page.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-source-head",
        cell_class_name: "glossary-page__table-source-cell",
        render_cell: (payload) => {
          return <span className="glossary-page__table-text">{payload.row.entry.src}</span>;
        },
      },
      {
        kind: "data",
        id: "dst",
        title: t("glossary_page.fields.translation"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("glossary_page.sort.ascending"),
            descending: t("glossary_page.sort.descending"),
            clear: t("glossary_page.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-translation-head",
        cell_class_name: "glossary-page__table-translation-cell",
        render_cell: (payload) => {
          return <span className="glossary-page__table-text">{payload.row.entry.dst}</span>;
        },
      },
      {
        kind: "data",
        id: "info",
        title: t("glossary_page.fields.description"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("glossary_page.sort.ascending"),
            descending: t("glossary_page.sort.descending"),
            clear: t("glossary_page.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-description-head",
        cell_class_name: "glossary-page__table-description-cell",
        render_cell: (payload) => (
          <span className="glossary-page__table-text">{payload.row.entry.info}</span>
        ),
      },
      {
        kind: "data",
        id: "rule",
        title: t("glossary_page.fields.rule"),
        width: 96,
        align: "center",
        sortable: {
          action_labels: {
            ascending: t("glossary_page.sort.ascending"),
            descending: t("glossary_page.sort.descending"),
            clear: t("glossary_page.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-rule-head",
        cell_class_name: "glossary-page__table-rule-cell",
        render_cell: (payload) => {
          const case_tooltip = t("glossary_page.toggle.status")
            .replace("{TITLE}", t("glossary_page.rule.case_sensitive"))
            .replace(
              "{STATE}",
              t(payload.row.entry.case_sensitive ? "app.toggle.enabled" : "app.toggle.disabled"),
            );

          return (
            <GlossaryRuleBadge enabled={payload.row.entry.case_sensitive} tooltip={case_tooltip} />
          );
        },
      },
      {
        kind: "data",
        id: "statistics",
        title: t("glossary_page.fields.statistics"),
        width: 92,
        align: "center",
        sortable: {
          disabled: !props.statistics_ready,
          action_labels: {
            ascending: t("glossary_page.sort.ascending"),
            descending: t("glossary_page.sort.descending"),
            clear: t("glossary_page.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-statistics-head",
        cell_class_name: "glossary-page__table-statistics-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <GlossaryStatisticsBadge
              entry_id={payload.row_id}
              badge_state={props.statistics_badge_by_entry_id[payload.row_id] ?? null}
              on_query_entry_source={props.on_query_entry_source}
              on_search_entry_relations={props.on_search_entry_relations}
            />
          );
        },
      },
    ];
  }, [props, t]);

  return (
    <Card variant="table" className="glossary-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t("glossary_page.title")}</CardTitle>
      </CardHeader>
      <CardContent className="glossary-page__table-card-content">
        <AppTable
          rows={props.entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={map_glossary_sort_state(props.sort_state)}
          drag_enabled={!props.drag_disabled}
          get_row_id={(entry) => entry.entry_id}
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={(payload) => {
            void props.on_reorder(payload.active_row_id, payload.over_row_id);
          }}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            const target_entry_ids = resolve_glossary_context_target_entry_ids(
              payload.row_id,
              props.selected_entry_ids,
            );
            const case_sensitive_state = resolve_glossary_rule_menu_state({
              entry_by_id: visible_entry_by_id,
              target_entry_ids,
              pick_value: (entry) => entry.entry.case_sensitive,
            });

            return (
              <GlossaryContextMenuContent
                case_sensitive_state={case_sensitive_state}
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
                on_toggle_case_sensitive={props.on_toggle_case_sensitive}
              />
            );
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="glossary-page__table"
          row_class_name={() => "glossary-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
