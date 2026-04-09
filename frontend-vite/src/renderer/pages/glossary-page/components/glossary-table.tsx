import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Files, GripVertical } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

import { useI18n } from '@/i18n'
import { build_glossary_entry_id } from '@/pages/glossary-page/components/glossary-selection'
import { GlossaryContextMenuContent } from '@/pages/glossary-page/components/glossary-context-menu'
import type {
  GlossaryEntry,
  GlossaryEntryId,
  GlossaryStatisticsState,
} from '@/pages/glossary-page/types'
import { Button } from '@/ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { ScrollArea } from '@/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table'
import { DataTableFrame } from '@/widgets/data-table-frame/data-table-frame'

type GlossaryTableProps = {
  entries: GlossaryEntry[]
  selected_entry_ids: GlossaryEntryId[]
  active_entry_id: GlossaryEntryId | null
  statistics_state: GlossaryStatisticsState
  on_select_entry: (
    entry_id: GlossaryEntryId,
    options: { extend: boolean; range: boolean },
  ) => void
  on_select_range: (
    anchor_entry_id: GlossaryEntryId,
    target_entry_id: GlossaryEntryId,
  ) => void
  on_box_select: (next_entry_ids: GlossaryEntryId[]) => void
  on_open_edit: (entry_id: GlossaryEntryId) => void
  on_delete_selected: () => Promise<void>
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  on_reorder: (
    active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ) => Promise<void>
}

type SelectionBoxState = {
  origin_x: number
  origin_y: number
  current_x: number
  current_y: number
  moved: boolean
}

type GlossarySortableRowProps = {
  entry: GlossaryEntry
  entry_id: GlossaryEntryId
  active: boolean
  selected: boolean
  matched_count: number
  subset_parent_labels: string[]
  register_row_element: (
    entry_id: GlossaryEntryId,
    row_element: HTMLTableRowElement | null,
  ) => void
  on_open_edit: (entry_id: GlossaryEntryId) => void
  on_select_entry: (
    entry_id: GlossaryEntryId,
    options: { extend: boolean; range: boolean },
  ) => void
  on_delete_selected: () => Promise<void>
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  should_ignore_click: () => boolean
}

function render_table_colgroup(): JSX.Element {
  return (
    <colgroup>
      <col className="glossary-page__table-col glossary-page__table-col--drag" />
      <col className="glossary-page__table-col glossary-page__table-col--source" />
      <col className="glossary-page__table-col glossary-page__table-col--translation" />
      <col className="glossary-page__table-col glossary-page__table-col--description" />
      <col className="glossary-page__table-col glossary-page__table-col--rule" />
      <col className="glossary-page__table-col glossary-page__table-col--status" />
    </colgroup>
  )
}

function normalize_selection_box_style(
  host_element: HTMLDivElement | null,
  selection_box: SelectionBoxState | null,
): CSSProperties | undefined {
  if (host_element === null || selection_box === null || !selection_box.moved) {
    return undefined
  }

  const host_rect = host_element.getBoundingClientRect()
  const start_x = selection_box.origin_x - host_rect.left
  const start_y = selection_box.origin_y - host_rect.top
  const end_x = selection_box.current_x - host_rect.left
  const end_y = selection_box.current_y - host_rect.top

  return {
    left: Math.min(start_x, end_x),
    top: Math.min(start_y, end_y),
    width: Math.abs(end_x - start_x),
    height: Math.abs(end_y - start_y),
  }
}

function build_selection_box_rect(
  selection_box: SelectionBoxState,
): DOMRect {
  return new DOMRect(
    Math.min(selection_box.origin_x, selection_box.current_x),
    Math.min(selection_box.origin_y, selection_box.current_y),
    Math.abs(selection_box.current_x - selection_box.origin_x),
    Math.abs(selection_box.current_y - selection_box.origin_y),
  )
}

function intersects_selection_box(
  row_element: HTMLTableRowElement,
  selection_box: SelectionBoxState,
): boolean {
  const row_rect = row_element.getBoundingClientRect()
  const selection_rect = build_selection_box_rect(selection_box)

  return !(
    selection_rect.right < row_rect.left
    || selection_rect.left > row_rect.right
    || selection_rect.bottom < row_rect.top
    || selection_rect.top > row_rect.bottom
  )
}

