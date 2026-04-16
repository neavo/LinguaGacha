import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'

import { api_fetch } from '@/app/desktop-api'
import { WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS } from '@/app/state/workbench-progress-constants'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import {
  clone_translation_task_snapshot,
  create_empty_translation_task_snapshot,
  has_translation_task_progress,
  is_active_translation_task_status,
  normalize_translation_task_snapshot_payload,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
  type TranslationTaskActionKind,
  type TranslationTaskConfirmState,
  type TranslationTaskMetrics,
  type TranslationTaskPayload,
  type TranslationTaskSnapshot,
} from '@/lib/translation-task'

type TranslationTaskCommandPayload = {
  task?: Partial<TranslationTaskSnapshot>
}

export type TranslationTaskRuntime = {
  translation_task_display_snapshot: TranslationTaskSnapshot | null
  translation_task_metrics: TranslationTaskMetrics
  translation_waveform_history: number[]
  translation_detail_sheet_open: boolean
  task_confirm_state: TranslationTaskConfirmState | null
  translation_task_menu_disabled: boolean
  translation_task_menu_busy: boolean
  can_open_translation_detail_sheet: boolean
  open_translation_detail_sheet: () => void
  close_translation_detail_sheet: () => void
  request_start_or_continue_translation: () => Promise<void>
  request_task_action_confirmation: (kind: TranslationTaskActionKind) => void
  confirm_task_action: () => Promise<void>
  close_task_action_confirmation: () => void
}

const TRANSLATION_WAVEFORM_MAX_POINTS = 256

function resolve_error_message(error: unknown, fallback_message: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return fallback_message
}

function create_task_confirm_state(
  kind: TranslationTaskActionKind,
): TranslationTaskConfirmState {
  return {
    kind,
    open: true,
    submitting: false,
    awaiting_refresh: false,
  }
}

function append_waveform_sample(history: number[], sample: number): number[] {
  const next_history = [...history, Number.isFinite(sample) ? sample : 0]
  if (next_history.length > TRANSLATION_WAVEFORM_MAX_POINTS) {
    return next_history.slice(next_history.length - TRANSLATION_WAVEFORM_MAX_POINTS)
  }

  return next_history
}

