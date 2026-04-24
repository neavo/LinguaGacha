import { useMemo } from "react";

import { useI18n } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import { Spinner } from "@/shadcn/spinner";
import { AppTable } from "@/widgets/app-table/app-table";
import { AppTableDragIndicator } from "@/widgets/app-table/app-table-drag-indicator";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";
import { NameFieldExtractionContextMenuContent } from "@/pages/name-field-extraction-page/components/name-field-extraction-context-menu";
import type {
  NameFieldRow,
  NameFieldRowId,
  NameFieldSortState,
} from "@/pages/name-field-extraction-page/types";

type NameFieldExtractionTableProps = {
  rows: NameFieldRow[];
  sort_state: NameFieldSortState;
  selected_row_ids: NameFieldRowId[];
  active_row_id: NameFieldRowId | null;
  anchor_row_id: NameFieldRowId | null;
  on_sort_change: (sort_state: AppTableSortState | null) => void;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_open_edit: (row_id: NameFieldRowId) => void;
};

function map_sort_state(sort_state: NameFieldSortState): AppTableSortState | null {
  if (sort_state.field === null || sort_state.direction === null) {
    return null;
  }

  return {
    column_id: sort_state.field,
    direction: sort_state.direction,
  };
}

function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-name-field-ignore-row-click="true"]',
        '[data-app-table-ignore-row-click="true"]',
      ].join(", "),
    ) !== null
  );
}

function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-name-field-ignore-box-select="true"]',
        '[data-app-table-ignore-box-select="true"]',
        '[data-slot="scroll-area-scrollbar"]',
        '[data-slot="scroll-area-thumb"]',
        '[data-slot="scroll-area-corner"]',
      ].join(", "),
    ) !== null
  );
}

function build_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

export function NameFieldExtractionTable(props: NameFieldExtractionTableProps): JSX.Element {
  const { t } = useI18n();
  const columns = useMemo<AppTableColumn<NameFieldRow>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        title: t("name_field_extraction_page.fields.drag"),
        width: 64,
        align: "center",
        head_class_name: "name-field-extraction-page__table-drag-head",
        cell_class_name: "name-field-extraction-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={build_row_number_label(payload.row_index)}
              can_drag={false}
              dragging={false}
              drag_handle={null}
              show_tooltip={payload.presentation !== "overlay"}
            />
          );
        },
      },
      {
        kind: "data",
        id: "src",
        title: t("name_field_extraction_page.fields.source"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("name_field_extraction_page.sort.ascending"),
            descending: t("name_field_extraction_page.sort.descending"),
            clear: t("name_field_extraction_page.sort.clear"),
          },
        },
        head_class_name: "name-field-extraction-page__table-source-head",
        cell_class_name: "name-field-extraction-page__table-source-cell",
        render_cell: (payload) => {
          return <span className="name-field-extraction-page__table-text">{payload.row.src}</span>;
        },
      },
      {
        kind: "data",
        id: "dst",
        title: t("name_field_extraction_page.fields.translation"),
        align: "left",
        sortable: {
          action_labels: {
            ascending: t("name_field_extraction_page.sort.ascending"),
            descending: t("name_field_extraction_page.sort.descending"),
            clear: t("name_field_extraction_page.sort.clear"),
          },
        },
        head_class_name: "name-field-extraction-page__table-translation-head",
        cell_class_name: "name-field-extraction-page__table-translation-cell",
        render_cell: (payload) => {
          if (payload.row.status === "translating") {
            return (
              <span className="name-field-extraction-page__table-translating">
                <Spinner className="name-field-extraction-page__table-spinner" />
                {t("name_field_extraction_page.status.translating")}
              </span>
            );
          }

          return <span className="name-field-extraction-page__table-text">{payload.row.dst}</span>;
        },
      },
    ];
  }, [props, t]);

  return (
    <Card variant="table" className="name-field-extraction-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t("name_field_extraction_page.title")}</CardTitle>
      </CardHeader>
      <CardContent className="name-field-extraction-page__table-card-content">
        <AppTable
          rows={props.rows}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_row_ids}
          active_row_id={props.active_row_id}
          anchor_row_id={props.anchor_row_id}
          sort_state={map_sort_state(props.sort_state)}
          drag_enabled={false}
          get_row_id={(row) => row.id}
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={() => {}}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id);
          }}
          render_row_context_menu={(payload) => {
            return (
              <NameFieldExtractionContextMenuContent
                on_edit={() => {
                  props.on_open_edit(payload.row_id);
                }}
              />
            );
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="name-field-extraction-page__table"
          row_class_name={() => "name-field-extraction-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
