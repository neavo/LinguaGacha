import { CircleEllipsis } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuItems,
} from "@frontend/pages/workbench-page/components/workbench-table-action-menu";
import type { WorkbenchFileEntry } from "@frontend/pages/workbench-page/types";
import { AppButton } from "@frontend/widgets/app-button";
import { Card, CardContent } from "@frontend/shadcn/card";
import { AppTable } from "@frontend/widgets/app-table/app-table";
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from "@frontend/widgets/app-table/app-table-types";

type WorkbenchFileTableProps = {
  entries: WorkbenchFileEntry[];
  selected_entry_ids: string[];
  active_entry_id: string | null;
  anchor_entry_id: string | null;
  readonly: boolean;
  on_selection_change: (payload: AppTableSelectionChange) => void;
  on_prepare_entry_action: (entry_id: string) => void;
  on_reset: (entry_id: string) => void;
  on_reorder: (ordered_entry_ids: string[]) => Promise<void>;
};

/**
 * 排序当前列表并保持展示稳定。
 */
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
      compare_result =
        (left_entry.pdf?.pages ?? left_entry.item_count) -
        (right_entry.pdf?.pages ?? right_entry.item_count);
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

/** 页面内排序只改变展示；手动重排通过回调保存工程顺序。 */
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
  const columns = useMemo<AppTableColumn<WorkbenchFileEntry>[]>(() => {
    return [
      {
        kind: "drag",
        id: "drag",
        width: 64,
        align: "center",
        title: t("app.drag.handle"),
        head_class_name: "workbench-page__table-drag-head",
        cell_class_name: "workbench-page__table-drag-cell",
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
          return (
            <span className="workbench-page__table-file-text">
              {payload.row.rel_path}
              {payload.row.pdf
                ? ` · ${t("workbench_page.pdf.coverage", {
                    translated: String(payload.row.pdf.translated_pages),
                    pages: String(payload.row.pdf.pages),
                  })}`
                : ""}
            </span>
          );
        },
        render_placeholder: () => {
          return <span className="workbench-page__table-file-text">{"\u00A0"}</span>;
        },
      },
      {
        kind: "data",
        id: "line",
        title: t(
          props.entries.some((entry) => entry.pdf)
            ? "workbench_page.pdf.content"
            : "workbench_page.table.line_count",
        ),
        width: props.entries.some((entry) => entry.pdf) ? 160 : 108,
        align: "center",
        sortable: {
          action_labels: sort_action_labels,
        },
        head_class_name: "workbench-page__table-line-head",
        cell_class_name: "workbench-page__table-line-cell",
        render_cell: (payload) => {
          return (
            <span className="workbench-page__table-line-text">
              {payload.row.pdf
                ? t("workbench_page.pdf.pages", {
                    reviewed: String(payload.row.pdf.reviewed_pages),
                    pages: String(payload.row.pdf.pages),
                  })
                : payload.row.item_count}
            </span>
          );
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
              <AppButton
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled
                tabIndex={-1}
                aria-hidden="true"
                className="workbench-page__row-action"
              >
                <CircleEllipsis data-icon="inline-start" />
              </AppButton>
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
  }, [
    props.entries,
    props.on_prepare_entry_action,
    props.on_reset,
    props.readonly,
    sort_action_labels,
    t,
  ]);

  return (
    <Card variant="table" className="workbench-page__table-card">
      <CardContent className="workbench-page__table-card-content">
        <AppTable
          rows={sorted_entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={sort_state}
          get_row_id={(entry) => entry.rel_path}
          on_selection_change={props.on_selection_change}
          on_sort_change={set_sort_state}
          on_reorder={props.on_reorder}
          reorder_disabled={props.readonly}
          render_row_context_menu_items={(payload) => {
            return (
              <WorkbenchTableContextMenuItems
                disabled={props.readonly}
                on_reset={() => props.on_reset(payload.row_id)}
              />
            );
          }}
          box_selection_enabled
          table_class_name="workbench-page__table"
          row_class_name={() => "workbench-page__table-row"}
        />
      </CardContent>
    </Card>
  );
}
