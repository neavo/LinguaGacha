import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/shadcn/button'
import {
  TableCell,
  TableHead,
  TableRow,
} from '@/shadcn/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'
import type {
  AppTableColumn,
  AppTableDataColumn,
  AppTableSortDirection,
} from '@/widgets/app-table/app-table-types'

function resolve_sort_action_label(args: {
  direction: AppTableSortDirection | null
  column: AppTableDataColumn<unknown>
}): string | null {
  if (args.column.sortable === undefined || args.column.sortable.disabled) {
    return null
  }

  if (args.direction === null) {
    return args.column.sortable.action_labels.ascending
  }

  if (args.direction === 'ascending') {
    return args.column.sortable.action_labels.descending
  }

  return args.column.sortable.action_labels.clear
}

export function AppTableHeadCell<Row>(args: {
  column: AppTableColumn<Row>
  direction: AppTableSortDirection | null
  on_cycle_sort: (() => void) | null
  has_divider: boolean
}): JSX.Element {
  if (args.column.kind === 'drag') {
    return (
      <TableHead
        className={cn(
          'app-table__head-cell app-table__drag-head',
          args.column.head_class_name,
        )}
        data-align={args.column.align ?? 'center'}
        data-divider={args.has_divider ? 'true' : undefined}
      >
        <div className="app-table__head-content app-table__head-content--compact">
          <span className="app-table__head-label">
            {args.column.title}
          </span>
        </div>
      </TableHead>
    )
  }

  const action_label = resolve_sort_action_label({
    direction: args.direction,
    column: args.column as AppTableDataColumn<unknown>,
  })
  const Icon = args.direction === 'ascending'
    ? ArrowUp
    : args.direction === 'descending'
      ? ArrowDown
      : ArrowUpDown
  const trigger = action_label === null || args.on_cycle_sort === null
    ? null
    : (
        <span className="inline-flex">
          <Button
            type="button"
            variant={args.direction === null ? 'ghost' : 'secondary'}
            size="icon-xs"
            data-direction={args.direction ?? undefined}
            data-active={args.direction === null ? undefined : 'true'}
            className="app-table__sort-trigger"
            aria-label={action_label}
            onClick={args.on_cycle_sort}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
          </Button>
        </span>
      )
  const resolved_trigger = trigger === null
    ? null
    : (
        <Tooltip>
          <TooltipTrigger asChild>
            {trigger}
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            <p>{action_label}</p>
          </TooltipContent>
        </Tooltip>
      )
  const head_content = args.column.render_head?.({
    direction: args.direction,
    trigger: resolved_trigger,
  }) ?? (
    <div className="app-table__head-content">
      <span className="app-table__head-label">
        {args.column.title}
      </span>
      {resolved_trigger === null
        ? null
        : (
            <span className="app-table__head-action">
              {resolved_trigger}
            </span>
          )}
    </div>
  )

  return (
    <TableHead
      className={cn('app-table__head-cell', args.column.head_class_name)}
      data-align={args.column.align ?? 'left'}
      data-divider={args.has_divider ? 'true' : undefined}
    >
      {head_content}
    </TableHead>
  )
}

export function AppTableSpacerRow(props: {
  column_count: number
  height: number
}): JSX.Element {
  return (
    <TableRow
      aria-hidden="true"
      className="app-table__row app-table__spacer-row"
    >
      <TableCell
        colSpan={props.column_count}
        className="app-table__spacer-cell"
      >
        <div
          className="app-table__spacer-fill"
          style={{ height: props.height }}
        />
      </TableCell>
    </TableRow>
  )
}

export function AppTablePlaceholderRow<Row>(props: {
  columns: AppTableColumn<Row>[]
  row_index: number
  height: number
}): JSX.Element {
  const row_style: CSSProperties = {
    height: props.height,
  }

  return (
    <TableRow
      aria-hidden="true"
      data-row-index={props.row_index}
      data-zebra={props.row_index % 2 === 1 ? 'even' : 'odd'}
      className="app-table__row app-table__placeholder-row"
      style={row_style}
    >
      {props.columns.map((column, column_index) => {
        const placeholder = column.render_placeholder?.() ?? <span>{'\u00A0'}</span>
        return (
          <TableCell
            key={`${column.id}-placeholder-${column_index.toString()}`}
            className={cn(
              'app-table__placeholder-cell',
              column.kind === 'drag' ? 'app-table__drag-cell' : undefined,
              column.cell_class_name,
            )}
            data-align={column.align ?? (column.kind === 'drag' ? 'center' : 'left')}
            data-divider={column_index < props.columns.length - 1 ? 'true' : undefined}
          >
            <span className="app-table__placeholder-content">
              {placeholder}
            </span>
          </TableCell>
        )
      })}
    </TableRow>
  )
}

