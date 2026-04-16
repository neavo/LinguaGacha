import { useEffect, useMemo, useRef } from 'react'
import { CircleStop } from 'lucide-react'

import '@/widgets/translation-task/translation-task.css'
import { useI18n } from '@/i18n'
import type { TranslationTaskMetrics } from '@/lib/translation-task'
import { Button } from '@/shadcn/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shadcn/sheet'

type TranslationTaskDetailSheetProps = {
  open: boolean
  translation_task_metrics: TranslationTaskMetrics
  translation_waveform_history: number[]
  on_close: () => void
  on_request_stop_confirmation: () => void
}

type MetricEntry = {
  key: string
  label: string
  value_text: string
  unit_text: string
}

const WAVEFORM_COLUMN_COUNT = 96
const WAVEFORM_ROW_COUNT = 24
const WAVEFORM_COLUMN_STEP_PX = 5
const WAVEFORM_ROW_STEP_PX = 4
const WAVEFORM_FONT_SIZE_PX = 6
const WAVEFORM_CANVAS_WIDTH = WAVEFORM_COLUMN_COUNT * WAVEFORM_COLUMN_STEP_PX
const WAVEFORM_CANVAS_HEIGHT = WAVEFORM_ROW_COUNT * WAVEFORM_ROW_STEP_PX

function format_duration_value(seconds: number): Pick<MetricEntry, 'value_text' | 'unit_text'> {
  const normalized_seconds = Math.max(0, Math.floor(seconds))

  if (normalized_seconds < 60) {
    return {
      value_text: normalized_seconds.toString(),
      unit_text: 'S',
    }
  }

  if (normalized_seconds < 60 * 60) {
    return {
      value_text: (normalized_seconds / 60).toFixed(2),
      unit_text: 'M',
    }
  }

  return {
    value_text: (normalized_seconds / 60 / 60).toFixed(2),
    unit_text: 'H',
  }
}

function format_compact_metric_value(
  value: number,
  base_unit: string,
): Pick<MetricEntry, 'value_text' | 'unit_text'> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(0),
      unit_text: base_unit,
    }
  }

  if (value < 1000 * 1000) {
    return {
      value_text: (value / 1000).toFixed(2),
      unit_text: `K${base_unit}`,
    }
  }

  return {
    value_text: (value / 1000 / 1000).toFixed(2),
    unit_text: `M${base_unit}`,
  }
}

function format_speed_value(value: number): Pick<MetricEntry, 'value_text' | 'unit_text'> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(2),
      unit_text: 'T/S',
    }
  }

  return {
    value_text: (value / 1000).toFixed(2),
    unit_text: 'KT/S',
  }
}

function normalize_waveform_values(history: number[]): number[] {
  if (history.length === 0) {
    return [0]
  }

  const min_value = Math.min(...history)
  const max_value = Math.max(...history)

  if (max_value - min_value === 0 && history[0] === 0) {
    return history.map(() => 0)
  }

  if (max_value - min_value === 0 && history[0] !== 0) {
    return history.map(() => 1)
  }

  return history.map((value) => {
    return (value - min_value) / (max_value - min_value)
  })
}

function build_waveform_columns(history: number[]): number[] {
  if (history.length === 0) {
    return []
  }

  const visible_history = history.length >= WAVEFORM_COLUMN_COUNT
    ? history.slice(history.length - WAVEFORM_COLUMN_COUNT)
    : history
  const normalized_values = normalize_waveform_values(visible_history)

  return normalized_values.map((value) => {
    return Math.floor(value * (WAVEFORM_ROW_COUNT - 1) + 1)
  })
}

function build_metric_entries(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): MetricEntry[] {
  return [
    {
      key: 'elapsed',
      label: t('proofreading_page.task.detail.elapsed_time'),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: 'remaining-time',
      label: t('proofreading_page.task.detail.remaining_time'),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: 'speed',
      label: t('proofreading_page.task.detail.average_speed'),
      ...format_speed_value(metrics.average_output_speed),
    },
    {
      key: 'input-tokens',
      label: t('proofreading_page.task.detail.input_tokens'),
      ...format_compact_metric_value(metrics.input_tokens, 'T'),
    },
    {
      key: 'output-tokens',
      label: t('proofreading_page.task.detail.output_tokens'),
      ...format_compact_metric_value(metrics.output_tokens, 'T'),
    },
    {
      key: 'active-requests',
      label: t('proofreading_page.task.detail.active_requests'),
      ...format_compact_metric_value(metrics.request_in_flight_count, 'Task'),
    },
  ]
}

