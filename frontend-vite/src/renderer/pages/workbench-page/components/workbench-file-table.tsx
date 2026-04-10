import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleEllipsis, GripVertical } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { ScrollArea } from '@/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table'
import { useI18n } from '@/i18n'
import { DataTableFrame } from '@/widgets/data-table-frame/data-table-frame'
import {
  WorkbenchTableActionMenu,
  WorkbenchTableContextMenuContent,
} from '@/pages/workbench-page/components/workbench-table-action-menu'
import {
  WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
  WORKBENCH_TABLE_VIRTUAL_OVERSCAN,
  build_workbench_table_placeholder_fill,
  build_workbench_table_spacer_heights,
  resolve_workbench_table_row_zebra,
} from '@/pages/workbench-page/components/workbench-file-table-virtualization'
import type { WorkbenchFileEntry } from '@/pages/workbench-page/types'

type WorkbenchFileTableProps = {
  entries: WorkbenchFileEntry[]
  selected_entry_id: string | null
  project_loaded: boolean
  readonly: boolean
  on_select: (entry_id: string) => void
  on_replace: (entry_id: string) => void
  on_reset: (entry_id: string) => void
  on_delete: (entry_id: string) => void
  on_reorder: (ordered_entry_ids: string[]) => void
}

type WorkbenchSortableHandleProps = {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
}

type WorkbenchFileTableRowCellsProps = {
  entry: WorkbenchFileEntry
  drag_disabled: boolean
  action_disabled: boolean
  sortable_handle: WorkbenchSortableHandleProps | null
  on_prepare_open: () => void
  on_replace: () => void
  on_reset: () => void
  on_delete: () => void
}

type WorkbenchFileTableRowProps = {
  entry: WorkbenchFileEntry
  row_index: number
  is_selected: boolean
  drag_disabled: boolean
  on_measure_row: (row_element: HTMLTableRowElement) => void
  on_select: (entry_id: string) => void
  on_replace: (entry_id: string) => void
  on_reset: (entry_id: string) => void
  on_delete: (entry_id: string) => void
}

type WorkbenchFileTableSpacerRowProps = {
  height: number
}

type WorkbenchFileTableDragOverlayProps = {
  entry: WorkbenchFileEntry
  row_index: number
  width: number | null
}

type WorkbenchFileTablePlaceholderRowProps = {
  row_index: number
  height: number
}

function render_table_colgroup(): JSX.Element {
  return (
    <colgroup>
      <col className="workbench-page__table-col workbench-page__table-col--drag" />
      <col className="workbench-page__table-col workbench-page__table-col--file" />
      <col className="workbench-page__table-col workbench-page__table-col--format" />
      <col className="workbench-page__table-col workbench-page__table-col--line" />
      <col className="workbench-page__table-col workbench-page__table-col--action" />
    </colgroup>
  )
}

function WorkbenchFileTableRowCells(
  props: WorkbenchFileTableRowCellsProps,
): JSX.Element {
  const { t } = useI18n()
  const format_label = props.entry.format_label_key === null
    ? (props.entry.format_fallback_label ?? '-')
    : t(props.entry.format_label_key)

  return (
    <>
      <TableCell className="workbench-page__table-drag-cell">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={props.drag_disabled}
          className="workbench-page__drag-handle"
          aria-label={t('workbench_page.table.drag_handle_aria')}
          onClick={(event) => {
            event.stopPropagation()
          }}
          {...(props.sortable_handle?.attributes ?? {})}
          {...(props.sortable_handle?.listeners ?? {})}
        >
          <GripVertical />
        </Button>
      </TableCell>
      <TableCell className="workbench-page__table-file-cell">
        <span
          className="workbench-page__table-file-text"
          data-ui-text="emphasis"
        >
          {props.entry.rel_path}
        </span>
      </TableCell>
      <TableCell className="workbench-page__table-format-cell">
        {format_label}
      </TableCell>
      <TableCell className="workbench-page__table-line-cell">
        {props.entry.item_count}
      </TableCell>
      <TableCell
        className="workbench-page__table-action-cell"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <WorkbenchTableActionMenu
          disabled={props.action_disabled}
          on_prepare_open={props.on_prepare_open}
          on_replace={props.on_replace}
          on_reset={props.on_reset}
          on_delete={props.on_delete}
        />
      </TableCell>
    </>
  )
}

