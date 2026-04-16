import {
  BrushCleaning,
  FileDown,
  Paintbrush,
  Play,
  Radar,
  RotateCw,
} from 'lucide-react'

import '@/pages/workbench-page/components/task-runtime/task-runtime.css'
import { useI18n } from '@/i18n'
import {
  has_analysis_task_progress,
  type AnalysisTaskActionKind,
  type AnalysisTaskMetrics,
  type AnalysisTaskSnapshot,
} from '@/lib/analysis-task'
import { Badge } from '@/shadcn/badge'
import { Button } from '@/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shadcn/dropdown-menu'
import { Progress } from '@/shadcn/progress'
import { Spinner } from '@/shadcn/spinner'

type AnalysisTaskMenuProps = {
  analysis_task_display_snapshot: AnalysisTaskSnapshot | null
  analysis_task_metrics: AnalysisTaskMetrics
  disabled: boolean
  busy: boolean
  importing: boolean
  active_task_action_kind: AnalysisTaskActionKind | null
  on_start_or_continue: () => Promise<void>
  on_request_confirmation: (kind: AnalysisTaskActionKind) => void
  on_import_glossary: () => Promise<void>
}

function resolve_summary_progress_percent(
  metrics: AnalysisTaskMetrics,
): number {
  return Number.isFinite(metrics.completion_percent)
    ? metrics.completion_percent
    : 0
}

export function AnalysisTaskMenu(
  props: AnalysisTaskMenuProps,
): JSX.Element {
  const { t } = useI18n()
  const has_progress = has_analysis_task_progress(props.analysis_task_display_snapshot)
  const main_action_label = has_progress
    ? t('workbench_page.action.continue_analysis')
    : t('workbench_page.action.start_analysis')
  const action_items_disabled = props.analysis_task_metrics.active || props.busy || props.disabled
  const import_disabled = action_items_disabled
    || props.importing
    || props.analysis_task_metrics.candidate_count <= 0
  const progress_percent = resolve_summary_progress_percent(props.analysis_task_metrics)
  const trigger_icon = <Radar data-icon="inline-start" />
  const main_action_icon = has_progress
    ? <RotateCw data-icon="inline-start" />
    : <Play data-icon="inline-start" />

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="toolbar"
          variant="ghost"
          disabled={props.disabled}
        >
          {trigger_icon}
          {t('workbench_page.action.analysis_task')}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="task-runtime__menu">
        <div className="task-runtime__menu-progress">
          <div className="task-runtime__menu-progress-head">
            <span className="task-runtime__menu-progress-label">
              {t('workbench_page.analysis_task.menu.progress')}
            </span>
            <span className="task-runtime__menu-progress-value">
              {progress_percent.toFixed(2)}
              %
            </span>
          </div>
          <Progress value={progress_percent} />
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={action_items_disabled}
            onSelect={() => {
              void props.on_start_or_continue()
            }}
          >
            {props.analysis_task_metrics.active
              ? <Spinner data-icon="inline-start" />
              : main_action_icon}
            {main_action_label}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation('reset-all')
            }}
          >
            {props.active_task_action_kind === 'reset-all' && props.busy
              ? <Spinner data-icon="inline-start" />
              : <BrushCleaning data-icon="inline-start" />}
            {t('workbench_page.action.reset_analysis_all')}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation('reset-failed')
            }}
          >
            {props.active_task_action_kind === 'reset-failed' && props.busy
              ? <Spinner data-icon="inline-start" />
              : <Paintbrush data-icon="inline-start" />}
            {t('workbench_page.action.reset_analysis_failed')}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={import_disabled}
            onSelect={() => {
              void props.on_import_glossary()
            }}
          >
            {props.importing
              ? <Spinner data-icon="inline-start" />
              : <FileDown data-icon="inline-start" />}
            {t('workbench_page.action.import_analysis_glossary')}
            {props.analysis_task_metrics.candidate_count > 0
              ? (
                  <Badge
                    variant="secondary"
                    className="ml-auto min-w-5 justify-center font-mono tabular-nums"
                  >
                    {props.analysis_task_metrics.candidate_count}
                  </Badge>
                )
              : null}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
