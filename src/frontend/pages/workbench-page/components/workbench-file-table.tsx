import { TranslationProgressBadge } from "@frontend/features/translation-progress/translation-progress-badge";
import { CircleEllipsis } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuItems,
} from "@frontend/pages/workbench-page/components/workbench-table-action-menu";
import type { WorkbenchFileEntry } from "@shared/workbench/workbench-query";
import { Badge } from "@frontend/shadcn/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
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
    } else if (sort_state.column_id === "progress") {
      compare_result =
        left_entry.progress.completion_percent - right_entry.progress.completion_percent;
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
        kind: "data",
        drag_handle: true,
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
            <div className="workbench-page__table-file">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="workbench-page__table-file-text"
                      tabIndex={payload.presentation === "body" ? 0 : -1}
                    />
                  }
                >
                  {payload.row.rel_path}
                </TooltipTrigger>
                <TooltipContent>{payload.row.rel_path}</TooltipContent>
              </Tooltip>
              {payload.row.file_type === "PDF" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge tone="brand" tabIndex={payload.presentation === "body" ? 0 : -1} />
                    }
                  >
                    {t("workbench_page.table.agent")}
                  </TooltipTrigger>
                  <TooltipContent>{t("workbench_page.table.agent_only")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          );
        },
        render_placeholder: () => {
          return <span className="workbench-page__table-file-text">{"\u00A0"}</span>;
        },
      },
      {
        kind: "data",
        id: "progress",
        title: t("workbench_page.table.progress"),
        width: 120,
        align: "center",
        sortable: {
          action_labels: sort_action_labels,
        },
        head_class_name: "workbench-page__table-progress-head",
        cell_class_name: "workbench-page__table-progress-cell",
        render_cell: (payload) => {
          return (
            <TranslationProgressBadge
              progress={payload.row.progress}
              total={payload.row.progress.total_count}
              unit={payload.row.progress.unit}
              tabIndex={payload.presentation === "body" ? 0 : -1}
            />
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
  }, [props.on_prepare_entry_action, props.on_reset, props.readonly, sort_action_labels, t]);

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
