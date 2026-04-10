import { CaseSensitive, GripVertical } from 'lucide-react'
import { useMemo } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GlossaryContextMenuContent } from '@/pages/glossary-page/components/glossary-context-menu'
import type {
  GlossaryEntryId,
  GlossarySortState,
  GlossaryStatisticsBadgeState,
  GlossaryVisibleEntry,
} from '@/pages/glossary-page/types'
import { Badge } from '@/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Spinner } from '@/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip'
import { AppTable } from '@/widgets/app-table/app-table'
import type {
  AppTableColumn,
  AppTableSelectionChange,
  AppTableSortState,
} from '@/widgets/app-table/app-table-types'

type GlossaryTableProps = {
  entries: GlossaryVisibleEntry[]
  sort_state: GlossarySortState
  drag_disabled: boolean
  statistics_running: boolean
  statistics_ready: boolean
  selected_entry_ids: GlossaryEntryId[]
  active_entry_id: GlossaryEntryId | null
  anchor_entry_id: GlossaryEntryId | null
  statistics_badge_by_entry_id: Record<GlossaryEntryId, GlossaryStatisticsBadgeState>
  on_sort_change: (sort_state: AppTableSortState | null) => void
  on_selection_change: (payload: AppTableSelectionChange) => void
  on_open_edit: (entry_id: GlossaryEntryId) => void
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  on_reorder: (
    active_entry_id: GlossaryEntryId,
    over_entry_id: GlossaryEntryId,
  ) => Promise<void>
  on_query_entry_source: (entry_id: GlossaryEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: GlossaryEntryId) => void
}

