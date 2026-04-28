import { CircleEllipsis } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuContent,
} from "@/pages/workbench-page/components/workbench-table-action-menu";
import type { WorkbenchFileEntry } from "@/pages/workbench-page/types";
import { Button } from "@/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/card";
import { AppTable } from "@/widgets/app-table/app-table";
import { AppTableDragIndicator } from "@/widgets/app-table/app-table-drag-indicator";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@/widgets/app-table/app-table-types";

type WorkbenchFileTableProps = {
  entries: WorkbenchFileEntry[];
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
  readonly: boolean;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_prepare_entry_action: (entry_id: string) => void;
  on_reset: (entry_id: string) => void;
  on_reorder: (ordered_entry_ids: string[]) => void;
};

function build_workbench_row_number_label(row_index: number): string {
  return String(row_index + 1);
}

function sort_workbench_entries(
  entries: WorkbenchFileEntry[],
  sort_state: AppTableSortState | null,
): WorkbenchFileEntry[] {
  if (sort_state === null) {
    return entries;
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const sorted_entries = [...entries];
  sorted_entries.sort((left_entry, right_entry) => {
    let compare_result = 0;

    if (sort_state.column_id === "file") {
      compare_result = collator.compare(left_entry.rel_path, right_entry.rel_path);
    } else if (sort_state.column_id === "line") {
      compare_result = left_entry.item_count - right_entry.item_count;
    }

    if (compare_result === 0) {
      compare_result = collator.compare(left_entry.rel_path, right_entry.rel_path);
    }

    if (sort_state.direction === "descending") {
      return -compare_result;
    }

    return compare_result;
  });

  return sorted_entries;
}

function should_ignore_workbench_row_click(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      ['[data-workbench-ignore-row-click="true"]', '[data-app-table-ignore-row-click="true"]'].join(
        ", ",
      ),
    ) !== null
  );
}

function should_ignore_workbench_box_selection_target(target_element: HTMLElement): boolean {
  return (
    target_element.closest(
      [
        '[data-workbench-ignore-box-select="true"]',
        '[data-app-table-ignore-box-select="true"]',
        '[data-slot="scroll-area-scrollbar"]',
        '[data-slot="scroll-area-thumb"]',
        '[data-slot="scroll-area-corner"]',
      ].join(", "),
    ) !== null
  );
}

export function WorkbenchFileTable(props: WorkbenchFileTableProps): JSX.Element {
  const { t } = useI18n();
  const [sort_state, set_sort_state] = useState<AppTableSortState | null>(null);
  const sort_action_labels = useMemo(() => {
    return {
      ascending: t("workbench_page.sort.ascending"),
      descending: t("workbench_page.sort.descending"),
      clear: t("workbench_page.sort.clear"),
    };
  }, [t]);
  const sorted_entries = useMemo(() => {
    return sort_workbench_entries(props.entries, sort_state);
  }, [props.entries, sort_state]);
  // 为什么：排序视图展示的是临时顺序，不再等于工程真实文件顺序，此时继续拖拽会误导用户。
  const drag_enabled = !props.readonly && sort_state === null;

  const columns = useMemo<AppTableColumn<WorkbenchFileEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("workbench_page.table.drag_handle"),
        head_class_name: "workbench-page__table-drag-head",
        cell_class_name: "workbench-page__table-drag-cell",
        render_cell: (payload) => {
          return (
            <AppTableDragIndicator
              row_number={build_workbench_row_number_label(payload.row_index)}
              can_drag={payload.can_drag}
              dragging={payload.dragging}
              drag_handle={payload.drag_handle}
              show_tooltip={payload.presentation !== "overlay"}
            />
          );
        },
        render_placeholder: () => {
          return (
            <AppTableDragIndicator
              row_number={"88"}
              can_drag
              dragging={false}
              drag_handle={null}
              show_tooltip={false}
            />
          );
        },
      },
      {
        kind: "data",
        id: "file",
        title: t("workbench_page.table.file_name"),
        align: "left",
        sortable: {
          action_labels: sort_action_labels,
        },
        head_class_name: "workbench-page__table-file-head",
        cell_class_name: "workbench-page__table-file-cell",
        render_cell: (payload) => {
          return <span className="workbench-page__table-file-text">{payload.row.rel_path}</span>;
        },
        render_placeholder: () => {
          return <span className="workbench-page__table-file-text">{"\u00A0"}</span>;
        },
      },
      {
        kind: "data",
        id: "line",
        title: t("workbench_page.table.line_count"),
        width: 108,
        align: "center",
        sortable: {
          action_labels: sort_action_labels,
        },
        head_class_name: "workbench-page__table-line-head",
        cell_class_name: "workbench-page__table-line-cell",
        render_cell: (payload) => {
          return <span className="workbench-page__table-line-text">{payload.row.item_count}</span>;
        },
      },
      {
        kind: "data",
        id: "action",
        title: t("workbench_page.table.actions"),
        width: 108,
        align: "center",
        head_class_name: "workbench-page__table-action-head",
        cell_class_name: "workbench-page__table-action-cell",
        render_cell: (payload) => {
          if (payload.presentation === "overlay") {
            return (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled
                tabIndex={-1}
                aria-hidden="true"
                className="workbench-page__row-action"
              >
                <CircleEllipsis data-icon="inline-start" />
              </Button>
            );
          }

          return (
            <WorkbenchTableActionMenu
              disabled={props.readonly}
              on_prepare_open={() => {
                props.on_prepare_entry_action(payload.row_id);
              }}
              on_reset={() => props.on_reset(payload.row_id)}
            />
          );
        },
      },
    ];
  }, [props.on_prepare_entry_action, props.on_reset, props.readonly, sort_action_labels, t]);

  return (
    <Card variant="table" className="workbench-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t("workbench_page.section.file_list")}</CardTitle>
      </CardHeader>
      <CardContent className="workbench-page__table-card-content">
        <AppTable
          rows={sorted_entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={sort_state}
          drag_enabled={drag_enabled}
          get_row_id={(entry) => entry.rel_path}
          on_selection_change={props.on_selection_change}
          on_sort_change={set_sort_state}
          on_reorder={(payload) => {
            props.on_reorder(payload.ordered_row_ids);
          }}
          render_row_context_menu={(payload) => {
            return (
              <WorkbenchTableContextMenuContent
                disabled={props.readonly}
                on_reset={() => props.on_reset(payload.row_id)}
              />
            );
          }}
          ignore_row_click_target={should_ignore_workbench_row_click}
          ignore_box_select_target={should_ignore_workbench_box_selection_target}
          box_selection_enabled
          table_class_name="workbench-page__table"
          row_class_name={() => "workbench-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
