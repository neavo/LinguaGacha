import { Activity, CircleStop } from 'lucide-react'

import { useI18n } from '@/i18n'
import type {
  ProofreadingTranslationTaskMetrics,
  ProofreadingTranslationTaskSnapshot,
} from '@/pages/proofreading-page/types'
import { Button } from '@/shadcn/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shadcn/sheet'

type ProofreadingTaskDetailSheetProps = {
  open: boolean
  translation_task_display_snapshot: ProofreadingTranslationTaskSnapshot | null
  translation_task_metrics: ProofreadingTranslationTaskMetrics
  translation_waveform_history: number[]
  on_close: () => void
  on_request_stop_confirmation: () => void
}

type MetricEntry = {
  key: string
  label: string
  value: string
}

function format_duration(seconds: number): string {
  const normalized_seconds = Math.max(0, Math.floor(seconds))

  if (normalized_seconds < 60) {
    return `${normalized_seconds.toString()} S`
  }

  if (normalized_seconds < 60 * 60) {
    return `${(normalized_seconds / 60).toFixed(2)} M`
  }

  return `${(normalized_seconds / 60 / 60).toFixed(2)} H`
}

function format_compact_number(value: number): string {
  if (value < 1000) {
    return value.toFixed(0)
  }

  if (value < 1000 * 1000) {
    return `${(value / 1000).toFixed(2)}K`
  }

  return `${(value / 1000 / 1000).toFixed(2)}M`
}

function format_speed(value: number): string {
  if (value < 1000) {
    return `${value.toFixed(2)} T/S`
  }

  return `${(value / 1000).toFixed(2)} KT/S`
}

function resolve_status_copy(
  metrics: ProofreadingTranslationTaskMetrics,
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

function build_metric_entries(
  metrics: ProofreadingTranslationTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): MetricEntry[] {
  return [
    {
      key: 'elapsed',
      label: t('proofreading_page.task.detail.elapsed_time'),
      value: format_duration(metrics.elapsed_seconds),
    },
    {
      key: 'remaining-time',
      label: t('proofreading_page.task.detail.remaining_time'),
      value: format_duration(metrics.remaining_seconds),
    },
    {
      key: 'processed',
      label: t('proofreading_page.task.detail.processed_count'),
      value: format_compact_number(metrics.processed_count),
    },
    {
      key: 'failed',
      label: t('proofreading_page.task.detail.failed_count'),
      value: format_compact_number(metrics.failed_count),
    },
    {
      key: 'remaining',
      label: t('proofreading_page.task.detail.remaining_count'),
      value: format_compact_number(metrics.remaining_count),
    },
    {
      key: 'speed',
      label: t('proofreading_page.task.detail.average_speed'),
      value: format_speed(metrics.average_output_speed),
    },
    {
      key: 'input-tokens',
      label: t('proofreading_page.task.detail.input_tokens'),
      value: format_compact_number(metrics.input_tokens),
    },
    {
      key: 'output-tokens',
      label: t('proofreading_page.task.detail.output_tokens'),
      value: format_compact_number(metrics.output_tokens),
    },
    {
      key: 'active-requests',
      label: t('proofreading_page.task.detail.active_requests'),
      value: format_compact_number(metrics.request_in_flight_count),
    },
  ]
}

function TaskProgressRing(props: {
  percent: number
  status_label: string
}): JSX.Element {
  const ring_radius = 54
  const ring_circumference = Math.PI * 2 * ring_radius
  const progress_ratio = Math.min(1, Math.max(0, props.percent / 100))
  const progress_offset = ring_circumference * (1 - progress_ratio)

  return (
    <div className="proofreading-page__task-ring">
      <svg
        viewBox="0 0 140 140"
        className="proofreading-page__task-ring-svg"
        aria-hidden="true"
      >
        <circle
          cx="70"
          cy="70"
          r={ring_radius}
          className="proofreading-page__task-ring-track"
        />
        <circle
          cx="70"
          cy="70"
          r={ring_radius}
          className="proofreading-page__task-ring-indicator"
          strokeDasharray={ring_circumference}
          strokeDashoffset={progress_offset}
        />
      </svg>
      <div className="proofreading-page__task-ring-copy">
        <span className="proofreading-page__task-ring-status">{props.status_label}</span>
        <strong className="proofreading-page__task-ring-percent">
          {props.percent.toFixed(2)}
          %
        </strong>
      </div>
    </div>
  )
}

function TaskWaveform(props: {
  history: number[]
  speed_value: number
}): JSX.Element {
  const has_history = props.history.length >= 2
  const values = has_history
    ? props.history
    : [props.speed_value, props.speed_value, props.speed_value]
  const max_value = Math.max(1, ...values)
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
    const y = 92 - (value / max_value) * 68
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="proofreading-page__task-waveform">
      <div className="proofreading-page__task-waveform-head">
        <span className="proofreading-page__task-waveform-title">
          <Activity />
          {format_speed(props.speed_value)}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="proofreading-page__task-waveform-svg"
        aria-hidden="true"
      >
        <polyline
          points={points}
          className="proofreading-page__task-waveform-line"
        />
      </svg>
    </div>
  )
}

