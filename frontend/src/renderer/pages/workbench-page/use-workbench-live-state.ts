import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import {
  useAnalysisTaskRuntime,
  type AnalysisTaskRuntime,
} from '@/app/state/use-analysis-task-runtime'
import {
  useTranslationTaskRuntime,
  type TranslationTaskRuntime,
} from '@/app/state/use-translation-task-runtime'
import type { LocaleKey } from '@/i18n'
import { useI18n } from '@/i18n'
import { api_fetch } from '@/app/desktop-api'
import type {
  AnalysisTaskConfirmState,
  AnalysisTaskMetrics,
} from '@/lib/analysis-task'
import type {
  TranslationTaskConfirmState,
  TranslationTaskMetrics,
} from '@/lib/translation-task'
import type {
  WorkbenchTaskConfirmDialogViewModel,
  WorkbenchTaskDetailViewModel,
  WorkbenchDialogState,
  WorkbenchFileEntry,
  WorkbenchTaskMetricEntry,
  WorkbenchSnapshot,
  WorkbenchSnapshotEntry,
  WorkbenchStats,
  WorkbenchTaskKind,
  WorkbenchTaskSummaryViewModel,
  WorkbenchTaskTone,
  WorkbenchTaskStatus,
  WorkbenchTaskViewState,
} from '@/pages/workbench-page/types'

type WorkbenchSnapshotPayload = {
  snapshot?: Partial<WorkbenchSnapshot> & {
    entries?: Array<Partial<WorkbenchSnapshotEntry>>
  }
}

const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  file_count: 0,
  total_items: 0,
  translated: 0,
  translated_in_past: 0,
  error_count: 0,
  file_op_running: false,
  entries: [],
}

function normalize_snapshot(payload: WorkbenchSnapshotPayload): WorkbenchSnapshot {
  const snapshot = payload.snapshot ?? {}
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
      .filter((entry) => typeof entry?.rel_path === 'string' && entry.rel_path !== '')
      .map((entry) => ({
        rel_path: String(entry.rel_path),
        file_type: String(entry.file_type ?? ''),
        item_count: Number(entry.item_count ?? 0),
      }))
    : []

  return {
    file_count: Number(snapshot.file_count ?? 0),
    total_items: Number(snapshot.total_items ?? 0),
    translated: Number(snapshot.translated ?? 0),
    translated_in_past: Number(snapshot.translated_in_past ?? 0),
    error_count: Number(snapshot.error_count ?? 0),
    file_op_running: Boolean(snapshot.file_op_running),
    entries,
  }
}

function close_dialog_state(): WorkbenchDialogState {
  return {
    kind: null,
    target_rel_path: null,
    pending_path: null,
  }
}

function resolve_format_label_key(file_type: string, rel_path: string): LocaleKey | null {
  // 为什么：同一工程在 Qt 与 Vite 两套前端里都要看到同一套格式名称，避免工作台口径漂移。
  if (file_type === 'MD') {
    return 'workbench_page.format.markdown'
  }
  if (file_type === 'RENPY') {
    return 'workbench_page.format.renpy'
  }
  if (file_type === 'KVJSON') {
    return 'workbench_page.format.mtool'
  }
  if (file_type === 'MESSAGEJSON') {
    return 'workbench_page.format.sextractor'
  }
  if (file_type === 'TRANS') {
    return 'workbench_page.format.trans_project'
  }
  if (file_type === 'XLSX') {
    return 'workbench_page.format.translation_export'
  }
  if (file_type === 'WOLFXLSX') {
    return 'workbench_page.format.wolf'
  }
  if (file_type === 'EPUB') {
    return 'workbench_page.format.ebook'
  }

  const lowered_path = rel_path.toLowerCase()
  if (lowered_path.endsWith('.txt')) {
    return 'workbench_page.format.text_file'
  }
  if (lowered_path.endsWith('.srt') || lowered_path.endsWith('.ass')) {
    return 'workbench_page.format.subtitle_file'
  }

  return null
}

function resolve_format_fallback_label(file_type: string, rel_path: string): string | null {
  const format_label_key = resolve_format_label_key(file_type, rel_path)
  if (format_label_key !== null) {
    return null
  }

  const dot_index = rel_path.lastIndexOf('.')
  if (dot_index < 0) {
    return file_type === '' ? '-' : file_type
  }

  return rel_path.slice(dot_index + 1).toUpperCase()
}