export function useTranslationTaskRuntime(): TranslationTaskRuntime {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const {
    project_snapshot,
    proofreading_invalidation_tick,
    set_task_snapshot,
    task_snapshot,
  } = useDesktopRuntime()
  const [translation_task_snapshot, set_translation_task_snapshot] = useState<TranslationTaskSnapshot>(() => {
    return create_empty_translation_task_snapshot()
  })
  const [last_translation_task_snapshot, set_last_translation_task_snapshot] = useState<TranslationTaskSnapshot | null>(null)
  const [translation_task_metrics, set_translation_task_metrics] = useState<TranslationTaskMetrics>(() => {
    return resolve_translation_task_metrics({
      snapshot: null,
      now_seconds: 0,
    })
  })
  const [translation_waveform_history, set_translation_waveform_history] = useState<number[]>([])
  const [translation_detail_sheet_open, set_translation_detail_sheet_open] = useState(false)
  const [task_confirm_state, set_task_confirm_state] = useState<TranslationTaskConfirmState | null>(null)
  const previous_project_loaded_ref = useRef(false)
  const previous_project_path_ref = useRef('')
  const previous_task_busy_ref = useRef(task_snapshot.busy)
  const previous_invalidation_tick_ref = useRef(proofreading_invalidation_tick)

  const translation_task_display_snapshot = useMemo(() => {
    return resolve_translation_task_display_snapshot({
      current_snapshot: translation_task_snapshot,
      last_snapshot: last_translation_task_snapshot,
    })
  }, [last_translation_task_snapshot, translation_task_snapshot])

  const translation_task_menu_busy = task_confirm_state !== null
    && (task_confirm_state.submitting || task_confirm_state.awaiting_refresh)
  const translation_task_menu_disabled = !project_snapshot.loaded
    || task_snapshot.busy
    || translation_task_menu_busy
  const can_open_translation_detail_sheet = project_snapshot.loaded
  const translation_task_active = is_active_translation_task_status(
    translation_task_snapshot.status,
  )

  const append_translation_waveform_sample = useEffectEvent((): void => {
    const next_now_seconds = Date.now() / 1000
    const next_visual_snapshot = translation_task_display_snapshot === null
      ? null
      : clone_translation_task_snapshot(translation_task_display_snapshot)
    const next_metrics = resolve_translation_task_metrics({
      snapshot: next_visual_snapshot,
      now_seconds: next_now_seconds,
    })
    set_translation_task_metrics(next_metrics)
    set_translation_waveform_history((previous_history) => {
      return append_waveform_sample(
        previous_history,
        next_metrics.average_output_speed,
      )
    })
  })

  const clear_translation_task_state = useCallback((): void => {
    set_translation_task_snapshot(create_empty_translation_task_snapshot())
    set_last_translation_task_snapshot(null)
    set_translation_task_metrics(resolve_translation_task_metrics({
      snapshot: null,
      now_seconds: 0,
    }))
    set_translation_waveform_history([])
    set_translation_detail_sheet_open(false)
    set_task_confirm_state(null)
  }, [])

  const apply_translation_task_snapshot = useCallback((
    next_snapshot: TranslationTaskSnapshot,
  ): void => {
    const normalized_snapshot = clone_translation_task_snapshot(next_snapshot)
    set_translation_task_snapshot(normalized_snapshot)

    if (is_active_translation_task_status(normalized_snapshot.status)) {
      return
    }

    if (has_translation_task_progress(normalized_snapshot)) {
      set_last_translation_task_snapshot(clone_translation_task_snapshot(normalized_snapshot))
    } else {
      set_last_translation_task_snapshot(null)
      set_translation_waveform_history([])
      set_translation_detail_sheet_open(false)
    }
  }, [])

  const sync_runtime_task_snapshot = useCallback((
    next_snapshot: TranslationTaskSnapshot,
  ): void => {
    set_task_snapshot({
      task_type: next_snapshot.task_type,
      status: next_snapshot.status,
      busy: next_snapshot.busy,
      request_in_flight_count: next_snapshot.request_in_flight_count,
      line: next_snapshot.line,
      total_line: next_snapshot.total_line,
      processed_line: next_snapshot.processed_line,
      error_line: next_snapshot.error_line,
      total_tokens: next_snapshot.total_tokens,
      total_output_tokens: next_snapshot.total_output_tokens,
      total_input_tokens: next_snapshot.total_input_tokens,
      time: next_snapshot.time,
      start_time: next_snapshot.start_time,
      analysis_candidate_count: 0,
    })
  }, [set_task_snapshot])

  const refresh_translation_task_snapshot = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded) {
      clear_translation_task_state()
      return
    }

    try {
      const task_payload = await api_fetch<TranslationTaskPayload>(
        '/api/tasks/snapshot',
        { task_type: 'translation' },
      )
      apply_translation_task_snapshot(normalize_translation_task_snapshot_payload(task_payload))
    } catch (error) {
      push_toast(
        'error',
        resolve_error_message(error, t('proofreading_page.feedback.translation_task_refresh_failed')),
      )
    }
  }, [apply_translation_task_snapshot, clear_translation_task_state, project_snapshot.loaded, push_toast, t])

  const open_translation_detail_sheet = useCallback((): void => {
    if (can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(true)
    }
  }, [can_open_translation_detail_sheet])

  const close_translation_detail_sheet = useCallback((): void => {
    set_translation_detail_sheet_open(false)
  }, [])

  const request_start_or_continue_translation = useCallback(async (): Promise<void> => {
    if (!project_snapshot.loaded || task_snapshot.busy || translation_task_menu_busy) {
      return
    }

    const should_continue = has_translation_task_progress(translation_task_display_snapshot)

    try {
      const task_payload = await api_fetch<TranslationTaskCommandPayload>(
        '/api/tasks/start-translation',
        { mode: should_continue ? 'CONTINUE' : 'NEW' },
      )
      const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
      apply_translation_task_snapshot(next_snapshot)
      sync_runtime_task_snapshot(next_snapshot)

      if (!should_continue) {
        set_last_translation_task_snapshot(null)
        set_translation_waveform_history([])
      }
    } catch (error) {
      push_toast(
        'error',
        resolve_error_message(error, t('proofreading_page.feedback.translation_task_start_failed')),
      )
    }
  }, [
    apply_translation_task_snapshot,
    project_snapshot.loaded,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_snapshot.busy,
    translation_task_display_snapshot,
    translation_task_menu_busy,
  ])

  const request_task_action_confirmation = useCallback((
    kind: TranslationTaskActionKind,
  ): void => {
    set_task_confirm_state(create_task_confirm_state(kind))
  }, [])

  const close_task_action_confirmation = useCallback((): void => {
    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null
      }

      if (previous_state.submitting || previous_state.awaiting_refresh) {
        return {
          ...previous_state,
          open: false,
        }
      }

      return null
    })
  }, [])

  const confirm_task_action = useCallback(async (): Promise<void> => {
    if (task_confirm_state === null) {
      return
    }

    set_task_confirm_state((previous_state) => {
      if (previous_state === null) {
        return null
      }

      return {
        ...previous_state,
        submitting: true,
      }
    })

    try {
      if (task_confirm_state.kind === 'stop-translation') {
        const task_payload = await api_fetch<TranslationTaskCommandPayload>(
          '/api/tasks/stop-translation',
          {},
        )
        const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
        apply_translation_task_snapshot(next_snapshot)
        sync_runtime_task_snapshot(next_snapshot)
        set_task_confirm_state(null)
      } else {
        const reset_path = task_confirm_state.kind === 'reset-all'
          ? '/api/tasks/reset-translation-all'
          : '/api/tasks/reset-translation-failed'
        await api_fetch<TranslationTaskCommandPayload>(reset_path, {})
        set_task_confirm_state((previous_state) => {
          if (previous_state === null) {
            return null
          }

          return {
            ...previous_state,
            open: false,
            submitting: false,
            awaiting_refresh: true,
          }
        })
      }
    } catch (error) {
      let fallback_message = t('proofreading_page.feedback.translation_task_stop_failed')

      if (task_confirm_state.kind === 'reset-all') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_all_failed')
      } else if (task_confirm_state.kind === 'reset-failed') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_failed_failed')
      }

      push_toast('error', resolve_error_message(error, fallback_message))
      set_task_confirm_state(null)
    }
  }, [
    apply_translation_task_snapshot,
    push_toast,
    sync_runtime_task_snapshot,
    t,
    task_confirm_state,
  ])

  useEffect(() => {
    const previous_project_loaded = previous_project_loaded_ref.current
    const previous_project_path = previous_project_path_ref.current

    previous_project_loaded_ref.current = project_snapshot.loaded
    previous_project_path_ref.current = project_snapshot.path

    if (!project_snapshot.loaded) {
      clear_translation_task_state()
      return
    }

    if (!previous_project_loaded || previous_project_path !== project_snapshot.path) {
      clear_translation_task_state()
      void refresh_translation_task_snapshot()
    }
  }, [
    clear_translation_task_state,
    project_snapshot.loaded,
    project_snapshot.path,
    refresh_translation_task_snapshot,
  ])

  useEffect(() => {
    const previous_task_busy = previous_task_busy_ref.current
    previous_task_busy_ref.current = task_snapshot.busy

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_task_busy && !task_snapshot.busy) {
      void refresh_translation_task_snapshot()
    }
  }, [project_snapshot.loaded, refresh_translation_task_snapshot, task_snapshot.busy])

  useEffect(() => {
    const previous_tick = previous_invalidation_tick_ref.current
    previous_invalidation_tick_ref.current = proofreading_invalidation_tick

    if (!project_snapshot.loaded) {
      return
    }

    if (previous_tick !== proofreading_invalidation_tick) {
      void (async (): Promise<void> => {
        await refresh_translation_task_snapshot()
        set_task_confirm_state((previous_state) => {
          if (previous_state !== null && previous_state.awaiting_refresh) {
            return null
          }

          return previous_state
        })
      })()
    }
  }, [
    project_snapshot.loaded,
    proofreading_invalidation_tick,
    refresh_translation_task_snapshot,
  ])

  useEffect(() => {
    if (task_snapshot.task_type !== 'translation') {
      return
    }

    apply_translation_task_snapshot(normalize_translation_task_snapshot_payload({
      task: task_snapshot,
    }))
  }, [apply_translation_task_snapshot, task_snapshot])

  useEffect(() => {
    if (translation_task_active) {
      return
    }

    // 为什么：空闲态下不需要继续走定时采样，但最后一次结果也要立刻对齐到显示层。
    const next_now_seconds = Date.now() / 1000
    const next_visual_snapshot = translation_task_display_snapshot === null
      ? null
      : clone_translation_task_snapshot(translation_task_display_snapshot)
    set_translation_task_metrics(resolve_translation_task_metrics({
      snapshot: next_visual_snapshot,
      now_seconds: next_now_seconds,
    }))
  }, [
    translation_task_active,
    translation_task_display_snapshot,
  ])

  useEffect(() => {
    if (!translation_task_active) {
      return
    }

    // 为什么：工作台进度显示统一按 500ms 节拍采样，避免卡片、统计和波形图各跟各的。
    append_translation_waveform_sample()
    const timer_id = window.setInterval(() => {
      append_translation_waveform_sample()
    }, WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer_id)
    }
  }, [translation_task_active])

  useEffect(() => {
    if (!can_open_translation_detail_sheet) {
      set_translation_detail_sheet_open(false)
    }
  }, [can_open_translation_detail_sheet])

  return useMemo<TranslationTaskRuntime>(() => {
    return {
      translation_task_display_snapshot,
      translation_task_metrics,
      translation_waveform_history,
      translation_detail_sheet_open,
      task_confirm_state,
      translation_task_menu_disabled,
      translation_task_menu_busy,
      can_open_translation_detail_sheet,
      open_translation_detail_sheet,
      close_translation_detail_sheet,
      request_start_or_continue_translation,
      request_task_action_confirmation,
      confirm_task_action,
      close_task_action_confirmation,
    }
  }, [
    can_open_translation_detail_sheet,
    close_task_action_confirmation,
    close_translation_detail_sheet,
    confirm_task_action,
    open_translation_detail_sheet,
    request_start_or_continue_translation,
    request_task_action_confirmation,
    task_confirm_state,
    translation_detail_sheet_open,
    translation_task_display_snapshot,
    translation_task_menu_busy,
    translation_task_menu_disabled,
    translation_task_metrics,
    translation_waveform_history,
  ])
}
