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
import { useVirtualizer } from '@tanstack/react-virtual'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ArrowUpDown, CaseSensitive, GripVertical } from 'lucide-react'
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
} from '@/pages/glossary-page/components/glossary-selection'
import {
  GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
  GLOSSARY_TABLE_VIRTUAL_OVERSCAN,
  build_glossary_table_placeholder_fill,
  build_glossary_table_spacer_heights,
  resolve_glossary_table_row_zebra,
} from '@/pages/glossary-page/components/glossary-table-virtualization'
import { GlossaryContextMenuContent } from '@/pages/glossary-page/components/glossary-context-menu'
import type {
  GlossaryEntry,
  GlossaryEntryId,
  GlossarySortField,
  GlossarySortState,
  GlossaryStatisticsBadgeState,
  GlossaryVisibleEntry,
} from '@/pages/glossary-page/types'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { ScrollArea } from '@/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/utils'
import { DataTableFrame } from '@/widgets/data-table-frame/data-table-frame'

type GlossaryTableProps = {
  entries: GlossaryVisibleEntry[]
  total_count: number
  sort_state: GlossarySortState
  drag_disabled: boolean
  statistics_running: boolean
  statistics_ready: boolean
  selected_entry_ids: GlossaryEntryId[]
  active_entry_id: GlossaryEntryId | null
  statistics_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState>
  on_cycle_column_sort: (field: GlossarySortField) => void
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
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  on_reorder: (
    active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ) => Promise<void>
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void
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
  drag_disabled: boolean
  statistics_running: boolean
  statistics_badge_state: GlossaryStatisticsBadgeState | null
  register_row_element: (
    entry_id: GlossaryEntryId,
    row_element: HTMLTableRowElement | null,
  ) => void
  on_open_edit: (entry_id: GlossaryEntryId) => void
  on_select_entry: (
    entry_id: GlossaryEntryId,
    options: { extend: boolean; range: boolean },
  ) => void
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  should_ignore_click: () => boolean
  on_measure_row: (row_element: HTMLTableRowElement) => void
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void
}

type GlossaryTableSpacerRowProps = {
  col_span: number
  height: number
}

type GlossaryTablePlaceholderRowProps = {
  row_index: number
  height: number
}

function build_glossary_row_number_label(row_index: number): string {
  return String(row_index + 1)
}

function resolve_glossary_sort_direction(
  sort_state: GlossarySortState,
  field: GlossarySortField,
): 'ascending' | 'descending' | null {
  return sort_state.field === field
    ? sort_state.direction
    : null
}

function build_glossary_sort_action_label(
  t: ReturnType<typeof useI18n>['t'],
  direction: 'ascending' | 'descending' | null,
  disabled: boolean,
): string | null {
  if (disabled) {
    return null
  }

  if (direction === null) {
    return t('glossary_page.sort.ascending')
  }

  if (direction === 'ascending') {
    return t('glossary_page.sort.descending')
  }

  return t('glossary_page.sort.clear')
}

type GlossarySortTriggerProps = {
  label: string
  field: GlossarySortField
  sort_state: GlossarySortState
  disabled?: boolean
  on_cycle: (field: GlossarySortField) => void
}

function GlossarySortTrigger(props: GlossarySortTriggerProps): JSX.Element {
  const { t } = useI18n()
  const direction = resolve_glossary_sort_direction(props.sort_state, props.field)
  const Icon = direction === 'ascending'
    ? ArrowUp
    : direction === 'descending'
      ? ArrowDown
      : ArrowUpDown
  const action_label = build_glossary_sort_action_label(
    t,
    direction,
    props.disabled ?? false,
  )
  const aria_label = action_label === null
    ? props.label
    : `${props.label} ${action_label}`

  const trigger = (
    <span className="inline-flex">
      <Button
        type="button"
        variant={direction === null ? 'ghost' : 'secondary'}
        size="icon-xs"
        disabled={props.disabled}
        data-direction={direction ?? undefined}
        data-active={direction === null ? undefined : 'true'}
        className="glossary-page__column-sort-trigger"
        aria-label={aria_label}
        onClick={() => {
          props.on_cycle(props.field)
        }}
      >
        <Icon aria-hidden="true" />
      </Button>
    </span>
  )

  return action_label === null
    ? trigger
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
}

function render_table_head_content(options: {
  label: string
  menu: JSX.Element | null
  class_name: string
  compact?: boolean
}): JSX.Element {
  return (
    <TableHead className={options.class_name}>
      <div
        className="glossary-page__table-head-content"
        data-compact={options.compact ? 'true' : undefined}
      >
        <span className="glossary-page__table-head-label">
          {options.label}
        </span>
        {options.menu === null
          ? null
          : (
              <span className="glossary-page__table-head-action">
                {options.menu}
              </span>
            )}
      </div>
    </TableHead>
  )
}

