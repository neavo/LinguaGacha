import { useMemo } from "react";

import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { TextPreserveContextMenuContent } from "@frontend/pages/text-preserve-page/components/text-preserve-context-menu";
import type {
  TextPreserveEntryId,
  TextPreserveHitBadgeState,
  TextPreserveVisibleEntry,
} from "@frontend/pages/text-preserve-page/types";
import { Card, CardContent } from "@frontend/shadcn/card";
import { QualityRuleHitBadge } from "@frontend/features/quality-rule-editor/quality-rule-hit-badge";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";
import { AppTableDragIndicator } from "@frontend/widgets/app-table/app-table-drag-indicator";

type TextPreserveTableProps = {
  title_key: LocaleKey;
  entries: TextPreserveVisibleEntry[];
  sort_state: AppTableSortState | null;
  readonly: boolean;
  drag_disabled: boolean;
  hit_running: boolean;
  hit_ready: boolean;
  selected_entry_ids: TextPreserveEntryId[];
  active_entry_id: TextPreserveEntryId | null;
  anchor_entry_id: TextPreserveEntryId | null;
  restore_scroll_entry_id: TextPreserveEntryId | null;
  hit_badge_by_entry_id: Record<TextPreserveEntryId, TextPreserveHitBadgeState>;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (entry_id: TextPreserveEntryId) => void;
  on_reorder: (
    active_entry_id: TextPreserveEntryId,
    over_entry_id: TextPreserveEntryId,
  ) => Promise<void>;
  on_query_entry_source: (entry_id: TextPreserveEntryId) => Promise<void>;
};

export function TextPreserveTable(props: TextPreserveTableProps): JSX.Element {
  const { t } = useI18n();

  const columns = useMemo<AppTableColumn<TextPreserveVisibleEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("app.drag.handle"),
        head_class_name: "text-preserve-page__table-drag-head",
        cell_class_name: "text-preserve-page__table-drag-cell",
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
        title: t("quality_rule_editor.fields.rule"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
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
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
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
        id: "hit",
        title: t("text_preserve_page.fields.hit"),
        width: 92,
        align: "center",
        sortable: {
          disabled: !props.hit_ready,
          action_labels: {
            ascending: t("quality_rule_editor.sort.ascending"),
            descending: t("quality_rule_editor.sort.descending"),
            clear: t("quality_rule_editor.sort.clear"),
          },
        },
        head_class_name: "text-preserve-page__table-hit-head",
        cell_class_name: "text-preserve-page__table-hit-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return null;
          }

          return (
            <QualityRuleHitBadge
              entry_id={payload.row_id}
              running={props.hit_running}
              badge_state={props.hit_badge_by_entry_id[payload.row_id] ?? null}
              badge_class_name="preserve-page__hit-badge"
              running_class_name="preserve-page__hit-badge--running"
              wrap_class_name="text-preserve-page__hit-badge-wrap"
              button_class_name="preserve-page__hit-badge-button"
              query_label={t("app.action.query")}
              on_query_entry_source={props.on_query_entry_source}
            />
          );
        },
      },
    ];
  }, [
    props.on_query_entry_source,
    props.hit_badge_by_entry_id,
    props.hit_ready,
    props.hit_running,
    t,
  ]);

  return (
    <Card variant="table" className="text-preserve-page__table-card">
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
            return (
              <TextPreserveContextMenuContent
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
              />
            );
          }}
          box_selection_enabled
          table_class_name="text-preserve-page__table"
          row_class_name={() => "text-preserve-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
