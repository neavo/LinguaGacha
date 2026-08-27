import { CaseSensitive } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import { GlossaryContextMenuContent } from "@frontend/pages/glossary-page/components/glossary-context-menu";
import type {
  GlossaryEntryId,
  GlossarySortState,
  GlossaryHitBadgeState,
  GlossaryVisibleEntry,
} from "@frontend/pages/glossary-page/types";
import { Card, CardContent } from "@frontend/shadcn/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { QualityRuleHitBadge } from "@frontend/features/quality-rule-editor/quality-rule-hit-badge";
import { resolve_quality_rule_boolean_menu_state } from "@frontend/features/quality-rule-editor/quality-rule-selection";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import { resolve_app_table_context_target_row_ids } from "@frontend/widgets/app-table/app-table-selection";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import { AppTableDragIndicator } from "@frontend/widgets/app-table/app-table-drag-indicator";

type GlossaryTableProps = {
  entries: GlossaryVisibleEntry[];
  sort_state: GlossarySortState;
  readonly: boolean;
  drag_disabled: boolean;
  hit_sort_available: boolean;
  selected_entry_ids: GlossaryEntryId[];
  active_entry_id: GlossaryEntryId | null;
  anchor_entry_id: GlossaryEntryId | null;
  restore_scroll_entry_id: GlossaryEntryId | null;
  hit_badge_by_entry_id: Record<GlossaryEntryId, GlossaryHitBadgeState>;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (entry_id: GlossaryEntryId) => void;
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>;
  on_reorder: (active_entry_id: GlossaryEntryId, over_entry_id: GlossaryEntryId) => Promise<void>;
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>;
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void;
};

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
        data-app-table-ignore-box-select="true"
        className="glossary-page__rule-badge"
      >
        <CaseSensitive aria-hidden="true" />
      </span>
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent side="top" sideOffset={8}>
        <p className="whitespace-pre-line">{props.tooltip}</p>
      </TooltipContent>
    </Tooltip>
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
        title: t("app.drag.handle"),
        head_class_name: "glossary-page__table-drag-head",
        cell_class_name: "glossary-page__table-drag-cell",
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
        title: t("quality_rule_editor.fields.source"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
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
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
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
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
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
        title: t("quality_rule_editor.fields.rule"),
        width: 96,
        align: "center",
        sortable: {
          action_labels: {
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-rule-head",
        cell_class_name: "glossary-page__table-rule-cell",
        render_cell: (payload) => {
          const case_tooltip = t("app.tooltip.value", {
            TITLE: t("glossary_page.rule.case_sensitive"),
            VALUE: t(payload.row.entry.case_sensitive ? "app.state.enabled" : "app.state.disabled"),
          });

          return (
            <GlossaryRuleBadge enabled={payload.row.entry.case_sensitive} tooltip={case_tooltip} />
          );
        },
      },
      {
        kind: "data",
        id: "hit",
        title: t("glossary_page.fields.hit"),
        width: 92,
        align: "center",
        sortable: {
          disabled: !props.hit_sort_available,
          action_labels: {
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
          },
        },
        head_class_name: "glossary-page__table-hit-head",
        cell_class_name: "glossary-page__table-hit-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <QualityRuleHitBadge
              entry_id={payload.row_id}
              running={false}
              badge_state={props.hit_badge_by_entry_id[payload.row_id] ?? null}
              badge_class_name="glossary-page__hit-badge"
              running_class_name=""
              wrap_class_name="glossary-page__hit-badge-wrap"
              button_class_name="glossary-page__hit-badge-button"
              query_label={t("glossary_page.hit.action.query_source")}
              relation_label={t("glossary_page.hit.action.search_relation")}
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
    props.hit_sort_available,
    t,
  ]);

  return (
    <Card variant="table" className="glossary-page__table-card">
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
          scroll_to_row={
            props.restore_scroll_entry_id === null
              ? undefined
              : { row_id: props.restore_scroll_entry_id, revision: 0 }
          }
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={(payload) => {
            void props.on_reorder(payload.active_row_id, payload.over_row_id);
          }}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            const target_entry_ids = resolve_app_table_context_target_row_ids(
              payload.row_id,
              props.selected_entry_ids,
            );
            const case_sensitive_state = resolve_quality_rule_boolean_menu_state({
              entry_by_id: visible_entry_by_id,
              target_entry_ids,
              pick_value: (entry) => entry.entry.case_sensitive,
            });

            return (
              <GlossaryContextMenuContent
                case_sensitive_state={case_sensitive_state}
                readonly={props.readonly}
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
                on_toggle_case_sensitive={props.on_toggle_case_sensitive}
              />
            );
          }}
          box_selection_enabled
          table_class_name="glossary-page__table"
          row_class_name={() => "glossary-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
