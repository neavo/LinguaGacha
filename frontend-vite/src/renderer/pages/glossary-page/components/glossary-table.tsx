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
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

import { useI18n } from '@/i18n'
import {
  are_glossary_entry_ids_equal,
  build_glossary_entry_id,
} from '@/pages/glossary-page/components/glossary-selection'
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

const GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT = 37
const EMPTY_SUBSET_PARENT_LABELS: string[] = []

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
  row_index: number
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

type GlossaryTableSpacerRowProps = {
  col_span: number
  height: number
}

type GlossaryTablePlaceholderRowProps = {
  row_index: number
  height: number
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

function resolve_glossary_table_row_zebra(row_index: number): 'odd' | 'even' {
  return Math.abs(row_index) % 2 === 1 ? 'even' : 'odd'
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

function build_glossary_table_placeholder_fill(
  fill_height: number,
  row_height: number,
): {
  placeholder_row_heights: number[]
  residual_spacer_height: number
} {
  const normalized_fill_height = Number.isFinite(fill_height) && fill_height > 0
    ? fill_height
    : 0
  const normalized_row_height = Number.isFinite(row_height) && row_height > 0
    ? row_height
    : 0

  if (normalized_fill_height === 0 || normalized_row_height === 0) {
    return {
      placeholder_row_heights: [],
      residual_spacer_height: normalized_fill_height,
    }
  }

  const placeholder_row_count = Math.floor(
    normalized_fill_height / normalized_row_height,
  )
  const residual_spacer_height = normalized_fill_height
    - (placeholder_row_count * normalized_row_height)

  return {
    placeholder_row_heights: Array.from(
      { length: placeholder_row_count },
      () => normalized_row_height,
    ),
    residual_spacer_height,
  }
}

function are_selection_box_states_equal(
  left_state: SelectionBoxState | null,
  right_state: SelectionBoxState | null,
): boolean {
  if (left_state === right_state) {
    return true
  }

  if (left_state === null || right_state === null) {
    return false
  }

  return (
    left_state.origin_x === right_state.origin_x
    && left_state.origin_y === right_state.origin_y
    && left_state.current_x === right_state.current_x
    && left_state.current_y === right_state.current_y
    && left_state.moved === right_state.moved
  )
}

const GlossarySortableRow = memo(function GlossarySortableRow(
  props: GlossarySortableRowProps,
): JSX.Element {
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
          data-row-index={props.row_index}
          data-zebra={resolve_glossary_table_row_zebra(props.row_index)}
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
}, (previous_props, next_props) => {
  return (
    previous_props.entry === next_props.entry
    && previous_props.entry_id === next_props.entry_id
    && previous_props.row_index === next_props.row_index
    && previous_props.active === next_props.active
    && previous_props.selected === next_props.selected
    && previous_props.matched_count === next_props.matched_count
    && previous_props.subset_parent_labels === next_props.subset_parent_labels
    && previous_props.register_row_element === next_props.register_row_element
    && previous_props.on_open_edit === next_props.on_open_edit
    && previous_props.on_select_entry === next_props.on_select_entry
    && previous_props.on_delete_selected === next_props.on_delete_selected
    && previous_props.on_toggle_case_sensitive === next_props.on_toggle_case_sensitive
    && previous_props.should_ignore_click === next_props.should_ignore_click
  )
})

function GlossaryTableSpacerRow(props: GlossaryTableSpacerRowProps): JSX.Element {
  return (
    <TableRow
      aria-hidden="true"
      className="glossary-page__table-row glossary-page__table-spacer-row"
    >
      <TableCell
        colSpan={props.col_span}
        className="glossary-page__table-spacer-cell"
      >
        <div
          className="glossary-page__table-spacer-fill"
          style={{ height: props.height }}
        />
      </TableCell>
    </TableRow>
  )
}

function GlossaryTablePlaceholderRow(
  props: GlossaryTablePlaceholderRowProps,
): JSX.Element {
  const placeholder_style: CSSProperties = {
    height: props.height,
  }

  return (
    <TableRow
      aria-hidden="true"
      data-row-index={props.row_index}
      data-zebra={resolve_glossary_table_row_zebra(props.row_index)}
      className="glossary-page__table-row glossary-page__table-placeholder-row"
      style={placeholder_style}
    >
      <TableCell className="glossary-page__table-drag-cell glossary-page__table-placeholder-cell">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled
          tabIndex={-1}
          aria-hidden="true"
          className="glossary-page__drag-handle glossary-page__table-placeholder-affordance"
        >
          <GripVertical />
        </Button>
      </TableCell>
      <TableCell className="glossary-page__table-source-cell glossary-page__table-placeholder-cell">
        <span
          className="glossary-page__table-text glossary-page__table-placeholder-content"
          data-ui-text="emphasis"
        >
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell className="glossary-page__table-translation-cell glossary-page__table-placeholder-cell">
        <span className="glossary-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell className="glossary-page__table-description-cell glossary-page__table-placeholder-cell">
        <span className="glossary-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell className="glossary-page__table-rule-cell glossary-page__table-placeholder-cell">
        <span className="glossary-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
      <TableCell className="glossary-page__table-status-cell glossary-page__table-placeholder-cell">
        <span className="glossary-page__table-placeholder-content">
          {'\u00A0'}
        </span>
      </TableCell>
    </TableRow>
  )
}

export function GlossaryTable(props: GlossaryTableProps): JSX.Element {
  const { t } = useI18n()
  const table_scroll_host_ref = useRef<HTMLDivElement | null>(null)
  const table_body_ref = useRef<HTMLTableSectionElement | null>(null)
  const row_elements_ref = useRef(new Map<GlossaryEntryId, HTMLTableRowElement>())
  const selection_box_ref = useRef<SelectionBoxState | null>(null)
  const selection_box_ids_ref = useRef<GlossaryEntryId[]>([])
  const selection_frame_id_ref = useRef<number | null>(null)
  const suppress_click_ref = useRef(false)
  const [viewport_element, set_viewport_element] = useState<HTMLElement | null>(null)
  const [viewport_height, set_viewport_height] = useState(
    GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
  )
  const [measured_row_height, set_measured_row_height] = useState(
    GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
  )
  const [active_drag_entry_id, set_active_drag_entry_id] = useState<GlossaryEntryId | null>(null)
  const [drag_overlay_width, set_drag_overlay_width] = useState<number | null>(null)
  const [selection_box_visual, set_selection_box_visual] = useState<SelectionBoxState | null>(null)
  const latest_entry_ids_ref = useRef<GlossaryEntryId[]>([])
  const latest_on_box_select_ref = useRef(props.on_box_select)
  const latest_on_select_range_ref = useRef(props.on_select_range)
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
  const viewport_fill_height = Math.max(
    0,
    viewport_height - (props.entries.length * measured_row_height),
  )
  const placeholder_fill = build_glossary_table_placeholder_fill(
    viewport_fill_height,
    measured_row_height,
  )
  const show_bottom_spacer = placeholder_fill.residual_spacer_height > 0.5

  useEffect(() => {
    latest_entry_ids_ref.current = entry_ids
  }, [entry_ids])

  useEffect(() => {
    latest_on_box_select_ref.current = props.on_box_select
    latest_on_select_range_ref.current = props.on_select_range
  }, [props.on_box_select, props.on_select_range])

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
  }, [props.entries.length])

  useEffect(() => {
    if (viewport_element === null) {
      set_viewport_height(GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT)
      return
    }

    const update_viewport_height = (): void => {
      set_viewport_height(
        Math.max(
          viewport_element.clientHeight,
          GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
        ),
      )
    }

    update_viewport_height()

    const resize_observer = new ResizeObserver(() => {
      update_viewport_height()
    })
    resize_observer.observe(viewport_element)

    return () => {
      resize_observer.disconnect()
    }
  }, [viewport_element])

  const clear_selection_refs = useCallback((): void => {
    selection_box_ref.current = null
    selection_box_ids_ref.current = []
  }, [])

  const cancel_selection_animation_frame = useCallback((): void => {
    if (selection_frame_id_ref.current === null) {
      return
    }

    window.cancelAnimationFrame(selection_frame_id_ref.current)
    selection_frame_id_ref.current = null
  }, [])

  const flush_selection_box_update = useCallback((): void => {
    cancel_selection_animation_frame()

    const current_state = selection_box_ref.current
    if (current_state === null) {
      return
    }

    set_selection_box_visual((previous_state) => {
      return are_selection_box_states_equal(previous_state, current_state)
        ? previous_state
        : current_state
    })

    if (!current_state.moved) {
      return
    }

    suppress_click_ref.current = true
    const next_entry_ids = latest_entry_ids_ref.current.filter((entry_id) => {
      const row_element = row_elements_ref.current.get(entry_id)
      if (row_element === undefined) {
        return false
      }

      return intersects_selection_box(row_element, current_state)
    })

    if (are_glossary_entry_ids_equal(selection_box_ids_ref.current, next_entry_ids)) {
      return
    }

    selection_box_ids_ref.current = next_entry_ids
    latest_on_box_select_ref.current(next_entry_ids)
  }, [cancel_selection_animation_frame])

  const schedule_selection_box_update = useCallback((): void => {
    if (selection_frame_id_ref.current !== null) {
      return
    }

    selection_frame_id_ref.current = window.requestAnimationFrame(() => {
      selection_frame_id_ref.current = null
      flush_selection_box_update()
    })
  }, [flush_selection_box_update])

  const reset_selection_interaction = useCallback((): void => {
    cancel_selection_animation_frame()
    clear_selection_refs()
    set_selection_box_visual(null)
    window.setTimeout(() => {
      suppress_click_ref.current = false
    }, 0)
  }, [cancel_selection_animation_frame, clear_selection_refs])

  useEffect(() => {
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
      schedule_selection_box_update()
    }

    function finalize_selection_interaction(): void {
      flush_selection_box_update()

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
          latest_on_select_range_ref.current(first_entry_id, last_entry_id)
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
    window.addEventListener('pointerup', handle_pointer_up)
    window.addEventListener('pointercancel', handle_pointer_cancel)
    window.addEventListener('blur', handle_window_blur)

    return () => {
      window.removeEventListener('pointermove', handle_pointer_move)
      window.removeEventListener('pointerup', handle_pointer_up)
      window.removeEventListener('pointercancel', handle_pointer_cancel)
      window.removeEventListener('blur', handle_window_blur)
      cancel_selection_animation_frame()
      clear_selection_refs()
    }
  }, [
    cancel_selection_animation_frame,
    clear_selection_refs,
    flush_selection_box_update,
    reset_selection_interaction,
    schedule_selection_box_update,
  ])

  const register_row_element = useCallback((
    entry_id: GlossaryEntryId,
    row_element: HTMLTableRowElement | null,
  ): void => {
    if (row_element === null) {
      row_elements_ref.current.delete(entry_id)
      return
    }

    row_elements_ref.current.set(entry_id, row_element)
    const next_row_height = Math.round(row_element.getBoundingClientRect().height)
    if (next_row_height > 0 && next_row_height !== measured_row_height) {
      set_measured_row_height(next_row_height)
    }
  }, [measured_row_height])

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

  function handle_drag_cancel(): void {
    set_active_drag_entry_id(null)
    set_drag_overlay_width(null)
  }

  function handle_drag_end(event: DragEndEvent): void {
    set_active_drag_entry_id(null)
    set_drag_overlay_width(null)

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
            <TableBody ref={table_body_ref}>
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
                      row_index={index}
                      active={props.active_entry_id === entry_id}
                      selected={selected_entry_id_set.has(entry_id)}
                      matched_count={props.statistics_state.matched_count_by_entry_id[entry_id] ?? 0}
                      subset_parent_labels={props.statistics_state.subset_parent_labels_by_entry_id[entry_id] ?? EMPTY_SUBSET_PARENT_LABELS}
                      register_row_element={register_row_element}
                      on_open_edit={props.on_open_edit}
                      on_select_entry={props.on_select_entry}
                      on_delete_selected={props.on_delete_selected}
                      on_toggle_case_sensitive={props.on_toggle_case_sensitive}
                      should_ignore_click={should_ignore_click}
                    />
                  )
                })}
                {placeholder_fill.placeholder_row_heights.map(
                  (placeholder_height, placeholder_index) => (
                    <GlossaryTablePlaceholderRow
                      key={`glossary-placeholder-row-${placeholder_index}`}
                      row_index={props.entries.length + placeholder_index}
                      height={placeholder_height}
                    />
                  ),
                )}
                {show_bottom_spacer
                  ? (
                      <GlossaryTableSpacerRow
                        col_span={6}
                        height={placeholder_fill.residual_spacer_height}
                      />
                    )
                  : null}
              </SortableContext>
            </TableBody>
          </Table>
          <DragOverlay>
            {active_drag_entry === null
              ? null
              : (
                  <div className="glossary-page__table-drag-overlay">
                    <Table
                      className="glossary-page__table glossary-page__table--overlay"
                      style={drag_overlay_width === null ? undefined : { width: drag_overlay_width }}
                    >
                      {render_table_colgroup()}
                      <TableBody>
                        <TableRow
                          data-row-index={entry_index_by_id.get(active_drag_entry_id ?? '') ?? 0}
                          data-zebra={resolve_glossary_table_row_zebra(
                            entry_index_by_id.get(active_drag_entry_id ?? '') ?? 0,
                          )}
                          data-state="selected"
                          data-dragging="true"
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
