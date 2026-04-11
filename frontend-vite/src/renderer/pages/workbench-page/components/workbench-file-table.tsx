import { CircleEllipsis, GripVertical } from 'lucide-react'
import { useMemo } from 'react'

import { useI18n } from '@/i18n'
import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuContent,
} from '@/pages/workbench-page/components/workbench-table-action-menu'
import type { WorkbenchFileEntry } from '@/pages/workbench-page/types'
import { Button } from '@/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip'
import { AppTable } from '@/widgets/app-table/app-table'
import type {
  AppTableColumn,
  AppTableSelectionChange,
} from '@/widgets/app-table/app-table-types'

type WorkbenchFileTableProps = {
  entries: WorkbenchFileEntry[]
  selected_entry_id: string | null
  readonly: boolean
  on_select: (entry_id: string) => void
  on_replace: (entry_id: string) => void
  on_reset: (entry_id: string) => void
  on_delete: (entry_id: string) => void
  on_reorder: (ordered_entry_ids: string[]) => void
}

function build_workbench_row_number_label(row_index: number): string {
  return String(row_index + 1)
}

function should_ignore_workbench_row_click(target_element: HTMLElement): boolean {
  return target_element.closest('[data-workbench-ignore-row-click="true"]') !== null
}

export function WorkbenchFileTable(props: WorkbenchFileTableProps): JSX.Element {
  const { t } = useI18n()

  const columns = useMemo<AppTableColumn<WorkbenchFileEntry>[]>(() => {
    return [
      {
        kind: 'drag',
        id: 'drag',
        width: 64,
        align: 'center',
        title: t('workbench_page.table.drag_handle'),
        aria_label: t('workbench_page.table.drag_handle_aria'),
        head_class_name: 'workbench-page__table-drag-head',
        cell_class_name: 'workbench-page__table-drag-cell',
        render_cell: (payload) => {
          const utility = (
            <div
              className="workbench-page__row-utility"
              data-drag-disabled={!payload.can_drag ? 'true' : undefined}
              data-workbench-ignore-row-click="true"
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.attributes ?? {})}
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.listeners ?? {})}
            >
              <span className="workbench-page__drag-handle" aria-hidden="true">
                <GripVertical />
              </span>
              <span className="workbench-page__row-index">
                {build_workbench_row_number_label(payload.row_index)}
              </span>
            </div>
          )

          return payload.drag_handle === null || payload.drag_handle.disabled
            ? utility
            : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {utility}
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    <p>{payload.aria_label}</p>
                  </TooltipContent>
                </Tooltip>
              )
        },
        render_placeholder: () => {
          return (
            <div className="workbench-page__row-utility">
              <span className="workbench-page__drag-handle" aria-hidden="true">
                <GripVertical />
              </span>
              <span className="workbench-page__row-index">
                {'88'}
              </span>
            </div>
          )
        },
      },
      {
        kind: 'data',
        id: 'file',
        title: t('workbench_page.table.file_name'),
        align: 'left',
        head_class_name: 'workbench-page__table-file-head',
        cell_class_name: 'workbench-page__table-file-cell',
        render_cell: (payload) => {
          return (
            <span
              className="workbench-page__table-file-text"
              data-ui-text="emphasis"
            >
              {payload.row.rel_path}
            </span>
          )
        },
        render_placeholder: () => {
          return (
            <span
              className="workbench-page__table-file-text"
              data-ui-text="emphasis"
            >
              {'\u00A0'}
            </span>
          )
        },
      },
      {
        kind: 'data',
        id: 'format',
        title: t('workbench_page.table.format'),
        width: 170,
        align: 'center',
        head_class_name: 'workbench-page__table-format-head',
        cell_class_name: 'workbench-page__table-format-cell',
        render_cell: (payload) => {
          return payload.row.format_label_key === null
            ? (payload.row.format_fallback_label ?? '-')
            : t(payload.row.format_label_key)
        },
      },
      {
        kind: 'data',
        id: 'line',
        title: t('workbench_page.table.line_count'),
        width: 92,
        align: 'center',
        head_class_name: 'workbench-page__table-line-head',
        cell_class_name: 'workbench-page__table-line-cell',
        render_cell: (payload) => {
          return payload.row.item_count
        },
      },
      {
        kind: 'data',
        id: 'action',
        title: t('workbench_page.table.actions'),
        width: 88,
        align: 'center',
        head_class_name: 'workbench-page__table-action-head',
        cell_class_name: 'workbench-page__table-action-cell',
        render_cell: (payload) => {
          if (payload.presentation === 'overlay') {
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
            )
          }

          return (
            <WorkbenchTableActionMenu
              disabled={props.readonly}
              on_prepare_open={() => {
                props.on_select(payload.row_id)
              }}
              on_replace={() => props.on_replace(payload.row_id)}
              on_reset={() => props.on_reset(payload.row_id)}
              on_delete={() => props.on_delete(payload.row_id)}
            />
          )
        },
      },
    ]
  }, [props, t])

  const handle_selection_change = (payload: AppTableSelectionChange): void => {
    const next_selected_row_id = payload.active_row_id ?? payload.selected_row_ids[0] ?? null
    if (next_selected_row_id === null || next_selected_row_id === props.selected_entry_id) {
      return
    }

    props.on_select(next_selected_row_id)
  }

  return (
    <Card variant="table" className="workbench-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t('workbench_page.section.file_list')}</CardTitle>
      </CardHeader>
      <CardContent className="workbench-page__table-card-content">
        <AppTable
          rows={props.entries}
          columns={columns}
          selection_mode="single"
          selected_row_ids={props.selected_entry_id === null ? [] : [props.selected_entry_id]}
          active_row_id={props.selected_entry_id}
          anchor_row_id={props.selected_entry_id}
          sort_state={null}
          drag_enabled={!props.readonly}
          get_row_id={(entry) => entry.rel_path}
          on_selection_change={handle_selection_change}
          on_sort_change={() => {}}
          on_reorder={(payload) => {
            props.on_reorder(payload.ordered_row_ids)
          }}
          render_row_context_menu={(payload) => {
            return (
              <WorkbenchTableContextMenuContent
                disabled={props.readonly}
                on_replace={() => props.on_replace(payload.row_id)}
                on_reset={() => props.on_reset(payload.row_id)}
                on_delete={() => props.on_delete(payload.row_id)}
              />
            )
          }}
          ignore_row_click_target={should_ignore_workbench_row_click}
          table_class_name="workbench-page__table"
          row_class_name={() => 'workbench-page__table-row'}
        />
      </CardContent>
    </Card>
  )
}