function GlossarySortableRow(props: GlossarySortableRowProps): JSX.Element {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: props.entry_id,
  })

  const row_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const statistics_tooltip = props.subset_parent_labels.length === 0
    ? undefined
    : props.subset_parent_labels.join('\n')

  const set_row_element = (row_element: HTMLTableRowElement | null): void => {
    setNodeRef(row_element)
    props.register_row_element(props.entry_id, row_element)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={set_row_element}
          data-active={props.active ? 'true' : undefined}
          data-state={props.selected ? 'selected' : undefined}
          data-dragging={isDragging ? 'true' : undefined}
          className="glossary-page__table-row"
          style={row_style}
          onClick={(event) => {
            if (props.should_ignore_click()) {
              event.preventDefault()
              return
            }

            props.on_select_entry(props.entry_id, {
              extend: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            })
          }}
          onContextMenu={() => {
            props.on_select_entry(props.entry_id, {
              extend: false,
              range: false,
            })
          }}
          onDoubleClick={() => {
            if (!props.should_ignore_click()) {
              props.on_open_edit(props.entry_id)
            }
          }}
        >
          <TableCell className="glossary-page__table-drag-cell">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="glossary-page__drag-handle"
              data-glossary-ignore-box-select="true"
              onClick={(event) => {
                event.stopPropagation()
              }}
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </Button>
          </TableCell>
          <TableCell className="glossary-page__table-source-cell">
            <span className="glossary-page__table-text" data-ui-text="emphasis">
              {props.entry.src}
            </span>
          </TableCell>
          <TableCell className="glossary-page__table-translation-cell">
            <span className="glossary-page__table-text">
              {props.entry.dst}
            </span>
          </TableCell>
          <TableCell className="glossary-page__table-description-cell">
            <span className="glossary-page__table-text" title={props.entry.info}>
              {props.entry.info}
            </span>
          </TableCell>
          <TableCell className="glossary-page__table-rule-cell">
            {props.entry.case_sensitive ? 'Aa' : ''}
          </TableCell>
          <TableCell
            className="glossary-page__table-status-cell"
            title={statistics_tooltip}
          >
            {props.matched_count > 0 ? String(props.matched_count) : ''}
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <GlossaryContextMenuContent
        on_open_edit={() => {
          props.on_open_edit(props.entry_id)
        }}
        on_delete_selected={props.on_delete_selected}
        on_toggle_case_sensitive={props.on_toggle_case_sensitive}
      />
    </ContextMenu>
  )
}