function WorkbenchFileTableRow(props: WorkbenchFileTableRowProps): JSX.Element {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: props.entry.rel_path,
    disabled: props.drag_disabled,
  })

  const row_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const select_current_entry = (): void => {
    props.on_select(props.entry.rel_path)
  }

  const set_row_element = (row_element: HTMLTableRowElement | null): void => {
    setNodeRef(row_element)
    if (row_element !== null) {
      props.on_measure_row(row_element)
    }
  }

  return (
    <ContextMenu
      onOpenChange={(next_open) => {
        if (next_open) {
          select_current_entry()
        }
      }}
    >
      <ContextMenuTrigger asChild>
        <TableRow
          ref={set_row_element}
          data-index={props.row_index}
          data-row-index={props.row_index}
          data-zebra={resolve_workbench_table_row_zebra(props.row_index)}
          data-dragging={isDragging ? 'true' : undefined}
          data-state={props.is_selected ? 'selected' : undefined}
          className={cn(
            'workbench-page__table-row',
            isDragging ? 'shadow-sm' : undefined,
          )}
          style={row_style}
          onClick={select_current_entry}
          onContextMenu={() => {
            select_current_entry()
          }}
        >
          <WorkbenchFileTableRowCells
            entry={props.entry}
            drag_disabled={props.drag_disabled}
            action_disabled={props.drag_disabled}
            sortable_handle={{ attributes, listeners }}
            on_prepare_open={select_current_entry}
            on_replace={() => props.on_replace(props.entry.rel_path)}
            on_reset={() => props.on_reset(props.entry.rel_path)}
            on_delete={() => props.on_delete(props.entry.rel_path)}
          />
        </TableRow>
      </ContextMenuTrigger>
      <WorkbenchTableContextMenuContent
        disabled={props.drag_disabled}
        on_replace={() => props.on_replace(props.entry.rel_path)}
        on_reset={() => props.on_reset(props.entry.rel_path)}
        on_delete={() => props.on_delete(props.entry.rel_path)}
      />
    </ContextMenu>
  )
}

function WorkbenchFileTableSpacerRow(
  props: WorkbenchFileTableSpacerRowProps,
): JSX.Element {
  return (
    <TableRow
      aria-hidden="true"
      className="workbench-page__table-row workbench-page__table-spacer-row"
    >
      <TableCell
        colSpan={5}
        className="workbench-page__table-spacer-cell"
      >
        <div
          className="workbench-page__table-spacer-fill"
          style={{ height: props.height }}
        />
      </TableCell>
    </TableRow>
  )
}

function WorkbenchFileTablePlaceholderRow(
  props: WorkbenchFileTablePlaceholderRowProps,
): JSX.Element {
  const placeholder_style: CSSProperties = {
    height: props.height,
  }

  return (
    <TableRow
      aria-hidden="true"
      data-row-index={props.row_index}
      data-zebra={resolve_workbench_table_row_zebra(props.row_index)}
      className="workbench-page__table-row workbench-page__table-placeholder-row"
      style={placeholder_style}
    >
      <TableCell
        className="workbench-page__table-drag-cell workbench-page__table-placeholder-cell"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled
          tabIndex={-1}
          aria-hidden="true"
          className="workbench-page__drag-handle workbench-page__table-placeholder-affordance"
        >
          <GripVertical />
        </Button>
      </TableCell>
      <TableCell
        className="workbench-page__table-file-cell workbench-page__table-placeholder-cell"
      >
        <span
          className="workbench-page__table-file-text workbench-page__table-placeholder-content"
          data-ui-text="emphasis"
        >
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell
        className="workbench-page__table-format-cell workbench-page__table-placeholder-cell"
      >
        <span className="workbench-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell
        className="workbench-page__table-line-cell workbench-page__table-placeholder-cell"
      >
        <span className="workbench-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell
        className="workbench-page__table-action-cell workbench-page__table-placeholder-cell"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled
          tabIndex={-1}
          aria-hidden="true"
          className="workbench-page__row-action workbench-page__table-placeholder-affordance"
        >
          <CircleEllipsis />
        </Button>
      </TableCell>
    </TableRow>
  )
}