function build_glossary_row_number_label(row_index: number): string {
  return String(row_index + 1)
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

function map_glossary_sort_state(
  sort_state: GlossarySortState,
): AppTableSortState | null {
  if (sort_state.field === null || sort_state.direction === null) {
    return null
  }

  return {
    column_id: sort_state.field,
    direction: sort_state.direction,
  }
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

export function GlossaryTable(props: GlossaryTableProps): JSX.Element {
  const { t } = useI18n()

  const columns = useMemo<AppTableColumn<GlossaryVisibleEntry>[]>(() => {
    return [
      {
        kind: 'drag',
        id: 'drag',
        width: 64,
        align: 'center',
        title: t('glossary_page.fields.drag'),
        aria_label: t('glossary_page.drag.enabled'),
        head_class_name: 'glossary-page__table-drag-head',
        cell_class_name: 'glossary-page__table-drag-cell',
        render_cell: (payload) => {
          const utility = (
            <div
              className="glossary-page__row-utility"
              data-drag-disabled={!payload.can_drag ? 'true' : undefined}
              data-glossary-ignore-box-select="true"
              data-glossary-ignore-row-click="true"
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.attributes ?? {})}
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.listeners ?? {})}
            >
              <span className="glossary-page__drag-handle" aria-hidden="true">
                <GripVertical />
              </span>
              <span className="glossary-page__row-index">
                {build_glossary_row_number_label(payload.row_index)}
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
      },
      {
        kind: 'data',
        id: 'src',
        title: t('glossary_page.fields.source'),
        align: 'left',
        sortable: {
          action_labels: {
            ascending: t('glossary_page.sort.ascending'),
            descending: t('glossary_page.sort.descending'),
            clear: t('glossary_page.sort.clear'),
          },
        },
        head_class_name: 'glossary-page__table-source-head',
        cell_class_name: 'glossary-page__table-source-cell',
        render_cell: (payload) => {
          return (
            <span className="glossary-page__table-text">
              {payload.row.entry.src}
            </span>
          )
        },
      },
      {
        kind: 'data',
        id: 'dst',
        title: t('glossary_page.fields.translation'),
        align: 'left',
        sortable: {
          action_labels: {
            ascending: t('glossary_page.sort.ascending'),
            descending: t('glossary_page.sort.descending'),
            clear: t('glossary_page.sort.clear'),
          },
        },
        head_class_name: 'glossary-page__table-translation-head',
        cell_class_name: 'glossary-page__table-translation-cell',
        render_cell: (payload) => {
          return (
            <span className="glossary-page__table-text">
              {payload.row.entry.dst}
            </span>
          )
        },
      },
      {
        kind: 'data',
        id: 'info',
        title: t('glossary_page.fields.description'),
        align: 'left',
        sortable: {
          action_labels: {
            ascending: t('glossary_page.sort.ascending'),
            descending: t('glossary_page.sort.descending'),
            clear: t('glossary_page.sort.clear'),
          },
        },
        head_class_name: 'glossary-page__table-description-head',
        cell_class_name: 'glossary-page__table-description-cell',
        render_cell: (payload) => {
          if (payload.row.entry.info.trim() === '') {
            return (
              <span className="glossary-page__table-text">
                {payload.row.entry.info}
              </span>
            )
          }

          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="glossary-page__table-text">
                  {payload.row.entry.info}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <p className="max-w-80 whitespace-pre-line break-words">
                  {payload.row.entry.info}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        },
      },
      {
        kind: 'data',
        id: 'rule',
        title: t('glossary_page.fields.rule'),
        width: 96,
        align: 'center',
        sortable: {
          action_labels: {
            ascending: t('glossary_page.sort.ascending'),
            descending: t('glossary_page.sort.descending'),
            clear: t('glossary_page.sort.clear'),
          },
        },
        head_class_name: 'glossary-page__table-rule-head',
        cell_class_name: 'glossary-page__table-rule-cell',
        render_cell: (payload) => {
          const case_tooltip = t('glossary_page.toggle.status').replace(
            '{TITLE}',
            t('glossary_page.rule.case_sensitive'),
          ).replace(
            '{STATE}',
            t(payload.row.entry.case_sensitive ? 'app.toggle.enabled' : 'app.toggle.disabled'),
          )

          return (
            <GlossaryRuleBadge
              enabled={payload.row.entry.case_sensitive}
              tooltip={case_tooltip}
            />
          )
        },
      },
      {
        kind: 'data',
        id: 'statistics',
        title: t('glossary_page.fields.statistics'),
        width: 92,
        align: 'center',
        sortable: {
          disabled: !props.statistics_ready,
          action_labels: {
            ascending: t('glossary_page.sort.ascending'),
            descending: t('glossary_page.sort.descending'),
            clear: t('glossary_page.sort.clear'),
          },
        },
        head_class_name: 'glossary-page__table-statistics-head',
        cell_class_name: 'glossary-page__table-statistics-cell',
        render_cell: (payload) => {
          if (payload.presentation === 'overlay') {
            return null
          }

          return (
            <GlossaryStatisticsBadge
              entry_id={payload.row_id}
              statistics_running={props.statistics_running}
              badge_state={props.statistics_badge_by_entry_id[payload.row_id] ?? null}
              on_query_entry_source={props.on_query_entry_source}
              on_search_entry_relations={props.on_search_entry_relations}
            />
          )
        },
      },
    ]
  }, [props, t])

  return (
    <Card variant="table" className="glossary-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t('glossary_page.title')}</CardTitle>
        <CardDescription>{t('glossary_page.summary')}</CardDescription>
      </CardHeader>
      <CardContent className="glossary-page__table-card-content">
        <AppTable
          rows={props.entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={map_glossary_sort_state(props.sort_state)}
          drag_enabled={!props.drag_disabled}
          get_row_id={(entry) => entry.entry_id}
          on_selection_change={props.on_selection_change}
          on_sort_change={props.on_sort_change}
          on_reorder={(payload) => {
            void props.on_reorder(payload.active_row_id, payload.over_row_id)
          }}
          on_row_double_click={(payload) => {
            props.on_open_edit(payload.row_id)
          }}
          render_row_context_menu={(payload) => {
            return (
              <GlossaryContextMenuContent
                on_open_edit={() => {
                  props.on_open_edit(payload.row_id)
                }}
                on_toggle_case_sensitive={props.on_toggle_case_sensitive}
              />
            )
          }}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="glossary-page__table"
          row_class_name={() => 'glossary-page__table-row'}
        />
      </CardContent>
    </Card>
  )
}
