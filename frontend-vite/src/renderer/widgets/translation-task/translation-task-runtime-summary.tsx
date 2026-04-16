import '@/widgets/translation-task/translation-task.css'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import type { TranslationTaskMetrics } from '@/lib/translation-task'
import { Badge } from '@/shadcn/badge'
import { Spinner } from '@/shadcn/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'

type TranslationTaskRuntimeSummaryProps = {
  class_name?: string
  translation_task_metrics: TranslationTaskMetrics
  can_open: boolean
  on_open: () => void
}

function resolve_summary_status_copy(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (metrics.stopping) {
    return t('proofreading_page.task.summary.stopping')
  }

  if (metrics.active) {
    return t('proofreading_page.task.summary.running')
  }

  return t('proofreading_page.task.summary.empty')
}

function format_summary_speed(value: number): string {
  if (value < 1000) {
    return `${value.toFixed(2)} T/S`
  }

  return `${(value / 1000).toFixed(2)} KT/S`
}

function resolve_summary_badge_tone_class_name(
  metrics: TranslationTaskMetrics,
): string {
  if (metrics.stopping) {
    return 'translation-task__summary-badge--warning'
  }

  if (metrics.active) {
    return 'translation-task__summary-badge--success'
  }

  return 'translation-task__summary-badge--neutral'
}

export function TranslationTaskRuntimeSummary(
  props: TranslationTaskRuntimeSummaryProps,
): JSX.Element {
  const { t } = useI18n()
  const summary_status = resolve_summary_status_copy(
    props.translation_task_metrics,
    t,
  )
  const show_task_runtime = props.translation_task_metrics.active
    || props.translation_task_metrics.stopping
  const summary_badge = (
    <Badge
      variant="outline"
      className={cn(
        'translation-task__summary',
        'translation-task__summary-badge',
        props.class_name,
        props.can_open ? 'translation-task__summary-badge--clickable' : null,
        resolve_summary_badge_tone_class_name(props.translation_task_metrics),
      )}
    >
      {show_task_runtime ? <Spinner data-icon="inline-start" /> : null}
      <span>{summary_status}</span>
      {show_task_runtime
        ? (
            <span className="translation-task__summary-speed">
              {format_summary_speed(props.translation_task_metrics.average_output_speed)}
            </span>
          )
        : null}
    </Badge>
  )

  if (!props.can_open) {
    return summary_badge
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="translation-task__summary-trigger"
          onClick={props.on_open}
        >
          {summary_badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{t('proofreading_page.task.summary.detail_tooltip')}</p>
      </TooltipContent>
    </Tooltip>
  )
}