function map_snapshot_entries(entries: WorkbenchSnapshotEntry[]): WorkbenchFileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    format_label_key: resolve_format_label_key(entry.file_type, entry.rel_path),
    format_fallback_label: resolve_format_fallback_label(entry.file_type, entry.rel_path),
  }))
}

function build_stats(
  snapshot: WorkbenchSnapshot,
  translation_active: boolean,
  translated: number,
  error_count: number,
): WorkbenchStats {
  const translated_count = translation_active
    ? Math.min(snapshot.total_items, translated)
    : snapshot.translated
  const error_total = translation_active
    ? Math.min(snapshot.total_items, error_count)
    : snapshot.error_count

  return {
    total_items: snapshot.total_items,
    translated: translated_count,
    error_count: error_total,
    untranslated: Math.max(0, snapshot.total_items - translated_count - error_total),
  }
}

function build_replace_target_rel_path(previous_rel_path: string, next_file_path: string): string {
  const normalized_segments = next_file_path.split(/[\\/]+/u)
  const next_file_name = normalized_segments.at(-1) ?? next_file_path
  const separator_index = Math.max(previous_rel_path.lastIndexOf('/'), previous_rel_path.lastIndexOf('\\'))
  if (separator_index < 0) {
    return next_file_name
  }

  return `${previous_rel_path.slice(0, separator_index + 1)}${next_file_name}`
}

