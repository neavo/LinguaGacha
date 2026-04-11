import { CaseSensitive, GripVertical, Regex } from 'lucide-react'
import { useMemo } from 'react'

import { useI18n, type LocaleKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { TextReplacementContextMenuContent } from '@/pages/text-replacement-page/components/text-replacement-context-menu'
import type {
  TextReplacementEntryId,
  TextReplacementStatisticsBadgeState,
  TextReplacementVisibleEntry,
} from '@/pages/text-replacement-page/types'
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

type TextReplacementTableProps = {
  title_key: LocaleKey
  summary_key: LocaleKey
  entries: TextReplacementVisibleEntry[]
  sort_state: AppTableSortState | null
  drag_disabled: boolean
  statistics_running: boolean
  statistics_ready: boolean
  selected_entry_ids: TextReplacementEntryId[]
  active_entry_id: TextReplacementEntryId | null
  anchor_entry_id: TextReplacementEntryId | null
  statistics_badge_by_entry_id: Record<
    TextReplacementEntryId,
    TextReplacementStatisticsBadgeState
  >
  on_sort_change: (sort_state: AppTableSortState | null) => void
  on_selection_change: (payload: AppTableSelectionChange) => void
  on_open_edit: (entry_id: TextReplacementEntryId) => void
  on_toggle_regex: (next_value: boolean) => Promise<void>
  on_toggle_case_sensitive: (next_value: boolean) => Promise<void>
  on_reorder: (
    active_entry_id: TextReplacementEntryId,
    over_entry_id: TextReplacementEntryId,
  ) => Promise<void>
  on_query_entry_source: (entry_id: TextReplacementEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: TextReplacementEntryId) => void
}

function build_row_number_label(row_index: number): string {
  return String(row_index + 1)
}

function should_ignore_box_selection_target(target_element: HTMLElement): boolean {
  return target_element.closest(
    [
      '[data-text-replacement-ignore-box-select="true"]',
      '[data-slot="scroll-area-scrollbar"]',
      '[data-slot="scroll-area-thumb"]',
      '[data-slot="scroll-area-corner"]',
    ].join(', '),
  ) !== null
}

function should_ignore_row_click_target(target_element: HTMLElement): boolean {
  return target_element.closest('[data-text-replacement-ignore-row-click="true"]') !== null
}

type TextReplacementRuleBadgeProps = {
  icon: 'regex' | 'case-sensitive'
  enabled: boolean
  tooltip: string
}

function TextReplacementRuleBadge(
  props: TextReplacementRuleBadgeProps,
): JSX.Element {
  const Icon = props.icon === 'regex' ? Regex : CaseSensitive
  const badge = (
    <span className="text-replacement-page__rule-badge-wrap">
      <span
        data-state={props.enabled ? 'active' : 'inactive'}
        data-text-replacement-ignore-box-select="true"
        className="text-replacement-page__rule-badge"
      >
        <Icon aria-hidden="true" />
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

type TextReplacementStatisticsBadgeProps = {
  entry_id: TextReplacementEntryId
  statistics_running: boolean
  badge_state: TextReplacementStatisticsBadgeState | null
  on_query_entry_source: (entry_id: TextReplacementEntryId) => Promise<void>
  on_search_entry_relations: (entry_id: TextReplacementEntryId) => void
}

function TextReplacementStatisticsBadge(
  props: TextReplacementStatisticsBadgeProps,
): JSX.Element | null {
  const { t } = useI18n()

  if (props.statistics_running) {
    return (
      <span
        data-text-replacement-ignore-box-select="true"
        data-text-replacement-ignore-row-click="true"
        className="text-replacement-page__statistics-badge-wrap"
      >
        <Badge
          variant="outline"
          className="text-replacement-page__statistics-badge text-replacement-page__statistics-badge--running"
        >
          <Spinner data-icon="inline-start" />
          <span className="sr-only">{t('text_replacement_page.statistics.running')}</span>
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
        'text-replacement-page__statistics-badge',
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
            data-text-replacement-ignore-box-select="true"
            data-text-replacement-ignore-row-click="true"
            className="text-replacement-page__statistics-badge-wrap"
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
            data-text-replacement-ignore-box-select="true"
            data-text-replacement-ignore-row-click="true"
            className="text-replacement-page__statistics-badge-button"
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
              data-text-replacement-ignore-box-select="true"
              data-text-replacement-ignore-row-click="true"
              className="text-replacement-page__statistics-badge-button"
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
            {t('text_replacement_page.action.query')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              props.on_search_entry_relations(props.entry_id)
            }}
          >
            {t('text_replacement_page.statistics.action.search_relation')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TextReplacementTable(
  props: TextReplacementTableProps,
): JSX.Element {
  const { t } = useI18n()

  const columns = useMemo<AppTableColumn<TextReplacementVisibleEntry>[]>(() => {
    return [
      {
        kind: 'drag',
        id: 'drag',
        width: 64,
        align: 'center',
        title: t('text_replacement_page.fields.drag'),
        aria_label: t('text_replacement_page.drag.enabled'),
        head_class_name: 'text-replacement-page__table-drag-head',
        cell_class_name: 'text-replacement-page__table-drag-cell',
        render_cell: (payload) => {
          const utility = (
            <div
              className="text-replacement-page__row-utility"
              data-drag-disabled={!payload.can_drag ? 'true' : undefined}
              data-text-replacement-ignore-box-select="true"
              data-text-replacement-ignore-row-click="true"
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.attributes ?? {})}
              {...(payload.drag_handle?.disabled ?? true ? {} : payload.drag_handle?.listeners ?? {})}
            >
              <span className="text-replacement-page__drag-handle" aria-hidden="true">
                <GripVertical />
              </span>
              <span className="text-replacement-page__row-index">
                {build_row_number_label(payload.row_index)}
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
        title: t('text_replacement_page.fields.source'),
        align: 'left',
        sortable: {
          action_labels: {
            ascending: t('text_replacement_page.sort.ascending'),
            descending: t('text_replacement_page.sort.descending'),
            clear: t('text_replacement_page.sort.clear'),
          },
        },
        head_class_name: 'text-replacement-page__table-source-head',
        cell_class_name: 'text-replacement-page__table-source-cell',
        render_cell: (payload) => (
          <span className="text-replacement-page__table-text">
            {payload.row.entry.src}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'dst',
        title: t('text_replacement_page.fields.replacement'),
        align: 'left',
        sortable: {
          action_labels: {
            ascending: t('text_replacement_page.sort.ascending'),
            descending: t('text_replacement_page.sort.descending'),
            clear: t('text_replacement_page.sort.clear'),
          },
        },
        head_class_name: 'text-replacement-page__table-replacement-head',
        cell_class_name: 'text-replacement-page__table-replacement-cell',
        render_cell: (payload) => (
          <span className="text-replacement-page__table-text">
            {payload.row.entry.dst}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'rule',
        title: t('text_replacement_page.fields.rule'),
        width: 120,
        align: 'center',
        sortable: {
          action_labels: {
            ascending: t('text_replacement_page.sort.ascending'),
            descending: t('text_replacement_page.sort.descending'),
            clear: t('text_replacement_page.sort.clear'),
          },
        },
        head_class_name: 'text-replacement-page__table-rule-head',
        cell_class_name: 'text-replacement-page__table-rule-cell',
        render_cell: (payload) => {
          const regex_tooltip = t('text_replacement_page.toggle.status')
            .replace('{TITLE}', t('text_replacement_page.rule.regex'))
            .replace(
              '{STATE}',
              t(payload.row.entry.regex ? 'app.toggle.enabled' : 'app.toggle.disabled'),
            )
          const case_tooltip = t('text_replacement_page.toggle.status')
            .replace('{TITLE}', t('text_replacement_page.rule.case_sensitive'))
            .replace(
              '{STATE}',
              t(payload.row.entry.case_sensitive ? 'app.toggle.enabled' : 'app.toggle.disabled'),
            )

          return (
            <div className="text-replacement-page__rule-badge-group">
              <TextReplacementRuleBadge
                icon="regex"
                enabled={payload.row.entry.regex}
                tooltip={regex_tooltip}
              />
              <TextReplacementRuleBadge
                icon="case-sensitive"
                enabled={payload.row.entry.case_sensitive}
                tooltip={case_tooltip}
              />
            </div>
          )
        },
      },
      {
        kind: 'data',
        id: 'statistics',
        title: t('text_replacement_page.fields.statistics'),
        width: 92,
        align: 'center',
        sortable: {
          disabled: !props.statistics_ready,
          action_labels: {
            ascending: t('text_replacement_page.sort.ascending'),
            descending: t('text_replacement_page.sort.descending'),
            clear: t('text_replacement_page.sort.clear'),
          },
        },
        head_class_name: 'text-replacement-page__table-statistics-head',
        cell_class_name: 'text-replacement-page__table-statistics-cell',
        render_cell: (payload) => {
          if (payload.presentation === 'overlay') {
            return null
          }

          return (
            <TextReplacementStatisticsBadge
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
    <Card variant="table" className="text-replacement-page__table-card">
      <CardHeader className="sr-only">
        <CardTitle>{t(props.title_key)}</CardTitle>
        <CardDescription>{t(props.summary_key)}</CardDescription>
      </CardHeader>
      <CardContent className="text-replacement-page__table-card-content">
        <AppTable
          rows={props.entries}
          columns={columns}
          selection_mode="multiple"
          selected_row_ids={props.selected_entry_ids}
          active_row_id={props.active_entry_id}
          anchor_row_id={props.anchor_entry_id}
          sort_state={props.sort_state}
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
          render_row_context_menu={(payload) => (
            <TextReplacementContextMenuContent
              on_open_edit={() => {
                props.on_open_edit(payload.row_id)
              }}
              on_toggle_regex={props.on_toggle_regex}
              on_toggle_case_sensitive={props.on_toggle_case_sensitive}
            />
          )}
          ignore_row_click_target={should_ignore_row_click_target}
          ignore_box_select_target={should_ignore_box_selection_target}
          box_selection_enabled
          table_class_name="text-replacement-page__table"
          row_class_name={() => 'text-replacement-page__table-row'}
        />
      </CardContent>
    </Card>
  )
}