function TaskWaveform(props: {
  history: number[]
}): JSX.Element {
  const canvas_ref = useRef<HTMLCanvasElement | null>(null)

  const column_heights = useMemo(() => {
    return build_waveform_columns(props.history)
  }, [props.history])

  useEffect(() => {
    const canvas_element = canvas_ref.current
    if (canvas_element === null) {
      return
    }

    const context = canvas_element.getContext('2d')
    if (context === null) {
      return
    }

    const device_pixel_ratio = window.devicePixelRatio || 1
    canvas_element.width = Math.round(WAVEFORM_CANVAS_WIDTH * device_pixel_ratio)
    canvas_element.height = Math.round(WAVEFORM_CANVAS_HEIGHT * device_pixel_ratio)
    context.setTransform(device_pixel_ratio, 0, 0, device_pixel_ratio, 0, 0)
    context.clearRect(0, 0, WAVEFORM_CANVAS_WIDTH, WAVEFORM_CANVAS_HEIGHT)
    context.imageSmoothingEnabled = false
    context.font = `${WAVEFORM_FONT_SIZE_PX}px Consolas, "Cascadia Mono", "Courier New", monospace`
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'

    const computed_style = window.getComputedStyle(canvas_element)
    context.fillStyle = computed_style.color || '#6f5d3d'
    const x_offset = WAVEFORM_CANVAS_WIDTH - (column_heights.length * WAVEFORM_COLUMN_STEP_PX)
    const baseline_y = WAVEFORM_CANVAS_HEIGHT

    for (let column_index = 0; column_index < WAVEFORM_COLUMN_COUNT; column_index += 1) {
      const draw_x = (column_index * WAVEFORM_COLUMN_STEP_PX) + (WAVEFORM_COLUMN_STEP_PX / 2)
      context.fillText('▨', draw_x, baseline_y)
    }

    column_heights.forEach((column_height, column_index) => {
      const draw_x = x_offset + (column_index * WAVEFORM_COLUMN_STEP_PX) + (WAVEFORM_COLUMN_STEP_PX / 2)

      for (let row_index = 1; row_index < column_height; row_index += 1) {
        const draw_y = WAVEFORM_CANVAS_HEIGHT - (row_index * WAVEFORM_ROW_STEP_PX)
        context.fillText('▨', draw_x, draw_y)
      }
    })
  }, [column_heights])

  return (
    <div className="translation-task__waveform">
      <canvas
        ref={canvas_ref}
        className="translation-task__waveform-canvas"
        aria-hidden="true"
      />
    </div>
  )
}

export function TranslationTaskDetailSheet(
  props: TranslationTaskDetailSheetProps,
): JSX.Element {
  const { t } = useI18n()
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
        className="translation-task__sheet"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('proofreading_page.task.detail.title')}</SheetTitle>
          <SheetDescription>{t('proofreading_page.task.detail.description')}</SheetDescription>
        </SheetHeader>

        <div className="translation-task__sheet-body">
          <section className="translation-task__section">
            <div className="translation-task__section-head translation-task__section-head--inline">
              <h3 className="translation-task__section-title">
                {t('proofreading_page.task.detail.waveform_title')}
              </h3>
              <span className="translation-task__percent-pill">
                {props.translation_task_metrics.completion_percent.toFixed(2)}
                %
              </span>
            </div>
            <TaskWaveform
              history={props.translation_waveform_history}
            />
          </section>

          <section className="translation-task__section">
            <div className="translation-task__section-head">
              <h3 className="translation-task__section-title">
                {t('proofreading_page.task.detail.metrics_title')}
              </h3>
            </div>
            <div className="translation-task__metrics-grid">
              {metric_entries.map((entry) => (
                <article key={entry.key} className="translation-task__metric">
                  <div className="translation-task__metric-head">
                    <span className="translation-task__metric-label">{entry.label}</span>
                  </div>
                  <div className="translation-task__metric-main">
                    <span className="translation-task__metric-value">{entry.value_text}</span>
                    <span className="translation-task__metric-unit">{entry.unit_text}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="translation-task__sheet-footer">
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
