import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
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
import { Files, GripVertical, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
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
import { WorkbenchTableActionMenu, WorkbenchTableContextMenuContent } from '@/pages/workbench-page/components/workbench-table-action-menu'
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

type WorkbenchFileTableRowProps = {
  entry: WorkbenchFileEntry
  is_selected: boolean
  drag_disabled: boolean
  on_select: (entry_id: string) => void
  on_replace: (entry_id: string) => void
  on_reset: (entry_id: string) => void
  on_delete: (entry_id: string) => void
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

function WorkbenchFileTableRow(props: WorkbenchFileTableRowProps): JSX.Element {
  const { t } = useI18n()
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
  const format_label = props.entry.format_label_key === null
    ? (props.entry.format_fallback_label ?? '-')
    : t(props.entry.format_label_key)
  const select_current_entry = (): void => {
    props.on_select(props.entry.rel_path)
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
        <tr
          ref={setNodeRef}
          data-slot="table-row"
          data-dragging={isDragging ? 'true' : undefined}
          data-state={props.is_selected ? 'selected' : undefined}
          className={cn(
            'workbench-page__table-row border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
            isDragging ? 'shadow-sm' : undefined,
          )}
          style={row_style}
          onClick={select_current_entry}
          onContextMenu={() => {
            select_current_entry()
          }}
        >
          <TableCell className="workbench-page__table-drag-cell">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={props.drag_disabled}
              className="workbench-page__drag-handle"
              aria-label={t('task.page.workbench.table.drag_handle_aria')}
              onClick={(event) => {
                event.stopPropagation()
              }}
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </Button>
          </TableCell>
          <TableCell className="workbench-page__table-file-cell">
            <span className="workbench-page__table-file-text" data-ui-text="emphasis">{props.entry.rel_path}</span>
          </TableCell>
          <TableCell className="workbench-page__table-format-cell">{format_label}</TableCell>
          <TableCell className="workbench-page__table-line-cell">{props.entry.item_count}</TableCell>
          <TableCell
            className="workbench-page__table-action-cell"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <WorkbenchTableActionMenu
              disabled={props.drag_disabled}
              on_prepare_open={select_current_entry}
              on_replace={() => props.on_replace(props.entry.rel_path)}
              on_reset={() => props.on_reset(props.entry.rel_path)}
              on_delete={() => props.on_delete(props.entry.rel_path)}
            />
          </TableCell>
        </tr>
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

export function WorkbenchFileTable(props: WorkbenchFileTableProps): JSX.Element {
  const { t } = useI18n()
  const table_body_ref = useRef<HTMLTableSectionElement | null>(null)
  const [placeholder_row_count, set_placeholder_row_count] = useState(0)
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
    const table_body_element = table_body_ref.current
    if (table_body_element === null) {
      return
    }
    const current_table_body_element: HTMLTableSectionElement = table_body_element
    const viewport_element = current_table_body_element.closest('[data-slot="scroll-area-viewport"]')
    if (!(viewport_element instanceof HTMLElement)) {
      return
    }
    const current_viewport_element: HTMLElement = viewport_element

    function update_placeholder_rows(): void {
      const table_row_elements = Array.from(current_table_body_element.querySelectorAll<HTMLTableRowElement>('.workbench-page__table-row:not(.workbench-page__table-placeholder-row)'))
      if (table_row_elements.length === 0) {
        set_placeholder_row_count(0)
        return
      }

      let row_stride = 0
      if (table_row_elements.length >= 2) {
        row_stride = table_row_elements[1].offsetTop - table_row_elements[0].offsetTop
      }

      if (row_stride <= 0) {
        const first_row_style = window.getComputedStyle(table_row_elements[0])
        const first_row_border_bottom_width = Number.parseFloat(first_row_style.borderBottomWidth) || 0
        row_stride = Math.round(table_row_elements[0].getBoundingClientRect().height + first_row_border_bottom_width)
      }

      if (row_stride <= 0) {
        set_placeholder_row_count(0)
      } else {
        const visible_row_capacity = Math.max(1, Math.ceil(current_viewport_element.clientHeight / row_stride))
        set_placeholder_row_count(Math.max(0, visible_row_capacity - props.entries.length))
      }
    }

    // Why: 直接补真实占位行，才能让空白区的斑马纹、分隔线和滚动节奏始终与真实表格一致。
    update_placeholder_rows()

    const resize_observer = new ResizeObserver(() => {
      update_placeholder_rows()
    })
    resize_observer.observe(current_viewport_element)
    resize_observer.observe(current_table_body_element)

    return () => {
      resize_observer.disconnect()
    }
  }, [props.entries.length])

  function handle_drag_end(event: DragEndEvent): void {
    const { active, over } = event
    if (over === null || active.id === over.id) {
      return
    }

    const previous_index = props.entries.findIndex((entry) => entry.rel_path === active.id)
    const next_index = props.entries.findIndex((entry) => entry.rel_path === over.id)
    if (previous_index < 0 || next_index < 0) {
      return
    }

    const next_entries = arrayMove(props.entries, previous_index, next_index)
    props.on_reorder(next_entries.map((entry) => entry.rel_path))
  }
  return (
    <Card variant="table" className="workbench-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t('task.page.workbench.section.file_list')}</CardTitle>
        <CardDescription>{t('task.page.workbench.empty.description')}</CardDescription>
      </CardHeader>
      <CardContent className="workbench-page__table-card-content">
        {!props.project_loaded ? (
          <div className="workbench-page__empty-wrap">
            <Empty variant="inset" className="workbench-page__empty-state">
              <EmptyHeader>
                <EmptyMedia>
                  <ShieldAlert />
                </EmptyMedia>
                <EmptyTitle>{t('task.page.workbench.empty.title')}</EmptyTitle>
                <EmptyDescription>{t('task.page.workbench.empty.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : props.entries.length === 0 ? (
          <div className="workbench-page__empty-wrap">
            <Empty variant="inset" className="workbench-page__empty-state">
              <EmptyHeader>
                <EmptyMedia>
                  <Files />
                </EmptyMedia>
                <EmptyTitle>{t('task.page.workbench.empty.loaded_title')}</EmptyTitle>
                <EmptyDescription>{t('task.page.workbench.empty.loaded_description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="workbench-page__table-shell">
            <div className="workbench-page__table-head-wrap">
              <Table className="workbench-page__table">
                {render_table_colgroup()}
                <TableHeader className="workbench-page__table-head">
                  <TableRow>
                    <TableHead className="workbench-page__table-drag-head">
                      {t('task.page.workbench.table.drag_handle')}
                    </TableHead>
                    <TableHead className="workbench-page__table-file-head">
                      {t('task.page.workbench.table.file_name')}
                    </TableHead>
                    <TableHead className="workbench-page__table-format-head">
                      {t('task.page.workbench.table.format')}
                    </TableHead>
                    <TableHead className="workbench-page__table-line-head">
                      {t('task.page.workbench.table.line_count')}
                    </TableHead>
                    <TableHead className="workbench-page__table-action-head">
                      {t('task.page.workbench.table.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
              </Table>
            </div>
            <ScrollArea className="workbench-page__table-scroll">
              <DndContext
                collisionDetection={closestCenter}
                sensors={sensors}
                onDragEnd={handle_drag_end}
              >
                <Table className="workbench-page__table workbench-page__table--body">
                  {render_table_colgroup()}
                  <TableBody ref={table_body_ref}>
                    <SortableContext
                      items={props.entries.map((entry) => entry.rel_path)}
                      strategy={verticalListSortingStrategy}
                    >
                      {props.entries.map((entry) => (
                        <WorkbenchFileTableRow
                          key={entry.rel_path}
                          entry={entry}
                          is_selected={entry.rel_path === props.selected_entry_id}
                          drag_disabled={props.readonly}
                          on_select={props.on_select}
                          on_replace={props.on_replace}
                          on_reset={props.on_reset}
                          on_delete={props.on_delete}
                        />
                      ))}
                      {Array.from({ length: placeholder_row_count }, (_, index) => (
                        <TableRow
                          key={`placeholder-row-${index}`}
                          aria-hidden="true"
                          className="workbench-page__table-row workbench-page__table-placeholder-row"
                        >
                          <TableCell className="workbench-page__table-drag-cell workbench-page__table-placeholder-cell" />
                          <TableCell className="workbench-page__table-file-cell workbench-page__table-placeholder-cell" />
                          <TableCell className="workbench-page__table-format-cell workbench-page__table-placeholder-cell" />
                          <TableCell className="workbench-page__table-line-cell workbench-page__table-placeholder-cell" />
                          <TableCell className="workbench-page__table-action-cell workbench-page__table-placeholder-cell" />
                        </TableRow>
                      ))}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