export function ProofreadingTaskDetailSheet(
  props: ProofreadingTaskDetailSheetProps,
): JSX.Element {
  const { t } = useI18n()
  const status_copy = resolve_status_copy(
    props.translation_task_metrics,
    t,
  )
  const metric_entries = build_metric_entries(props.translation_task_metrics, t)
  const stop_disabled = !props.translation_task_metrics.active || props.translation_task_metrics.stopping

  return (
    <Sheet
      open={props.open}
      onOpenChange={(next_open) => {
        if (!next_open) {
          props.on_close()
        }
      }}
    >
      <SheetContent
        side="right"
        className="proofreading-page__task-sheet"
      >
        <SheetHeader className="proofreading-page__task-sheet-header sr-only">
          <SheetTitle>{t('proofreading_page.task.detail.title')}</SheetTitle>
          <SheetDescription>{t('proofreading_page.task.detail.description')}</SheetDescription>
        </SheetHeader>

        <div className="proofreading-page__task-sheet-body">
          <section className="proofreading-page__task-section">
            <div className="proofreading-page__task-summary-head">
              <span className="proofreading-page__task-status-pill">{status_copy}</span>
              <span className="proofreading-page__task-percent-pill">
                {props.translation_task_metrics.completion_percent.toFixed(2)}
                %
              </span>
            </div>
            <div className="proofreading-page__task-summary-stats-grid">
              <div className="proofreading-page__task-summary-stat">
                <span>{t('proofreading_page.task.summary.success')}</span>
                <strong>{format_compact_number(props.translation_task_metrics.success_count)}</strong>
              </div>
              <div className="proofreading-page__task-summary-stat">
                <span>{t('proofreading_page.task.summary.failed')}</span>
                <strong>{format_compact_number(props.translation_task_metrics.failed_count)}</strong>
              </div>
            </div>
          </section>

          <section className="proofreading-page__task-chart-grid">
            <div className="proofreading-page__task-section proofreading-page__task-section--ring">
              <div className="proofreading-page__task-section-head">
                <h3 className="proofreading-page__task-section-title">
                  {t('proofreading_page.task.detail.progress_title')}
                </h3>
              </div>
              <TaskProgressRing
                percent={props.translation_task_metrics.completion_percent}
                status_label={status_copy}
              />
            </div>

            <div className="proofreading-page__task-section proofreading-page__task-section--waveform">
              <div className="proofreading-page__task-section-head">
                <h3 className="proofreading-page__task-section-title">
                  {t('proofreading_page.task.detail.waveform_title')}
                </h3>
                {t('proofreading_page.task.detail.waveform_description') === ''
                  ? null
                  : (
                      <p className="proofreading-page__task-section-description">
                        {t('proofreading_page.task.detail.waveform_description')}
                      </p>
                    )}
              </div>
              <TaskWaveform
                history={props.translation_waveform_history}
                speed_value={props.translation_task_metrics.average_output_speed}
              />
            </div>
          </section>

          <section className="proofreading-page__task-section proofreading-page__task-section--metrics">
            <div className="proofreading-page__task-section-head">
              <h3 className="proofreading-page__task-section-title">
                {t('proofreading_page.task.detail.metrics_title')}
              </h3>
            </div>
            <div className="proofreading-page__task-metrics-grid">
              {metric_entries.map((entry) => (
                <article key={entry.key} className="proofreading-page__task-metric">
                  <span className="proofreading-page__task-metric-label">{entry.label}</span>
                  <strong className="proofreading-page__task-metric-value">{entry.value}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="proofreading-page__task-sheet-footer">
          <Button
            type="button"
            variant="destructive"
            disabled={stop_disabled}
            onClick={props.on_request_stop_confirmation}
          >
            <CircleStop data-icon="inline-start" />
            {props.translation_task_metrics.stopping
              ? t('proofreading_page.action.stopping')
              : t('proofreading_page.action.stop_translation')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
