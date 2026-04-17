import {
  BrushCleaning,
  Paintbrush,
  Play,
  RotateCw,
  ScanText,
} from 'lucide-react'

import '@/pages/workbench-page/components/task-runtime/task-runtime.css'
import { useI18n } from '@/i18n'
import {
  has_translation_task_progress,
  type TranslationTaskActionKind,
  type TranslationTaskMetrics,
  type TranslationTaskSnapshot,
} from '@/lib/translation-task'
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

type TranslationTaskMenuProps = {
  translation_task_display_snapshot: TranslationTaskSnapshot | null
  translation_task_metrics: TranslationTaskMetrics
  disabled: boolean
  busy: boolean
  active_task_action_kind: TranslationTaskActionKind | null
  on_start_or_continue: () => Promise<void>
  on_request_confirmation: (kind: TranslationTaskActionKind) => void
}

function resolve_summary_progress_percent(
  metrics: TranslationTaskMetrics,
): number {
  return Number.isFinite(metrics.completion_percent)
    ? metrics.completion_percent
    : 0
}

export function TranslationTaskMenu(
  props: TranslationTaskMenuProps,
): JSX.Element {
  const { t } = useI18n()
  const has_progress = has_translation_task_progress(props.translation_task_display_snapshot)
  const main_action_label = has_progress
    ? t('proofreading_page.action.continue_translation')
    : t('proofreading_page.action.start_translation')
  const action_items_disabled = props.translation_task_metrics.active || props.busy || props.disabled
  const progress_percent = resolve_summary_progress_percent(props.translation_task_metrics)
  const trigger_icon = <ScanText data-icon="inline-start" />
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
          {t('proofreading_page.action.translation_task')}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="task-runtime__menu">
        <div className="task-runtime__menu-progress">
          <div className="task-runtime__menu-progress-head">
            <span className="task-runtime__menu-progress-label">
              {t('proofreading_page.task.menu.progress')}
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
            {props.translation_task_metrics.active
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
            {t('proofreading_page.action.reset_translation_all')}
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
            {t('proofreading_page.action.reset_translation_failed')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