function select_after_snapshot(
  previous_entries: WorkbenchFileEntry[],
  next_entries: WorkbenchFileEntry[],
  selected_rel_path: string | null,
): string | null {
  if (next_entries.length === 0) {
    return null
  }

  if (selected_rel_path !== null && next_entries.some((entry) => entry.rel_path === selected_rel_path)) {
    return selected_rel_path
  }

  if (selected_rel_path !== null) {
    const previous_index = previous_entries.findIndex((entry) => entry.rel_path === selected_rel_path)
    if (previous_index >= 0) {
      const safe_index = Math.min(previous_index, next_entries.length - 1)
      return next_entries[safe_index]?.rel_path ?? null
    }
  }

  return next_entries[0]?.rel_path ?? null
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function is_workbench_task_kind(value: string): value is WorkbenchTaskKind {
  return value === 'translation' || value === 'analysis'
}

function resolve_active_workbench_task_kind(args: {
  running_task_kind: WorkbenchTaskKind | null
  recent_task_kind: WorkbenchTaskKind | null
  fallback_task_kind: WorkbenchTaskKind | null
  has_translation_display: boolean
  has_analysis_display: boolean
}): WorkbenchTaskKind | null {
  if (args.running_task_kind !== null) {
    return args.running_task_kind
  }

  if (args.recent_task_kind === 'translation' && args.has_translation_display) {
    return 'translation'
  }
  if (args.recent_task_kind === 'analysis' && args.has_analysis_display) {
    return 'analysis'
  }

  if (args.has_translation_display && !args.has_analysis_display) {
    return 'translation'
  }
  if (args.has_analysis_display && !args.has_translation_display) {
    return 'analysis'
  }

  if (
    args.fallback_task_kind !== null
    && ((args.fallback_task_kind === 'translation' && args.has_translation_display)
      || (args.fallback_task_kind === 'analysis' && args.has_analysis_display))
  ) {
    return args.fallback_task_kind
  }

  return null
}

function format_duration_value(seconds: number): Pick<WorkbenchTaskMetricEntry, 'value_text' | 'unit_text'> {
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
): Pick<WorkbenchTaskMetricEntry, 'value_text' | 'unit_text'> {
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

function format_speed_value(value: number): Pick<WorkbenchTaskMetricEntry, 'value_text' | 'unit_text'> {
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

function format_summary_speed(value: number): string {
  const metric_value = format_speed_value(value)
  return `${metric_value.value_text} ${metric_value.unit_text}`
}

function resolve_task_tone(args: {
  active: boolean
  stopping: boolean
  emphasized_when_idle?: boolean
}): WorkbenchTaskTone {
  if (args.stopping) {
    return 'warning'
  }

  if (args.active || args.emphasized_when_idle) {
    return 'success'
  }

  return 'neutral'
}

function resolve_percent_tone(metrics: Pick<TranslationTaskMetrics, 'active' | 'stopping'>): WorkbenchTaskTone {
  return resolve_task_tone({
    active: metrics.active,
    stopping: metrics.stopping,
  })
}

function build_translation_task_metric_entries(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskMetricEntry[] {
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

function build_analysis_task_metric_entries(
  metrics: AnalysisTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskMetricEntry[] {
  return [
    {
      key: 'elapsed',
      label: t('workbench_page.analysis_task.detail.elapsed_time'),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: 'remaining-time',
      label: t('workbench_page.analysis_task.detail.remaining_time'),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: 'speed',
      label: t('workbench_page.analysis_task.detail.average_speed'),
      ...format_speed_value(metrics.average_output_speed),
    },
    {
      key: 'input-tokens',
      label: t('workbench_page.analysis_task.detail.input_tokens'),
      ...format_compact_metric_value(metrics.input_tokens, 'T'),
    },
    {
      key: 'output-tokens',
      label: t('workbench_page.analysis_task.detail.output_tokens'),
      ...format_compact_metric_value(metrics.output_tokens, 'T'),
    },
    {
      key: 'active-requests',
      label: t('workbench_page.analysis_task.detail.active_requests'),
      ...format_compact_metric_value(metrics.request_in_flight_count, 'Task'),
    },
    {
      key: 'candidate-count',
      label: t('workbench_page.analysis_task.detail.candidate_count'),
      ...format_compact_metric_value(metrics.candidate_count, 'Term'),
    },
  ]
}

function build_empty_task_summary_view_model(
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskSummaryViewModel {
  return {
    status_text: t('proofreading_page.task.summary.empty'),
    trailing_text: null,
    tone: 'neutral',
    show_spinner: false,
    detail_tooltip_text: '',
  }
}

function build_translation_task_summary_view_model(
  metrics: TranslationTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskSummaryViewModel {
  let status_text = t('proofreading_page.task.summary.empty')
  if (metrics.stopping) {
    status_text = t('proofreading_page.task.summary.stopping')
  } else if (metrics.active) {
    status_text = t('proofreading_page.task.summary.running')
  }

  const show_runtime = metrics.active || metrics.stopping

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_output_speed) : null,
    tone: resolve_task_tone({
      active: metrics.active,
      stopping: metrics.stopping,
    }),
    show_spinner: show_runtime,
    detail_tooltip_text: t('proofreading_page.task.summary.detail_tooltip'),
  }
}

function build_analysis_task_summary_view_model(
  metrics: AnalysisTaskMetrics,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskSummaryViewModel {
  let status_text = t('proofreading_page.task.summary.empty')
  if (metrics.stopping) {
    status_text = t('workbench_page.analysis_task.summary.stopping')
  } else if (metrics.active) {
    status_text = t('workbench_page.analysis_task.summary.running')
  }
  const show_runtime = metrics.active || metrics.stopping

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_output_speed) : null,
    tone: resolve_task_tone({
      active: metrics.active,
      stopping: metrics.stopping,
    }),
    show_spinner: show_runtime,
    detail_tooltip_text: t('workbench_page.analysis_task.summary.detail_tooltip'),
  }
}

function build_translation_task_detail_view_model(args: {
  metrics: TranslationTaskMetrics
  waveform_history: number[]
  t: ReturnType<typeof useI18n>['t']
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t('proofreading_page.task.detail.title'),
    description: args.t('proofreading_page.task.detail.description'),
    waveform_title: args.t('proofreading_page.task.detail.waveform_title'),
    metrics_title: args.t('proofreading_page.task.detail.metrics_title'),
    completion_percent_text: `${args.metrics.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t('proofreading_page.action.stopping')
      : args.t('proofreading_page.action.stop_translation'),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  }
}

function build_analysis_task_detail_view_model(args: {
  metrics: AnalysisTaskMetrics
  waveform_history: number[]
  t: ReturnType<typeof useI18n>['t']
}): WorkbenchTaskDetailViewModel {
  return {
    title: args.t('workbench_page.analysis_task.detail.title'),
    description: args.t('workbench_page.analysis_task.detail.description'),
    waveform_title: args.t('workbench_page.analysis_task.detail.waveform_title'),
    metrics_title: args.t('workbench_page.analysis_task.detail.metrics_title'),
    completion_percent_text: `${args.metrics.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_percent_tone(args.metrics),
    metric_entries: build_analysis_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t('workbench_page.action.analysis_stopping')
      : args.t('workbench_page.action.stop_analysis'),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  }
}

function build_translation_task_confirm_dialog_view_model(
  state: TranslationTaskConfirmState | null,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskConfirmDialogViewModel | null {
  if (state === null) {
    return null
  }

  if (state.kind === 'reset-all') {
    return {
      open: state.open,
      title: t('proofreading_page.task.confirm.reset_all_title'),
      description: t('proofreading_page.task.confirm.reset_all_description'),
      confirm_label: t('proofreading_page.action.reset_translation_all'),
      cancel_label: t('proofreading_page.action.cancel'),
      submitting: state.submitting,
    }
  }

  if (state.kind === 'reset-failed') {
    return {
      open: state.open,
      title: t('proofreading_page.task.confirm.reset_failed_title'),
      description: t('proofreading_page.task.confirm.reset_failed_description'),
      confirm_label: t('proofreading_page.action.reset_translation_failed'),
      cancel_label: t('proofreading_page.action.cancel'),
      submitting: state.submitting,
    }
  }

  return {
    open: state.open,
    title: t('proofreading_page.task.confirm.stop_title'),
    description: t('proofreading_page.task.confirm.stop_description'),
    confirm_label: t('proofreading_page.action.stop_translation'),
    cancel_label: t('proofreading_page.action.cancel'),
    submitting: state.submitting,
  }
}

function build_analysis_task_confirm_dialog_view_model(
  state: AnalysisTaskConfirmState | null,
  t: ReturnType<typeof useI18n>['t'],
): WorkbenchTaskConfirmDialogViewModel | null {
  if (state === null) {
    return null
  }

  if (state.kind === 'reset-all') {
    return {
      open: state.open,
      title: t('workbench_page.analysis_task.confirm.reset_all_title'),
      description: t('workbench_page.analysis_task.confirm.reset_all_description'),
      confirm_label: t('workbench_page.action.reset_analysis_all'),
      cancel_label: t('app.action.cancel'),
      submitting: state.submitting,
    }
  }

  if (state.kind === 'reset-failed') {
    return {
      open: state.open,
      title: t('workbench_page.analysis_task.confirm.reset_failed_title'),
      description: t('workbench_page.analysis_task.confirm.reset_failed_description'),
      confirm_label: t('workbench_page.action.reset_analysis_failed'),
      cancel_label: t('app.action.cancel'),
      submitting: state.submitting,
    }
  }

  return {
    open: state.open,
    title: t('workbench_page.analysis_task.confirm.stop_title'),
    description: t('workbench_page.analysis_task.confirm.stop_description'),
    confirm_label: t('workbench_page.action.stop_analysis'),
    cancel_label: t('app.action.cancel'),
    submitting: state.submitting,
  }
}

type UseWorkbenchLiveStateResult = {
  stats: WorkbenchStats
  translation_task_runtime: TranslationTaskRuntime
  analysis_task_runtime: AnalysisTaskRuntime
  active_workbench_task_view: WorkbenchTaskViewState
  active_workbench_task_summary: WorkbenchTaskSummaryViewModel
  active_workbench_task_detail: WorkbenchTaskDetailViewModel | null
  translation_task_confirm_dialog: WorkbenchTaskConfirmDialogViewModel | null
  analysis_task_confirm_dialog: WorkbenchTaskConfirmDialogViewModel | null
  entries: WorkbenchFileEntry[]
  selected_entry_id: string | null
  readonly: boolean
  can_edit_files: boolean
  can_export_translation: boolean
  can_close_project: boolean
  dialog_state: WorkbenchDialogState
  select_entry: (entry_id: string) => void
  request_add_file: () => Promise<void>
  request_export_translation: () => void
  request_close_project: () => void
  request_reset_file: (entry_id: string) => void
  request_delete_file: (entry_id: string) => void
  request_replace_file: (entry_id: string) => Promise<void>
  request_reorder_entries: (ordered_entry_ids: string[]) => Promise<void>
  confirm_dialog: () => Promise<void>
  close_dialog: () => void
}

export function useWorkbenchLiveState(): UseWorkbenchLiveStateResult {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const raw_translation_task_runtime = useTranslationTaskRuntime()
  const raw_analysis_task_runtime = useAnalysisTaskRuntime()
  const {
    project_snapshot,
    proofreading_invalidation_tick,
    refresh_task,
    set_project_snapshot,
    task_snapshot,
  } = useDesktopRuntime()
  const [snapshot, set_snapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT)
  const [entries, set_entries] = useState<WorkbenchFileEntry[]>([])
  const [selected_entry_id, set_selected_entry_id] = useState<string | null>(null)
  const [dialog_state, set_dialog_state] = useState<WorkbenchDialogState>(close_dialog_state())
  const [is_mutation_running, set_is_mutation_running] = useState(false)
  const [recent_workbench_task_kind, set_recent_workbench_task_kind] = useState<WorkbenchTaskKind | null>(null)
  const previous_task_status_ref = useRef<WorkbenchTaskStatus>(task_snapshot.status)
  const previous_invalidation_tick_ref = useRef(proofreading_invalidation_tick)
  const previous_project_loaded_ref = useRef(project_snapshot.loaded)
  const previous_project_path_ref = useRef(project_snapshot.path)
  const is_reorder_running_ref = useRef(false)

  const refresh_snapshot = useCallback(async (): Promise<WorkbenchSnapshot> => {
    if (!project_snapshot.loaded) {
      set_snapshot(EMPTY_SNAPSHOT)
      set_entries([])
      set_selected_entry_id(null)
      return EMPTY_SNAPSHOT
    }

    const payload = await api_fetch<WorkbenchSnapshotPayload>('/api/workbench/snapshot', {})
    const next_snapshot = normalize_snapshot(payload)
    set_snapshot(next_snapshot)
    return next_snapshot
  }, [project_snapshot.loaded])

  useEffect(() => {
    let cancelled = false

    async function load_workbench_data(): Promise<void> {
      if (!project_snapshot.loaded) {
        set_snapshot(EMPTY_SNAPSHOT)
        set_entries([])
        set_selected_entry_id(null)
        set_dialog_state(close_dialog_state())
        return
      }

      try {
        const next_snapshot = await refresh_snapshot()
        if (cancelled) {
          return
        }

        const mapped_entries = map_snapshot_entries(next_snapshot.entries)
        set_entries(mapped_entries)
        set_selected_entry_id((previous_entry_id) => select_after_snapshot([], mapped_entries, previous_entry_id))
      } catch {
        if (!cancelled) {
          set_snapshot(EMPTY_SNAPSHOT)
          set_entries([])
          set_selected_entry_id(null)
        }
      }
    }

    void load_workbench_data()

    return () => {
      cancelled = true
    }
  }, [project_snapshot.loaded, refresh_snapshot])

  useEffect(() => {
    const previous_status = previous_task_status_ref.current
    previous_task_status_ref.current = task_snapshot.status

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_status !== task_snapshot.status && previous_status !== 'IDLE' && !task_snapshot.busy) {
      void refresh_snapshot()
    }
  }, [project_snapshot.loaded, refresh_snapshot, task_snapshot.busy, task_snapshot.status])

  useEffect(() => {
    const previous_tick = previous_invalidation_tick_ref.current
    previous_invalidation_tick_ref.current = proofreading_invalidation_tick

    if (!project_snapshot.loaded) {
      return
    }

    // 为什么：翻译重置和工作台快照失效都会走同一条 invalidation tick；
    // 工作台不订阅这里的话，顶部统计卡片会停留在旧快照。
    if (previous_tick !== proofreading_invalidation_tick) {
      void refresh_snapshot()
    }
  }, [
    project_snapshot.loaded,
    proofreading_invalidation_tick,
    refresh_snapshot,
  ])

  useEffect(() => {
    set_selected_entry_id((previous_entry_id) => select_after_snapshot(entries, entries, previous_entry_id))
  }, [entries])

  useEffect(() => {
    if (is_reorder_running_ref.current) {
      return
    }

    set_entries(map_snapshot_entries(snapshot.entries))
  }, [snapshot.entries])

  const stats = useMemo(() => {
    return build_stats(
      snapshot,
      raw_translation_task_runtime.translation_task_metrics.active,
      raw_translation_task_runtime.translation_task_metrics.processed_count,
      raw_translation_task_runtime.translation_task_metrics.failed_count,
    )
  }, [
    snapshot,
    raw_translation_task_runtime.translation_task_metrics.active,
    raw_translation_task_runtime.translation_task_metrics.failed_count,
    raw_translation_task_runtime.translation_task_metrics.processed_count,
  ])

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current
    const previous_project_path = previous_project_path_ref.current

    previous_project_loaded_ref.current = project_snapshot.loaded
    previous_project_path_ref.current = project_snapshot.path

    if (!project_snapshot.loaded) {
      set_recent_workbench_task_kind(null)
      return
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      set_recent_workbench_task_kind(null)
    }
  }, [project_snapshot.loaded, project_snapshot.path])

  const running_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    if (!task_snapshot.busy) {
      return null
    }

    if (is_workbench_task_kind(task_snapshot.task_type)) {
      return task_snapshot.task_type
    }

    return null
  }, [task_snapshot.busy, task_snapshot.task_type])

  const fallback_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    if (is_workbench_task_kind(task_snapshot.task_type)) {
      return task_snapshot.task_type
    }

    return null
  }, [task_snapshot.task_type])

  const has_translation_display = raw_translation_task_runtime.translation_task_display_snapshot !== null
  const has_analysis_display = raw_analysis_task_runtime.analysis_task_display_snapshot !== null

  const active_workbench_task_kind = useMemo<WorkbenchTaskKind | null>(() => {
    return resolve_active_workbench_task_kind({
      running_task_kind: running_workbench_task_kind,
      recent_task_kind: recent_workbench_task_kind,
      fallback_task_kind: fallback_workbench_task_kind,
      has_translation_display,
      has_analysis_display,
    })
  }, [
    fallback_workbench_task_kind,
    has_analysis_display,
    has_translation_display,
    recent_workbench_task_kind,
    running_workbench_task_kind,
  ])

  const active_workbench_task_view = useMemo<WorkbenchTaskViewState>(() => {
    return {
      task_kind: active_workbench_task_kind,
      can_open_detail: active_workbench_task_kind !== null,
    }
  }, [active_workbench_task_kind])

  const active_workbench_task_summary = useMemo<WorkbenchTaskSummaryViewModel>(() => {
    if (active_workbench_task_kind === 'translation') {
      return build_translation_task_summary_view_model(
        raw_translation_task_runtime.translation_task_metrics,
        t,
      )
    }

    if (active_workbench_task_kind === 'analysis') {
      return build_analysis_task_summary_view_model(
        raw_analysis_task_runtime.analysis_task_metrics,
        t,
      )
    }

    return build_empty_task_summary_view_model(t)
  }, [
    active_workbench_task_kind,
    raw_analysis_task_runtime.analysis_task_metrics,
    raw_translation_task_runtime.translation_task_metrics,
    t,
  ])

  const active_workbench_task_detail = useMemo<WorkbenchTaskDetailViewModel | null>(() => {
    if (active_workbench_task_kind === 'translation') {
      return build_translation_task_detail_view_model({
        metrics: raw_translation_task_runtime.translation_task_metrics,
        waveform_history: raw_translation_task_runtime.translation_waveform_history,
        t,
      })
    }

    if (active_workbench_task_kind === 'analysis') {
      return build_analysis_task_detail_view_model({
        metrics: raw_analysis_task_runtime.analysis_task_metrics,
        waveform_history: raw_analysis_task_runtime.analysis_waveform_history,
        t,
      })
    }

    return null
  }, [
    active_workbench_task_kind,
    raw_analysis_task_runtime.analysis_task_metrics,
    raw_analysis_task_runtime.analysis_waveform_history,
    raw_translation_task_runtime.translation_task_metrics,
    raw_translation_task_runtime.translation_waveform_history,
    t,
  ])

  const translation_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
    return build_translation_task_confirm_dialog_view_model(
      raw_translation_task_runtime.task_confirm_state,
      t,
    )
  }, [raw_translation_task_runtime.task_confirm_state, t])

  const analysis_task_confirm_dialog = useMemo<WorkbenchTaskConfirmDialogViewModel | null>(() => {
    return build_analysis_task_confirm_dialog_view_model(
      raw_analysis_task_runtime.analysis_confirm_state,
      t,
    )
  }, [raw_analysis_task_runtime.analysis_confirm_state, t])

  useEffect(() => {
    if (running_workbench_task_kind !== null) {
      set_recent_workbench_task_kind(running_workbench_task_kind)
    }
  }, [running_workbench_task_kind])

  useEffect(() => {
    if (active_workbench_task_view.task_kind === 'translation') {
      raw_analysis_task_runtime.close_analysis_detail_sheet()
      return
    }

    if (active_workbench_task_view.task_kind === 'analysis') {
      raw_translation_task_runtime.close_translation_detail_sheet()
      return
    }

    raw_translation_task_runtime.close_translation_detail_sheet()
    raw_analysis_task_runtime.close_analysis_detail_sheet()
  }, [
    active_workbench_task_view.task_kind,
    raw_analysis_task_runtime,
    raw_translation_task_runtime,
  ])

  const readonly = !project_snapshot.loaded || task_snapshot.busy || snapshot.file_op_running || is_mutation_running
  const can_edit_files = !readonly
  const can_export_translation = project_snapshot.loaded && !snapshot.file_op_running && !is_mutation_running
  const can_close_project = project_snapshot.loaded && !task_snapshot.busy && !is_mutation_running

  const run_file_mutation = useCallback(async (
    action: () => Promise<void>,
    preferred_rel_path: string | null,
  ): Promise<void> => {
    const previous_entries = entries
    set_is_mutation_running(true)

    try {
      await action()
      let next_snapshot = await refresh_snapshot()

      while (next_snapshot.file_op_running) {
        await delay(500)
        next_snapshot = await refresh_snapshot()
      }

      const next_entries = map_snapshot_entries(next_snapshot.entries)
      set_entries(next_entries)
      set_selected_entry_id(select_after_snapshot(previous_entries, next_entries, preferred_rel_path))
      await raw_analysis_task_runtime.refresh_analysis_task_snapshot()
    } catch {
      return
    } finally {
      set_is_mutation_running(false)
    }
  }, [entries, raw_analysis_task_runtime, refresh_snapshot])

  function select_entry(entry_id: string): void {
    set_selected_entry_id(entry_id)
  }

  async function request_add_file(): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    const next_selected_rel_path = result.path.split(/[\\/]+/u).at(-1) ?? null
    await run_file_mutation(async () => {
      await api_fetch('/api/workbench/add-file', { path: result.path })
    }, next_selected_rel_path)
  }

  function request_export_translation(): void {
    set_dialog_state({
      kind: 'export-translation',
      target_rel_path: null,
      pending_path: null,
    })
  }

  function request_close_project(): void {
    set_dialog_state({
      kind: 'close-project',
      target_rel_path: null,
      pending_path: null,
    })
  }

  function request_reset_file(entry_id: string): void {
    set_dialog_state({
      kind: 'reset-file',
      target_rel_path: entry_id,
      pending_path: null,
    })
  }

  function request_delete_file(entry_id: string): void {
    set_dialog_state({
      kind: 'delete-file',
      target_rel_path: entry_id,
      pending_path: null,
    })
  }

  async function request_replace_file(entry_id: string): Promise<void> {
    const result = await window.desktopApp.pickWorkbenchFilePath()
    if (result.canceled || result.path === null) {
      return
    }

    set_dialog_state({
      kind: 'replace-file',
      target_rel_path: entry_id,
      pending_path: result.path,
    })
  }

  const request_reorder_entries = useCallback(async (ordered_entry_ids: string[]): Promise<void> => {
    if (readonly) {
      return
    }

    if (ordered_entry_ids.length !== entries.length) {
      return
    }
    if (new Set(ordered_entry_ids).size !== ordered_entry_ids.length) {
      return
    }

    const entry_map = new Map(entries.map((entry) => [entry.rel_path, entry]))
    const next_entries: WorkbenchFileEntry[] = []
    for (const entry_id of ordered_entry_ids) {
      const entry = entry_map.get(entry_id)
      if (entry === undefined) {
        return
      }
      next_entries.push(entry)
    }

    if (next_entries.length !== entries.length) {
      return
    }

    const previous_entries = entries
    is_reorder_running_ref.current = true
    set_is_mutation_running(true)
    set_entries(next_entries)

    try {
      await api_fetch('/api/workbench/reorder-files', {
        ordered_rel_paths: ordered_entry_ids,
      })

      try {
        const next_snapshot = await refresh_snapshot()
        set_entries(map_snapshot_entries(next_snapshot.entries))
      } catch {
        set_entries(next_entries)
      }
    } catch {
      set_entries(previous_entries)
      push_toast('error', t('workbench_page.reorder.failed'))
    } finally {
      is_reorder_running_ref.current = false
      set_is_mutation_running(false)
    }
  }, [entries, push_toast, readonly, refresh_snapshot, t])

  async function confirm_dialog(): Promise<void> {
    const current_dialog_state = dialog_state
    set_dialog_state(close_dialog_state())

    if (current_dialog_state.kind === 'replace-file') {
      if (current_dialog_state.target_rel_path === null || current_dialog_state.pending_path === null) {
        return
      }

      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/replace-file', {
          rel_path: current_dialog_state.target_rel_path,
          path: current_dialog_state.pending_path,
        })
      }, build_replace_target_rel_path(current_dialog_state.target_rel_path, current_dialog_state.pending_path))
      return
    }

    if (current_dialog_state.kind === 'reset-file' && current_dialog_state.target_rel_path !== null) {
      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/reset-file', {
          rel_path: current_dialog_state.target_rel_path,
        })
      }, current_dialog_state.target_rel_path)
      return
    }

    if (current_dialog_state.kind === 'delete-file' && current_dialog_state.target_rel_path !== null) {
      await run_file_mutation(async () => {
        await api_fetch('/api/workbench/delete-file', {
          rel_path: current_dialog_state.target_rel_path,
        })
      }, selected_entry_id === current_dialog_state.target_rel_path ? null : selected_entry_id)
      return
    }

    if (current_dialog_state.kind === 'export-translation') {
      try {
        await api_fetch('/api/tasks/export-translation', {})
      } catch {
        return
      }
      return
    }

    if (current_dialog_state.kind === 'close-project') {
      set_is_mutation_running(true)
      try {
        const payload = await api_fetch<{ project?: { path?: string; loaded?: boolean } }>('/api/project/unload', {})
        set_project_snapshot({
          path: String(payload.project?.path ?? ''),
          loaded: Boolean(payload.project?.loaded),
        })
        set_snapshot(EMPTY_SNAPSHOT)
        set_entries([])
        set_selected_entry_id(null)
        await refresh_task()
        await raw_analysis_task_runtime.refresh_analysis_task_snapshot()
      } catch {
        return
      } finally {
        set_is_mutation_running(false)
      }
    }
  }

  function close_dialog(): void {
    set_dialog_state(close_dialog_state())
  }

  const translation_task_runtime = useMemo<TranslationTaskRuntime>(() => {
    return {
      ...raw_translation_task_runtime,
      open_translation_detail_sheet: () => {
        raw_analysis_task_runtime.close_analysis_detail_sheet()
        raw_translation_task_runtime.open_translation_detail_sheet()
      },
    }
  }, [raw_analysis_task_runtime, raw_translation_task_runtime])

  const analysis_task_runtime = useMemo<AnalysisTaskRuntime>(() => {
    return {
      ...raw_analysis_task_runtime,
      open_analysis_detail_sheet: () => {
        raw_translation_task_runtime.close_translation_detail_sheet()
        raw_analysis_task_runtime.open_analysis_detail_sheet()
      },
    }
  }, [raw_analysis_task_runtime, raw_translation_task_runtime])

  return {
    stats,
    translation_task_runtime,
    analysis_task_runtime,
    active_workbench_task_view,
    active_workbench_task_summary,
    active_workbench_task_detail,
    translation_task_confirm_dialog,
    analysis_task_confirm_dialog,
    entries,
    selected_entry_id,
    readonly,
    can_edit_files,
    can_export_translation,
    can_close_project,
    dialog_state,
    select_entry,
    request_add_file,
    request_export_translation,
    request_close_project,
    request_reset_file,
    request_delete_file,
    request_replace_file,
    request_reorder_entries,
    confirm_dialog,
    close_dialog,
  }
}