function render_table_colgroup(): JSX.Element {
  return (
    <colgroup>
      <col className="glossary-page__table-col glossary-page__table-col--drag" />
      <col className="glossary-page__table-col glossary-page__table-col--source" />
      <col className="glossary-page__table-col glossary-page__table-col--translation" />
      <col className="glossary-page__table-col glossary-page__table-col--description" />
      <col className="glossary-page__table-col glossary-page__table-col--rule" />
      <col className="glossary-page__table-col glossary-page__table-col--statistics" />
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

function should_ignore_box_selection_target(
  target_element: HTMLElement,
): boolean {
  return target_element.closest(
    [
      '[data-glossary-ignore-box-select="true"]',
      '[data-slot="scroll-area-scrollbar"]',
      '[data-slot="scroll-area-thumb"]',
      '[data-slot="scroll-area-corner"]',
    ].join(', '),
  ) !== null
}

function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return target_element.closest('[data-glossary-ignore-row-click="true"]') !== null
}


type GlossaryRuleBadgeProps = {
  enabled: boolean
  tooltip: string
}

function GlossaryRuleBadge(props: GlossaryRuleBadgeProps): JSX.Element {
  const badge = (
    <span className="glossary-page__rule-badge-wrap">
      <span
        data-state={props.enabled ? 'active' : 'inactive'}
        data-glossary-ignore-box-select="true"
        className="glossary-page__rule-badge"
      >
        <CaseSensitive aria-hidden="true" />
      </span>
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p className="whitespace-pre-line">{props.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

type GlossaryStatisticsBadgeProps = {
  entry_id: GlossaryEntryId
  statistics_running: boolean
  badge_state: GlossaryStatisticsBadgeState | null
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void
}

function GlossaryStatisticsBadge(props: GlossaryStatisticsBadgeProps): JSX.Element | null {
  const { t } = useI18n()

  if (props.statistics_running) {
    return (
      <span
        data-glossary-ignore-box-select="true"
        data-glossary-ignore-row-click="true"
        className="glossary-page__statistics-badge-wrap"
      >
        <Badge
          variant="outline"
          className="glossary-page__statistics-badge glossary-page__statistics-badge--running"
        >
          <Spinner data-icon="inline-start" />
          <span className="sr-only">{t('glossary_page.statistics.running')}</span>
        </Badge>
      </span>
    )
  }

  if (props.badge_state === null) {
    return null
  }

  const badge_color_class_name = props.badge_state.kind === 'matched'
    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400'
    : props.badge_state.kind === 'related'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400'

  const badge = (
    <Badge
      className={cn(
        'glossary-page__statistics-badge',
        badge_color_class_name,
      )}
    >
      {props.badge_state.matched_count.toString()}
    </Badge>
  )

  const tooltip_content = (
    <TooltipContent side="top" sideOffset={8}>
      <p className="whitespace-pre-line">{props.badge_state.tooltip}</p>
    </TooltipContent>
  )

  if (props.badge_state.kind === 'unmatched') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-glossary-ignore-box-select="true"
            data-glossary-ignore-row-click="true"
            className="glossary-page__statistics-badge-wrap"
          >
            {badge}
          </span>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
    )
  }

  if (props.badge_state.kind === 'matched') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-glossary-ignore-box-select="true"
            data-glossary-ignore-row-click="true"
            className="glossary-page__statistics-badge-button"
            onClick={(event) => {
              event.stopPropagation()
              void props.on_query_entry_source(props.entry_id)
            }}
          >
            {badge}
          </button>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
    )
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-glossary-ignore-box-select="true"
              data-glossary-ignore-row-click="true"
              className="glossary-page__statistics-badge-button"
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              {badge}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {tooltip_content}
      </Tooltip>
      <DropdownMenuContent align="center" matchTriggerWidth={false}>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void props.on_query_entry_source(props.entry_id)
            }}
          >
            {t('glossary_page.statistics.action.query_source')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              props.on_search_entry_relations(props.entry_id)
            }}
          >
            {t('glossary_page.statistics.action.search_relation')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  const { t } = useI18n()
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: props.entry_id,
    disabled: props.drag_disabled,
  })

  const row_style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const case_tooltip = t('glossary_page.toggle.status').replace(
    '{TITLE}',
    t('glossary_page.rule.case_sensitive'),
  ).replace(
    '{STATE}',
    t(props.entry.case_sensitive ? 'app.toggle.enabled' : 'app.toggle.disabled'),
  )
  const drag_tooltip = props.drag_disabled
    ? null
    : t('glossary_page.drag.enabled')
  const row_number_label = build_glossary_row_number_label(props.row_index)
  const drag_utility = (
    <div
      className="glossary-page__row-utility"
      data-drag-disabled={props.drag_disabled ? 'true' : undefined}
      data-glossary-ignore-box-select="true"
      {...(props.drag_disabled ? {} : attributes)}
      {...(props.drag_disabled ? {} : listeners)}
    >
      <span className="glossary-page__drag-handle" aria-hidden="true">
        <GripVertical />
      </span>
      <span className="glossary-page__row-index">
        {row_number_label}
      </span>
    </div>
  )

  const set_row_element = (row_element: HTMLTableRowElement | null): void => {
    setNodeRef(row_element)
    props.register_row_element(props.entry_id, row_element)
    if (row_element !== null) {
      props.on_measure_row(row_element)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={set_row_element}
          data-index={props.row_index}
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

            if (
              event.target instanceof HTMLElement
              && should_ignore_row_click_target(event.target)
            ) {
              return
            }

            props.on_select_entry(props.entry_id, {
              extend: event.ctrlKey || event.metaKey,
              range: event.shiftKey,
            })
          }}
          onContextMenu={(event) => {
            if (
              event.target instanceof HTMLElement
              && should_ignore_row_click_target(event.target)
            ) {
              return
            }

            props.on_select_entry(props.entry_id, {
              extend: false,
              range: false,
            })
          }}
          onDoubleClick={(event) => {
            if (props.should_ignore_click()) {
              return
            }

            if (
              event.target instanceof HTMLElement
              && should_ignore_row_click_target(event.target)
            ) {
              return
            }

            props.on_open_edit(props.entry_id)
          }}
        >
          <TableCell className="glossary-page__table-drag-cell">
            {drag_tooltip === null
              ? drag_utility
              : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {drag_utility}
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <p>{drag_tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
          </TableCell>
          <TableCell className="glossary-page__table-source-cell">
            <span className="glossary-page__table-text">
              {props.entry.src}
            </span>
          </TableCell>
          <TableCell className="glossary-page__table-translation-cell">
            <span className="glossary-page__table-text">
              {props.entry.dst}
            </span>
          </TableCell>
          <TableCell className="glossary-page__table-description-cell">
            {props.entry.info.trim() === ''
              ? (
                  <span className="glossary-page__table-text">
                    {props.entry.info}
                  </span>
                )
              : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="glossary-page__table-text">
                        {props.entry.info}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <p className="max-w-80 whitespace-pre-line break-words">
                        {props.entry.info}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
          </TableCell>
          <TableCell className="glossary-page__table-rule-cell">
            <GlossaryRuleBadge
              enabled={props.entry.case_sensitive}
              tooltip={case_tooltip}
            />
          </TableCell>
          <TableCell className="glossary-page__table-statistics-cell">
            <GlossaryStatisticsBadge
              entry_id={props.entry_id}
              statistics_running={props.statistics_running}
              badge_state={props.statistics_badge_state}
              on_query_entry_source={props.on_query_entry_source}
              on_search_entry_relations={props.on_search_entry_relations}
            />
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <GlossaryContextMenuContent
        on_open_edit={() => {
          props.on_open_edit(props.entry_id)
        }}
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
    && previous_props.drag_disabled === next_props.drag_disabled
    && previous_props.statistics_running === next_props.statistics_running
    && previous_props.statistics_badge_state === next_props.statistics_badge_state
    && previous_props.register_row_element === next_props.register_row_element
    && previous_props.on_open_edit === next_props.on_open_edit
    && previous_props.on_select_entry === next_props.on_select_entry
    && previous_props.on_toggle_case_sensitive === next_props.on_toggle_case_sensitive
    && previous_props.should_ignore_click === next_props.should_ignore_click
    && previous_props.on_measure_row === next_props.on_measure_row
    && previous_props.on_query_entry_source === next_props.on_query_entry_source
    && previous_props.on_search_entry_relations === next_props.on_search_entry_relations
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
        <div className="glossary-page__row-utility">
          <span
            aria-hidden="true"
            className="glossary-page__drag-handle glossary-page__table-placeholder-affordance"
          >
            <GripVertical />
          </span>
          <span
            aria-hidden="true"
            className="glossary-page__row-index glossary-page__table-placeholder-content"
          >
            {build_glossary_row_number_label(props.row_index)}
          </span>
        </div>
      </TableCell>
      <TableCell className="glossary-page__table-source-cell glossary-page__table-placeholder-cell">
        <span
          className="glossary-page__table-text glossary-page__table-placeholder-content"
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
      <TableCell className="glossary-page__table-statistics-cell glossary-page__table-placeholder-cell">
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
    return props.entries.map((entry) => entry.entry_id)
  }, [props.entries])
  const entry_index_by_id = useMemo(() => {
    return new Map(entry_ids.map((entry_id, index) => [entry_id, index]))
  }, [entry_ids])
  const active_drag_row_index = active_drag_entry_id === null
    ? null
    : entry_index_by_id.get(active_drag_entry_id) ?? null
  const active_drag_item = active_drag_entry_id === null
    ? null
    : props.entries[active_drag_row_index ?? -1] ?? null
  const active_drag_entry = active_drag_item?.entry ?? null
  const active_drag_row_number = active_drag_row_index === null
    ? null
    : build_glossary_row_number_label(active_drag_row_index)
  const selection_box_style = normalize_selection_box_style(
    table_scroll_host_ref.current,
    selection_box_visual,
  )

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

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: props.entries.length,
    getScrollElement: () => viewport_element,
    estimateSize: () => GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
    overscan: GLOSSARY_TABLE_VIRTUAL_OVERSCAN,
    getItemKey: (index) => entry_ids[index] ?? index,
    initialRect: {
      width: 0,
      height: Math.max(
        viewport_height,
        GLOSSARY_TABLE_ESTIMATED_ROW_HEIGHT,
      ),
    },
  })

  useEffect(() => {
    virtualizer.measure()
  }, [props.entries.length, viewport_height, virtualizer])

  const virtual_rows = virtualizer.getVirtualItems()
  const first_virtual_row = virtual_rows[0] ?? null
  const last_virtual_row = virtual_rows.at(-1) ?? null
  const spacer_heights = build_glossary_table_spacer_heights({
    viewport_height,
    total_size: virtualizer.getTotalSize(),
    range_start: first_virtual_row?.start ?? 0,
    range_end: last_virtual_row?.end ?? 0,
  })
  const placeholder_fill = build_glossary_table_placeholder_fill(
    spacer_heights.viewport_fill_height,
    measured_row_height,
  )
  const show_top_spacer = spacer_heights.top_spacer_height > 0.5
  const bottom_spacer_height = spacer_heights.virtual_bottom_spacer_height
    + placeholder_fill.residual_spacer_height
  const show_bottom_spacer = bottom_spacer_height > 0.5

  const measure_virtual_row = useCallback((row_element: HTMLTableRowElement): void => {
    virtualizer.measureElement(row_element)

    const next_row_height = Math.round(row_element.getBoundingClientRect().height)
    if (next_row_height > 0) {
      set_measured_row_height((previous_row_height) => {
        return next_row_height === previous_row_height
          ? previous_row_height
          : next_row_height
      })
    }
  }, [virtualizer])

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
    // 框选命中只可能发生在当前渲染行，按可见 DOM 扫描能把每帧开销压到视口规模。
    const next_entry_ids = [...row_elements_ref.current.entries()]
      .filter(([, row_element]) => {
        return intersects_selection_box(row_element, current_state)
      })
      .map(([entry_id]) => entry_id)
      .sort((left_entry_id, right_entry_id) => {
        return (entry_index_by_id.get(left_entry_id) ?? Number.MAX_SAFE_INTEGER)
          - (entry_index_by_id.get(right_entry_id) ?? Number.MAX_SAFE_INTEGER)
      })

    if (are_glossary_entry_ids_equal(selection_box_ids_ref.current, next_entry_ids)) {
      return
    }

    selection_box_ids_ref.current = next_entry_ids
    latest_on_box_select_ref.current(next_entry_ids)
  }, [cancel_selection_animation_frame, entry_index_by_id])

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

    if (should_ignore_box_selection_target(event.target)) {
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
    if (props.drag_disabled) {
      return
    }

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

    if (props.drag_disabled) {
      return
    }

    if (event.over === null || event.active.id === event.over.id) {
      return
    }

    void props.on_reorder(String(event.active.id), String(event.over.id))
  }

  const source_sort_trigger = (
    <GlossarySortTrigger
      label={t('glossary_page.fields.source')}
      field="src"
      sort_state={props.sort_state}
      on_cycle={props.on_cycle_column_sort}
    />
  )
  const translation_sort_trigger = (
    <GlossarySortTrigger
      label={t('glossary_page.fields.translation')}
      field="dst"
      sort_state={props.sort_state}
      on_cycle={props.on_cycle_column_sort}
    />
  )
  const description_sort_trigger = (
    <GlossarySortTrigger
      label={t('glossary_page.fields.description')}
      field="info"
      sort_state={props.sort_state}
      on_cycle={props.on_cycle_column_sort}
    />
  )
  const rule_sort_trigger = (
    <GlossarySortTrigger
      label={t('glossary_page.fields.rule')}
      field="rule"
      sort_state={props.sort_state}
      on_cycle={props.on_cycle_column_sort}
    />
  )
  const statistics_sort_trigger = (
    <GlossarySortTrigger
      label={t('glossary_page.fields.statistics')}
      field="statistics"
      sort_state={props.sort_state}
      disabled={!props.statistics_ready}
      on_cycle={props.on_cycle_column_sort}
    />
  )

  const header = (
    <div className="glossary-page__table-head-wrap">
      <Table className="glossary-page__table">
        {render_table_colgroup()}
        <TableHeader className="glossary-page__table-head">
          <TableRow>
            {render_table_head_content({
              label: t('glossary_page.fields.drag'),
              menu: null,
              class_name: 'glossary-page__table-drag-head',
              compact: true,
            })}
            {render_table_head_content({
              label: t('glossary_page.fields.source'),
              menu: source_sort_trigger,
              class_name: 'glossary-page__table-source-head',
            })}
            {render_table_head_content({
              label: t('glossary_page.fields.translation'),
              menu: translation_sort_trigger,
              class_name: 'glossary-page__table-translation-head',
            })}
            {render_table_head_content({
              label: t('glossary_page.fields.description'),
              menu: description_sort_trigger,
              class_name: 'glossary-page__table-description-head',
            })}
            {render_table_head_content({
              label: t('glossary_page.fields.rule'),
              menu: rule_sort_trigger,
              class_name: 'glossary-page__table-rule-head',
            })}
            {render_table_head_content({
              label: t('glossary_page.fields.statistics'),
              menu: statistics_sort_trigger,
              class_name: 'glossary-page__table-statistics-head',
            })}
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
          sensors={props.drag_disabled ? [] : sensors}
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
                {show_top_spacer
                  ? (
                      <GlossaryTableSpacerRow
                        col_span={6}
                        height={spacer_heights.top_spacer_height}
                      />
                    )
                  : null}
                {virtual_rows.map((virtual_row) => {
                  const entry_item = props.entries[virtual_row.index]
                  if (entry_item === undefined) {
                    return null
                  }

                  const entry_id = entry_ids[virtual_row.index] ?? `${virtual_row.index.toString()}`

                  return (
                    <GlossarySortableRow
                      key={entry_id}
                      entry={entry_item.entry}
                      entry_id={entry_id}
                      row_index={virtual_row.index}
                      active={props.active_entry_id === entry_id}
                      selected={selected_entry_id_set.has(entry_id)}
                      drag_disabled={props.drag_disabled}
                      statistics_running={props.statistics_running}
                      statistics_badge_state={props.statistics_badge_by_entry_id[entry_id] ?? null}
                      register_row_element={register_row_element}
                      on_measure_row={measure_virtual_row}
                      on_open_edit={props.on_open_edit}
                      on_select_entry={props.on_select_entry}
                      on_toggle_case_sensitive={props.on_toggle_case_sensitive}
                      should_ignore_click={should_ignore_click}
                      on_query_entry_source={props.on_query_entry_source}
                      on_search_entry_relations={props.on_search_entry_relations}
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
                        height={bottom_spacer_height}
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
                          data-row-index={active_drag_row_index ?? 0}
                          data-zebra={resolve_glossary_table_row_zebra(
                            active_drag_row_index ?? 0,
                          )}
                          data-state="selected"
                          data-dragging="true"
                          className="glossary-page__table-row"
                        >
                          <TableCell className="glossary-page__table-drag-cell">
                            <div className="glossary-page__row-utility">
                              <span className="glossary-page__drag-handle" aria-hidden="true">
                                <GripVertical />
                              </span>
                              <span className="glossary-page__row-index">
                                {active_drag_row_number}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="glossary-page__table-source-cell">
                            <span className="glossary-page__table-text">
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
                            <GlossaryRuleBadge
                              enabled={active_drag_entry.case_sensitive}
                              tooltip={t('glossary_page.toggle.status').replace(
                                '{TITLE}',
                                t('glossary_page.rule.case_sensitive'),
                              ).replace(
                                '{STATE}',
                                t(active_drag_entry.case_sensitive ? 'app.toggle.enabled' : 'app.toggle.disabled'),
                              )}
                            />
                          </TableCell>
                          <TableCell className="glossary-page__table-statistics-cell" />
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
      empty_state={null}
      header={header}
      body={body}
    />
  )
}
