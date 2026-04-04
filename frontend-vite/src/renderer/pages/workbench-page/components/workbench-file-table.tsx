import { ShieldAlert } from 'lucide-react'

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
}

const MIN_VISIBLE_ROW_COUNT = 8

function build_placeholder_rows(entry_count: number): number[] {
  const placeholder_count = Math.max(0, MIN_VISIBLE_ROW_COUNT - entry_count)
  return Array.from({ length: placeholder_count }, (_, index) => index)
}

export function WorkbenchFileTable(props: WorkbenchFileTableProps): JSX.Element {
  const { t } = useI18n()
  const placeholder_rows = build_placeholder_rows(props.entries.length)

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
        ) : (
          <ScrollArea className="workbench-page__table-scroll">
            <Table variant="card" density="compact" className="workbench-page__table">
              <TableHeader className="workbench-page__table-head">
                <TableRow>
                  <TableHead className="workbench-page__table-index-head" />
                  <TableHead className="workbench-page__table-file-head">{t('task.page.workbench.table.file_name')}</TableHead>
                  <TableHead className="workbench-page__table-format-head">{t('task.page.workbench.table.format')}</TableHead>
                  <TableHead className="workbench-page__table-line-head">{t('task.page.workbench.table.line_count')}</TableHead>
                  <TableHead className="workbench-page__table-action-head">{t('task.page.workbench.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.entries.map((entry, index) => {
                  const is_selected = entry.rel_path === props.selected_entry_id
                  const format_label = entry.format_label_key === null
                    ? (entry.format_fallback_label ?? '-')
                    : t(entry.format_label_key)

                  return (
                    <ContextMenu key={entry.rel_path}>
                      <ContextMenuTrigger asChild>
                        <TableRow
                          data-state={is_selected ? 'selected' : undefined}
                          onClick={() => props.on_select(entry.rel_path)}
                        >
                          <TableCell className="workbench-page__table-index-cell">{index + 1}</TableCell>
                          <TableCell className="workbench-page__table-file-cell">{entry.rel_path}</TableCell>
                          <TableCell className="workbench-page__table-format-cell">{format_label}</TableCell>
                          <TableCell className="workbench-page__table-line-cell">{entry.item_count}</TableCell>
                          <TableCell className="workbench-page__table-action-cell">
                            <WorkbenchTableActionMenu
                              disabled={props.readonly}
                              on_replace={() => props.on_replace(entry.rel_path)}
                              on_reset={() => props.on_reset(entry.rel_path)}
                              on_delete={() => props.on_delete(entry.rel_path)}
                            />
                          </TableCell>
                        </TableRow>
                      </ContextMenuTrigger>
                      <WorkbenchTableContextMenuContent
                        disabled={props.readonly}
                        on_replace={() => props.on_replace(entry.rel_path)}
                        on_reset={() => props.on_reset(entry.rel_path)}
                        on_delete={() => props.on_delete(entry.rel_path)}
                      />
                    </ContextMenu>
                  )
                })}

                {placeholder_rows.map((placeholder_index) => (
                  <TableRow key={`placeholder-${placeholder_index}`} className="workbench-page__table-placeholder-row">
                    <TableCell className="workbench-page__table-index-cell workbench-page__table-placeholder-cell" />
                    <TableCell className="workbench-page__table-placeholder-cell" />
                    <TableCell className="workbench-page__table-placeholder-cell" />
                    <TableCell className="workbench-page__table-placeholder-cell" />
                    <TableCell className="workbench-page__table-placeholder-cell" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