function WorkbenchFileTableDragOverlay(
  props: WorkbenchFileTableDragOverlayProps,
): JSX.Element {
  return (
    <div
      className="workbench-page__table-drag-overlay"
      style={props.width === null ? undefined : { width: props.width }}
    >
      <Table className="workbench-page__table workbench-page__table--overlay">
        {render_table_colgroup()}
        <TableBody>
          <TableRow
            data-row-index={props.row_index}
            data-zebra={resolve_workbench_table_row_zebra(props.row_index)}
            data-dragging="true"
            className="workbench-page__table-row workbench-page__table-row--overlay shadow-sm"
          >
            <WorkbenchFileTableRowCells
              entry={props.entry}
              drag_disabled
              action_disabled
              sortable_handle={null}
              on_prepare_open={() => {}}
              on_replace={() => {}}
              on_reset={() => {}}
              on_delete={() => {}}
            />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

export function WorkbenchFileTable(props: WorkbenchFileTableProps): JSX.Element {
  const { t } = useI18n()
  const table_scroll_host_ref = useRef<HTMLDivElement | null>(null)
  const table_body_ref = useRef<HTMLTableSectionElement | null>(null)
  const [viewport_element, set_viewport_element] = useState<HTMLElement | null>(
    null,
  )
  const [viewport_height, set_viewport_height] = useState(
    WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
  )
  const [measured_row_height, set_measured_row_height] = useState(
    WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
  )
  const [active_drag_entry_id, set_active_drag_entry_id] = useState<
    string | null
  >(null)
  const [drag_overlay_width, set_drag_overlay_width] = useState<number | null>(
    null,
  )

  const entry_ids = useMemo(() => {
    return props.entries.map((entry) => entry.rel_path)
  }, [props.entries])
  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]))
  }, [entry_ids])
  const active_drag_entry = useMemo(() => {
    if (active_drag_entry_id === null) {
      return null
    }

    const active_entry_index = entry_index_by_id.get(active_drag_entry_id)
    if (active_entry_index === undefined) {
      return null
    }

    return {
      entry: props.entries[active_entry_index] ?? null,
      row_index: active_entry_index,
    }
  }, [active_drag_entry_id, entry_index_by_id, props.entries])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    const table_scroll_host_element = table_scroll_host_ref.current
    if (table_scroll_host_element === null) {
      set_viewport_element(null)
      return
    }

    const next_viewport_element = table_scroll_host_element.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    set_viewport_element(next_viewport_element)
  }, [props.entries.length, props.project_loaded])

  useEffect(() => {
    if (viewport_element === null) {
      set_viewport_height(WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT)
      return
    }

    const update_viewport_height = (): void => {
      set_viewport_height(
        Math.max(
          viewport_element.clientHeight,
          WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
        ),
      )
    }

    update_viewport_height()

    // Why: ScrollArea 的视口高度会随窗口尺寸变化，spacer 高度必须跟着更新，短列表才不会塌陷。
    const resize_observer = new ResizeObserver(() => {
      update_viewport_height()
    })
    resize_observer.observe(viewport_element)

    return () => {
      resize_observer.disconnect()
    }
  }, [viewport_element])

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: props.entries.length,
    getScrollElement: () => viewport_element,
    estimateSize: () => WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
    overscan: WORKBENCH_TABLE_VIRTUAL_OVERSCAN,
    getItemKey: (index) => props.entries[index]?.rel_path ?? index,
    initialRect: {
      width: 0,
      height: Math.max(
        viewport_height,
        WORKBENCH_TABLE_ESTIMATED_ROW_HEIGHT,
      ),
    },
  })

  useEffect(() => {
    virtualizer.measure()
  }, [props.entries.length, viewport_height, virtualizer])

  const virtual_rows = virtualizer.getVirtualItems()
  const first_virtual_row = virtual_rows[0] ?? null
  const last_virtual_row = virtual_rows.at(-1) ?? null
  const spacer_heights = build_workbench_table_spacer_heights({
    viewport_height,
    total_size: virtualizer.getTotalSize(),
    range_start: first_virtual_row?.start ?? 0,
    range_end: last_virtual_row?.end ?? 0,
  })
  const placeholder_fill = build_workbench_table_placeholder_fill(
    spacer_heights.viewport_fill_height,
    measured_row_height,
  )

  const measure_virtual_row = (row_element: HTMLTableRowElement): void => {
    virtualizer.measureElement(row_element)

    const next_row_height = Math.round(row_element.getBoundingClientRect().height)
    if (next_row_height > 0 && next_row_height !== measured_row_height) {
      set_measured_row_height(next_row_height)
    }
  }
  const show_top_spacer = spacer_heights.top_spacer_height > 0.5
  const bottom_spacer_height = spacer_heights.virtual_bottom_spacer_height
    + placeholder_fill.residual_spacer_height
  const show_bottom_spacer = bottom_spacer_height > 0.5

  const sync_drag_overlay_width = (): void => {
    const table_body_element = table_body_ref.current
    if (table_body_element === null) {
      set_drag_overlay_width(null)
      return
    }

    const table_container_element = table_body_element.closest(
      '[data-slot="table-container"]',
    )
    if (table_container_element instanceof HTMLElement) {
      set_drag_overlay_width(table_container_element.getBoundingClientRect().width)
      return
    }

    set_drag_overlay_width(null)
  }

  const reset_drag_state = (): void => {
    set_active_drag_entry_id(null)
    set_drag_overlay_width(null)
  }

  function handle_drag_start(event: DragStartEvent): void {
    const active_entry_id = String(event.active.id)
    if (!entry_index_by_id.has(active_entry_id)) {
      reset_drag_state()
      return
    }

    set_active_drag_entry_id(active_entry_id)
    sync_drag_overlay_width()
  }

  function handle_drag_cancel(): void {
    reset_drag_state()
  }

  function handle_drag_end(event: DragEndEvent): void {
    const { active, over } = event
    reset_drag_state()

    if (over === null || active.id === over.id) {
      return
    }

    const previous_index = entry_index_by_id.get(String(active.id))
    const next_index = entry_index_by_id.get(String(over.id))
    if (previous_index === undefined || next_index === undefined) {
      return
    }

    const next_entries = arrayMove(props.entries, previous_index, next_index)
    props.on_reorder(next_entries.map((entry) => entry.rel_path))
  }

  const resolved_header = (
    <div className="workbench-page__table-head-wrap">
      <Table className="workbench-page__table">
        {render_table_colgroup()}
        <TableHeader className="workbench-page__table-head">
          <TableRow>
            <TableHead className="workbench-page__table-drag-head">
              {t('workbench_page.table.drag_handle')}
            </TableHead>
            <TableHead className="workbench-page__table-file-head">
              {t('workbench_page.table.file_name')}
            </TableHead>
            <TableHead className="workbench-page__table-format-head">
              {t('workbench_page.table.format')}
            </TableHead>
            <TableHead className="workbench-page__table-line-head">
              {t('workbench_page.table.line_count')}
            </TableHead>
            <TableHead className="workbench-page__table-action-head">
              {t('workbench_page.table.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    </div>
  )

  const resolved_body = (
    <div
      ref={table_scroll_host_ref}
      className="workbench-page__table-scroll-host"
    >
      <ScrollArea className="workbench-page__table-scroll">
        <DndContext
          collisionDetection={closestCenter}
          sensors={sensors}
          onDragStart={handle_drag_start}
          onDragCancel={handle_drag_cancel}
          onDragEnd={handle_drag_end}
        >
          <Table className="workbench-page__table workbench-page__table--body">
            {render_table_colgroup()}
            <TableBody ref={table_body_ref}>
              <SortableContext
                items={entry_ids}
                strategy={verticalListSortingStrategy}
              >
                {show_top_spacer
                  ? (
                      <WorkbenchFileTableSpacerRow
                        height={spacer_heights.top_spacer_height}
                      />
                    )
                  : null}
                {virtual_rows.map((virtual_row) => {
                  const entry = props.entries[virtual_row.index]
                  if (entry === undefined) {
                    return null
                  }

                  return (
                    <WorkbenchFileTableRow
                      key={entry.rel_path}
                      entry={entry}
                      row_index={virtual_row.index}
                      is_selected={entry.rel_path === props.selected_entry_id}
                      drag_disabled={props.readonly}
                      on_measure_row={measure_virtual_row}
                      on_select={props.on_select}
                      on_replace={props.on_replace}
                      on_reset={props.on_reset}
                      on_delete={props.on_delete}
                    />
                  )
                })}
                {placeholder_fill.placeholder_row_heights.map(
                  (placeholder_height, placeholder_index) => (
                    <WorkbenchFileTablePlaceholderRow
                      key={`placeholder-row-${placeholder_index}`}
                      row_index={props.entries.length + placeholder_index}
                      height={placeholder_height}
                    />
                  ),
                )}
                {show_bottom_spacer
                  ? (
                      <WorkbenchFileTableSpacerRow
                        height={bottom_spacer_height}
                      />
                    )
                  : null}
              </SortableContext>
            </TableBody>
          </Table>
          <DragOverlay>
            {active_drag_entry?.entry === null || active_drag_entry === null
              ? null
              : (
                  <WorkbenchFileTableDragOverlay
                    entry={active_drag_entry.entry}
                    row_index={active_drag_entry.row_index}
                    width={drag_overlay_width}
                  />
                )}
          </DragOverlay>
        </DndContext>
      </ScrollArea>
    </div>
  )

  return (
    <DataTableFrame
      title={t('workbench_page.section.file_list')}
      description={t('workbench_page.empty.description')}
      className="workbench-page__table-card"
      content_class_name="workbench-page__table-card-content"
      empty_state={null}
      header={resolved_header}
      body={resolved_body}
    />
  )
}
