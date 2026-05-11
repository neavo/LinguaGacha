import { useMemo } from "react";

import { useI18n, type LocaleKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { TextPreserveContextMenuContent } from "@/pages/text-preserve-page/components/text-preserve-context-menu";
import type {
  TextPreserveEntryId,
  TextPreserveStatisticsBadgeState,
  TextPreserveVisibleEntry,
} from "@/pages/text-preserve-page/types";
import { Badge } from "@/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { Spinner } from "@/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";
import { AppTable } from "@/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import { AppTableDragIndicator } from "@/widgets/app-table/app-table-drag-indicator";

type TextPreserveTableProps = {
  title_key: LocaleKey;
  entries: TextPreserveVisibleEntry[];
  sort_state: AppTableSortState | null;
  readonly: boolean;
  drag_disabled: boolean;
  statistics_running: boolean;
  statistics_ready: boolean;
  selected_entry_ids: TextPreserveEntryId[];
  active_entry_id: TextPreserveEntryId | null;
  anchor_entry_id: TextPreserveEntryId | null;
  statistics_badge_by_entry_id: Record<TextPreserveEntryId, TextPreserveStatisticsBadgeState>;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (entry_id: TextPreserveEntryId) => void;
  on_reorder: (
    active_entry_id: TextPreserveEntryId,
    over_entry_id: TextPreserveEntryId,
  ) => Promise<void>;
  on_query_entry_source: (entry_id: TextPreserveEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: TextPreserveEntryId) => void;
};

function build_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-text-preserve-ignore-box-select="true"]',
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
      [
        '[data-text-preserve-ignore-row-click="true"]',
        '[data-app-table-ignore-row-click="true"]',
      ].join(", "),
    ) !== null
  );
}

type TextPreserveStatisticsBadgeProps = {
  entry_id: TextPreserveEntryId;
  statistics_running: boolean;
  badge_state: TextPreserveStatisticsBadgeState | null;
  on_query_entry_source: (entry_id: TextPreserveEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: TextPreserveEntryId) => void;
};

function TextPreserveStatisticsBadge(props: TextPreserveStatisticsBadgeProps): JSX.Element | null {
  const { t } = useI18n();

  if (props.statistics_running) {
    return (
      <span
        data-text-preserve-ignore-box-select="true"
        data-text-preserve-ignore-row-click="true"
        className="text-preserve-page__statistics-badge-wrap"
      >
        <Badge
          variant="outline"
          className="preserve-page__statistics-badge preserve-page__statistics-badge--running [&>svg]:!size-[10px]"
        >
          <Spinner data-icon="inline-start" />
          <span className="sr-only">{t("text_preserve_page.statistics.running")}</span>
        </Badge>
      </span>
    );
  }

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
    <Badge className={cn("preserve-page__statistics-badge", badge_color_class_name)}>
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
            data-text-preserve-ignore-box-select="true"
            data-text-preserve-ignore-row-click="true"
            className="text-preserve-page__statistics-badge-wrap"
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
            data-text-preserve-ignore-box-select="true"
            data-text-preserve-ignore-row-click="true"
            className="preserve-page__statistics-badge-button"
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
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <AppDropdownMenuTrigger asChild>
            <button
              type="button"
              data-text-preserve-ignore-box-select="true"
              data-text-preserve-ignore-row-click="true"
              className="preserve-page__statistics-badge-button"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {badge}
            </button>
          </AppDropdownMenuTrigger>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
      <AppDropdownMenuContent align="center">
        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            onClick={() => {
              void props.on_query_entry_source(props.entry_id);
            }}
          >
            {t("text_preserve_page.action.query")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem
            onClick={() => {
              props.on_search_entry_relations(props.entry_id);
            }}
          >
            {t("text_preserve_page.statistics.action.search_relation")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}

export function TextPreserveTable(props: TextPreserveTableProps): JSX.Element {
  const { t } = useI18n();

  const columns = useMemo<AppTableColumn<TextPreserveVisibleEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("text_preserve_page.fields.drag"),
        head_class_name: "text-preserve-page__table-drag-head",
        cell_class_name: "text-preserve-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={build_row_number_label(payload.row_index)}
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
        title: t("text_preserve_page.fields.rule"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("text_preserve_page.sort.ascending"),
            descending: t("text_preserve_page.sort.descending"),
            clear: t("text_preserve_page.sort.clear"),
          },
        },
        head_class_name: "text-preserve-page__table-rule-head",
        cell_class_name: "text-preserve-page__table-rule-cell",
        render_cell: (payload) => (
          <span className="text-preserve-page__table-text">{payload.row.entry.src}</span>
        ),
      },
      {
        kind: "data",
        id: "info",
        title: t("text_preserve_page.fields.note"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("text_preserve_page.sort.ascending"),
            descending: t("text_preserve_page.sort.descending"),
            clear: t("text_preserve_page.sort.clear"),
          },
        },
        head_class_name: "text-preserve-page__table-note-head",
        cell_class_name: "text-preserve-page__table-note-cell",
        render_cell: (payload) => (
          <span className="text-preserve-page__table-text">{payload.row.entry.info}</span>
        ),
      },
      {
        kind: "data",
        id: "statistics",
        title: t("text_preserve_page.fields.statistics"),
        width: 92,
        align: "center",
        sortable: {
          disabled: !props.statistics_ready,
          action_labels: {
            ascending: t("text_preserve_page.sort.ascending"),
            descending: t("text_preserve_page.sort.descending"),
            clear: t("text_preserve_page.sort.clear"),
          },
        },
        head_class_name: "text-preserve-page__table-statistics-head",
        cell_class_name: "text-preserve-page__table-statistics-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <TextPreserveStatisticsBadge
              entry_id={payload.row_id}
              statistics_running={props.statistics_running}
              badge_state={props.statistics_badge_by_entry_id[payload.row_id] ?? null}
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
    props.statistics_badge_by_entry_id,
    props.statistics_ready,
    props.statistics_running,
    t,
  ]);

  return (
    <Card variant="table" className="text-preserve-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t(props.title_key)}</CardTitle>
      </CardHeader>
      <CardContent className="text-preserve-page__table-card-content">
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
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={(payload) => {
            void props.on_reorder(payload.active_row_id, payload.over_row_id);
          }}
          on_row_double_click={(payload) => {
            if (props.readonly) {
              return;
            }

            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            if (props.readonly) {
              return null;
            }

            return (
              <TextPreserveContextMenuContent
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
              />
            );
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="text-preserve-page__table"
          row_class_name={() => "text-preserve-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