export function GlossaryTable(props: GlossaryTableProps): JSX.Element {
  const { t } = useI18n()
  const table_scroll_host_ref = useRef<HTMLDivElement | null>(null)
  const row_elements_ref = useRef(new Map<GlossaryEntryId, HTMLTableRowElement>())
  const selection_box_ref = useRef<SelectionBoxState | null>(null)
  const selection_box_ids_ref = useRef<GlossaryEntryId[]>([])
  const suppress_click_ref = useRef(false)
  const [active_drag_entry_id, set_active_drag_entry_id] = useState<GlossaryEntryId | null>(null)
  const [selection_box_visual, set_selection_box_visual] = useState<SelectionBoxState | null>(null)
  const selected_entry_id_set = useMemo(() => {
    return new Set(props.selected_entry_ids)
  }, [props.selected_entry_ids])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  )
  const entry_ids = useMemo<GlossaryEntryId[]>(() => {
    return props.entries.map((entry, index) => {
      return build_glossary_entry_id(entry, index)
    })
  }, [props.entries])
  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]))
  }, [entry_ids])
  const active_drag_entry = active_drag_entry_id === null
    ? null
    : props.entries[entry_index_by_id.get(active_drag_entry_id) ?? -1] ?? null
  const selection_box_style = normalize_selection_box_style(
    table_scroll_host_ref.current,
    selection_box_visual,
  )

  const clear_selection_refs = useCallback((): void => {
    selection_box_ref.current = null
    selection_box_ids_ref.current = []
  }, [])

  const reset_selection_interaction = useCallback((): void => {
    clear_selection_refs()
    set_selection_box_visual(null)
    window.setTimeout(() => {
      suppress_click_ref.current = false
    }, 0)
  }, [clear_selection_refs])

  useEffect(() => {
    if (selection_box_visual === null) {
      return
    }

    function handle_pointer_move(event: PointerEvent): void {
      const previous_state = selection_box_ref.current
      if (previous_state === null) {
        return
      }

      const moved = previous_state.moved
        || Math.abs(event.clientX - previous_state.origin_x) > 4
        || Math.abs(event.clientY - previous_state.origin_y) > 4
      const next_state: SelectionBoxState = {
        ...previous_state,
        current_x: event.clientX,
        current_y: event.clientY,
        moved,
      }

      selection_box_ref.current = next_state
      set_selection_box_visual(next_state)

      if (!moved) {
        return
      }

      suppress_click_ref.current = true
      const next_entry_ids = entry_ids.filter((entry_id) => {
        const row_element = row_elements_ref.current.get(entry_id)
        if (row_element === undefined) {
          return false
        }

        return intersects_selection_box(row_element, next_state)
      })
      selection_box_ids_ref.current = next_entry_ids
      props.on_box_select(next_entry_ids)
    }

    function finalize_selection_interaction(): void {
      const current_state = selection_box_ref.current
      const next_entry_ids = selection_box_ids_ref.current

      if (
        current_state !== null
        && current_state.moved
        && next_entry_ids.length > 0
      ) {
        const first_entry_id = next_entry_ids[0]
        const last_entry_id = next_entry_ids.at(-1)
        if (first_entry_id !== undefined && last_entry_id !== undefined) {
          props.on_select_range(first_entry_id, last_entry_id)
        }
      }
      reset_selection_interaction()
    }

    function handle_pointer_up(): void {
      finalize_selection_interaction()
    }

    function handle_pointer_cancel(): void {
      reset_selection_interaction()
    }

    function handle_window_blur(): void {
      reset_selection_interaction()
    }

    window.addEventListener('pointermove', handle_pointer_move)
    window.addEventListener('pointerup', handle_pointer_up, { once: true })
    window.addEventListener('pointercancel', handle_pointer_cancel, { once: true })
    window.addEventListener('blur', handle_window_blur, { once: true })

    return () => {
      window.removeEventListener('pointermove', handle_pointer_move)
      window.removeEventListener('pointerup', handle_pointer_up)
      window.removeEventListener('pointercancel', handle_pointer_cancel)
      window.removeEventListener('blur', handle_window_blur)
      clear_selection_refs()
    }
  }, [clear_selection_refs, entry_ids, props, reset_selection_interaction, selection_box_visual])

  const register_row_element = useCallback((
    entry_id: GlossaryEntryId,
    row_element: HTMLTableRowElement | null,
  ): void => {
    if (row_element === null) {
      row_elements_ref.current.delete(entry_id)
      return
    }

    row_elements_ref.current.set(entry_id, row_element)
  }, [])

  const should_ignore_click = useCallback((): boolean => {
    return suppress_click_ref.current
  }, [])

  const handle_box_selection_start = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) {
      return
    }

    if (!(event.target instanceof HTMLElement)) {
      return
    }

    if (event.target.closest('[data-glossary-ignore-box-select="true"]') !== null) {
      return
    }

    const next_state: SelectionBoxState = {
      origin_x: event.clientX,
      origin_y: event.clientY,
      current_x: event.clientX,
      current_y: event.clientY,
      moved: false,
    }

    selection_box_ref.current = next_state
    selection_box_ids_ref.current = []
    set_selection_box_visual(next_state)
  }, [])

  function handle_drag_start(event: DragStartEvent): void {
    set_active_drag_entry_id(String(event.active.id))
  }

  function handle_drag_cancel(): void {
    set_active_drag_entry_id(null)
  }

  function handle_drag_end(event: DragEndEvent): void {
    set_active_drag_entry_id(null)

    if (event.over === null || event.active.id === event.over.id) {
      return
    }

    void props.on_reorder(String(event.active.id), String(event.over.id))
  }

  const empty_state = props.entries.length === 0
    ? (
        <div className="glossary-page__empty-wrap">
          <Empty variant="inset" className="glossary-page__empty-state">
            <EmptyHeader>
              <EmptyMedia>
                <Files />
              </EmptyMedia>
              <EmptyTitle>{t('glossary_page.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('glossary_page.empty.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )
    : null

  const header = (
    <div className="glossary-page__table-head-wrap">
      <Table className="glossary-page__table">
        {render_table_colgroup()}
        <TableHeader className="glossary-page__table-head">
          <TableRow>
            <TableHead className="glossary-page__table-drag-head" />
            <TableHead className="glossary-page__table-source-head">
              {t('glossary_page.fields.source')}
            </TableHead>
            <TableHead className="glossary-page__table-translation-head">
              {t('glossary_page.fields.translation')}
            </TableHead>
            <TableHead className="glossary-page__table-description-head">
              {t('glossary_page.fields.description')}
            </TableHead>
            <TableHead className="glossary-page__table-rule-head">
              {t('glossary_page.fields.rule')}
            </TableHead>
            <TableHead className="glossary-page__table-status-head">
              {t('glossary_page.fields.status')}
            </TableHead>
          </TableRow>
        </TableHeader>
      </Table>
    </div>
  )

  const body = (
    <div
      ref={table_scroll_host_ref}
      className="glossary-page__table-scroll-host"
      onPointerDownCapture={handle_box_selection_start}
    >
      <ScrollArea className="glossary-page__table-scroll">
        <DndContext
          collisionDetection={closestCenter}
          sensors={sensors}
          onDragStart={handle_drag_start}
          onDragCancel={handle_drag_cancel}
          onDragEnd={handle_drag_end}
        >
          <Table className="glossary-page__table glossary-page__table--body">
            {render_table_colgroup()}
            <TableBody>
              <SortableContext
                items={entry_ids}
                strategy={verticalListSortingStrategy}
              >
                {props.entries.map((entry, index) => {
                  const entry_id = entry_ids[index] ?? `${index.toString()}`

                  return (
                    <GlossarySortableRow
                      key={entry_id}
                      entry={entry}
                      entry_id={entry_id}
                      active={props.active_entry_id === entry_id}
                      selected={selected_entry_id_set.has(entry_id)}
                      matched_count={props.statistics_state.matched_count_by_entry_id[entry_id] ?? 0}
                      subset_parent_labels={props.statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? []}
                      register_row_element={register_row_element}
                      on_open_edit={props.on_open_edit}
                      on_select_entry={props.on_select_entry}
                      on_delete_selected={props.on_delete_selected}
                      on_toggle_case_sensitive={props.on_toggle_case_sensitive}
                      should_ignore_click={should_ignore_click}
                    />
                  )
                })}
              </SortableContext>
            </TableBody>
          </Table>
          <DragOverlay>
            {active_drag_entry === null
              ? null
              : (
                  <div className="glossary-page__table-drag-overlay">
                    <Table className="glossary-page__table glossary-page__table--overlay">
                      {render_table_colgroup()}
                      <TableBody>
                        <TableRow
                          data-state="selected"
                          className="glossary-page__table-row"
                        >
                          <TableCell className="glossary-page__table-drag-cell">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="glossary-page__drag-handle"
                              disabled
                            >
                              <GripVertical />
                            </Button>
                          </TableCell>
                          <TableCell className="glossary-page__table-source-cell">
                            <span className="glossary-page__table-text" data-ui-text="emphasis">
                              {active_drag_entry.src}
                            </span>
                          </TableCell>
                          <TableCell className="glossary-page__table-translation-cell">
                            <span className="glossary-page__table-text">
                              {active_drag_entry.dst}
                            </span>
                          </TableCell>
                          <TableCell className="glossary-page__table-description-cell">
                            <span className="glossary-page__table-text">
                              {active_drag_entry.info}
                            </span>
                          </TableCell>
                          <TableCell className="glossary-page__table-rule-cell">
                            {active_drag_entry.case_sensitive ? 'Aa' : ''}
                          </TableCell>
                          <TableCell className="glossary-page__table-status-cell" />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
          </DragOverlay>
        </DndContext>
      </ScrollArea>
      {selection_box_style === undefined
        ? null
        : (
            <div
              className="glossary-page__selection-box"
              style={selection_box_style}
            />
          )}
    </div>
  )

  return (
    <DataTableFrame
      title={t('glossary_page.title')}
      description={t('glossary_page.summary')}
      className="glossary-page__table-card"
      content_class_name="glossary-page__table-card-content"
      empty_state={empty_state}
      header={header}
      body={body}
    />
  )
}
