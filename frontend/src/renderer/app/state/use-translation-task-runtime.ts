import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'

import { api_fetch } from '@/app/desktop-api'
import type {
  ProjectPagesBarrierCheckpoint,
  ProjectPagesBarrierKind,
} from '@/app/state/project-pages-barrier'
import { WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS } from '@/app/state/workbench-progress-constants'
import { useDesktopRuntime } from '@/app/state/use-desktop-runtime'
import { useDesktopToast } from '@/app/state/use-desktop-toast'
import { useI18n } from '@/i18n'
import {
  append_workbench_waveform_sample,
  decay_workbench_waveform_sample,
  has_unsettled_workbench_waveform_tail,
} from '@/lib/workbench-waveform'
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

type TranslationTaskRuntimeOptions = {
  createProjectPagesBarrierCheckpoint?: () => ProjectPagesBarrierCheckpoint
  waitForProjectPagesBarrier?: (
    kind: Exclude<ProjectPagesBarrierKind, 'project_warmup'>,
    options?: { checkpoint?: ProjectPagesBarrierCheckpoint | null },
  ) => Promise<void>
}

export type TranslationTaskRuntime = {
  translation_task_display_snapshot: TranslationTaskSnapshot | null
  translation_task_metrics: TranslationTaskMetrics
  translation_waveform_history: number[]
  translation_detail_sheet_open: boolean
  task_confirm_state: TranslationTaskConfirmState | null
  translation_task_menu_disabled: boolean
  translation_task_menu_busy: boolean
  open_translation_detail_sheet: () => void
  close_translation_detail_sheet: () => void
  request_start_or_continue_translation: () => Promise<void>
  request_task_action_confirmation: (kind: TranslationTaskActionKind) => void
  confirm_task_action: () => Promise<void>
  close_task_action_confirmation: () => void
}

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
  }
}

function has_translation_waveform_progress_changed(
  previous_snapshot: TranslationTaskSnapshot,
  next_snapshot: TranslationTaskSnapshot,
): boolean {
  if (previous_snapshot.total_output_tokens !== next_snapshot.total_output_tokens) {
    return true
  }
  if (previous_snapshot.line !== next_snapshot.line) {
    return true
  }
  if (previous_snapshot.processed_line !== next_snapshot.processed_line) {
    return true
  }
  if (previous_snapshot.error_line !== next_snapshot.error_line) {
    return true
  }

  return false
}

function resolve_translation_waveform_sample(args: {
  previous_snapshot: TranslationTaskSnapshot | null
  previous_time: number | null
  next_snapshot: TranslationTaskSnapshot
  next_metrics: TranslationTaskMetrics
  next_now_seconds: number
}): number {
  if (args.previous_snapshot === null || args.previous_time === null) {
    return args.next_metrics.average_output_speed
  }

  if (!has_translation_waveform_progress_changed(args.previous_snapshot, args.next_snapshot)) {
    return 0
  }

  const elapsed_seconds = Math.max(0.001, args.next_now_seconds - args.previous_time)
  const output_token_delta = Math.max(
    0,
    args.next_snapshot.total_output_tokens - args.previous_snapshot.total_output_tokens,
  )

  return output_token_delta / elapsed_seconds
}

function resolve_translation_terminal_feedback_message(args: {
  previous_status: string
  next_status: string
  has_result: boolean
  t: ReturnType<typeof useI18n>['t']
}): string | null {
  if (args.previous_status === 'STOPPING' && args.next_status !== 'STOPPING') {
    return args.t('proofreading_page.feedback.translation_task_stopped')
  }

  if (!is_active_translation_task_status(args.previous_status) || args.previous_status === 'STOPPING') {
    return null
  }

  if (args.next_status === 'DONE' || (args.next_status === 'IDLE' && args.has_result)) {
    return args.t('proofreading_page.feedback.translation_task_done')
  }

  return null
}

export function useTranslationTaskRuntime(
  options: TranslationTaskRuntimeOptions = {},
): TranslationTaskRuntime {
  const { t } = useI18n()
  const { push_toast } = useDesktopToast()
  const {
    project_snapshot,
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
  const previous_translation_status_ref = useRef(create_empty_translation_task_snapshot().status)
  const observed_translation_waveform_snapshot_ref = useRef<TranslationTaskSnapshot | null>(null)
  const observed_translation_waveform_time_ref = useRef<number | null>(null)
  const current_translation_waveform_sample_ref = useRef(0)

  const translation_task_display_snapshot = useMemo(() => {
    return resolve_translation_task_display_snapshot({
      current_snapshot: translation_task_snapshot,
      last_snapshot: last_translation_task_snapshot,
    })
  }, [last_translation_task_snapshot, translation_task_snapshot])

  const translation_task_menu_busy = task_confirm_state !== null
    && task_confirm_state.submitting
  const translation_task_menu_disabled = !project_snapshot.loaded
    || task_snapshot.busy
    || translation_task_menu_busy
  const can_open_translation_detail_sheet = project_snapshot.loaded
  const translation_task_active = is_active_translation_task_status(
    translation_task_snapshot.status,
  )
  const has_unsettled_translation_waveform_tail = useMemo(() => {
    return has_unsettled_workbench_waveform_tail(translation_waveform_history)
  }, [translation_waveform_history])
  const should_animate_translation_waveform = translation_task_active
    || has_unsettled_translation_waveform_tail

  const reset_translation_waveform_observation = useCallback((): void => {
    observed_translation_waveform_snapshot_ref.current = null
    observed_translation_waveform_time_ref.current = null
  }, [])

  const clear_translation_waveform_sampling = useCallback((): void => {
    reset_translation_waveform_observation()
    current_translation_waveform_sample_ref.current = 0
  }, [reset_translation_waveform_observation])

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

    if (next_visual_snapshot === null) {
      return
    }

    const previous_observed_snapshot = observed_translation_waveform_snapshot_ref.current
    const previous_observed_time = observed_translation_waveform_time_ref.current
    if (translation_task_active) {
      const has_progress_delta = previous_observed_snapshot !== null
        && previous_observed_time !== null
        && has_translation_waveform_progress_changed(previous_observed_snapshot, next_visual_snapshot)

      if (previous_observed_snapshot === null || previous_observed_time === null) {
        current_translation_waveform_sample_ref.current = next_metrics.average_output_speed
        observed_translation_waveform_snapshot_ref.current = next_visual_snapshot
        observed_translation_waveform_time_ref.current = next_now_seconds
      } else if (has_progress_delta) {
        current_translation_waveform_sample_ref.current = resolve_translation_waveform_sample({
          previous_snapshot: previous_observed_snapshot,
          previous_time: previous_observed_time,
          next_snapshot: next_visual_snapshot,
          next_metrics,
          next_now_seconds,
        })
        observed_translation_waveform_snapshot_ref.current = next_visual_snapshot
        observed_translation_waveform_time_ref.current = next_now_seconds
      }

      // 为什么：运行态两帧之间没有新数据时，要保留上一跳高度，视觉上才能保持连续扫屏。
      set_translation_waveform_history((previous_history) => {
        return append_workbench_waveform_sample(
          previous_history,
          current_translation_waveform_sample_ref.current,
        )
      })
      return
    }

    current_translation_waveform_sample_ref.current = decay_workbench_waveform_sample(
      current_translation_waveform_sample_ref.current,
    )

    // 为什么：任务结束后不再生成新峰值，只让旧波形带着衰减尾巴继续向前推进，直到视窗归零。
    set_translation_waveform_history((previous_history) => {
      return append_workbench_waveform_sample(
        previous_history,
        current_translation_waveform_sample_ref.current,
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
    clear_translation_waveform_sampling()
    set_translation_waveform_history([])
    set_translation_detail_sheet_open(false)
    set_task_confirm_state(null)
  }, [clear_translation_waveform_sampling])

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
      clear_translation_waveform_sampling()
      set_translation_waveform_history([])
      set_translation_detail_sheet_open(false)
    }
  }, [clear_translation_waveform_sampling])

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
        '/api/v2/tasks/snapshot',
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
        '/api/v2/tasks/start-translation',
        { mode: should_continue ? 'CONTINUE' : 'NEW' },
      )
      const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
      apply_translation_task_snapshot(next_snapshot)
      sync_runtime_task_snapshot(next_snapshot)

      if (!should_continue) {
        set_last_translation_task_snapshot(null)
        clear_translation_waveform_sampling()
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
    clear_translation_waveform_sampling,
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

      if (previous_state.submitting) {
        return previous_state
      }

      return null
    })
  }, [])

  const confirm_task_action = useCallback(async (): Promise<void> => {
    if (task_confirm_state === null) {
      return
    }

    const barrierCheckpoint = options.createProjectPagesBarrierCheckpoint?.() ?? null

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
          '/api/v2/tasks/stop-translation',
          {},
        )
        const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
        apply_translation_task_snapshot(next_snapshot)
        sync_runtime_task_snapshot(next_snapshot)
        set_task_confirm_state(null)
      } else {
        const reset_path = task_confirm_state.kind === 'reset-all'
          ? '/api/v2/tasks/reset-translation-all'
          : '/api/v2/tasks/reset-translation-failed'
        const task_payload = await api_fetch<TranslationTaskCommandPayload>(reset_path, {})
        const next_snapshot = normalize_translation_task_snapshot_payload(task_payload)
        apply_translation_task_snapshot(next_snapshot)
        sync_runtime_task_snapshot(next_snapshot)
        if (options.waitForProjectPagesBarrier !== undefined) {
          await options.waitForProjectPagesBarrier('proofreading_cache_refresh', {
            checkpoint: barrierCheckpoint,
          })
        }
        set_task_confirm_state(null)
      }
    } catch (error) {
      let fallback_message = t('proofreading_page.feedback.translation_task_stop_failed')

      if (task_confirm_state.kind === 'reset-all') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_all_failed')
      } else if (task_confirm_state.kind === 'reset-failed') {
        fallback_message = t('proofreading_page.feedback.translation_task_reset_failed_failed')
      }

      push_toast('error', resolve_error_message(error, fallback_message))
      set_task_confirm_state((previous_state) => {
        if (previous_state === null) {
          return null
        }

        return {
          ...previous_state,
          submitting: false,
        }
      })
    }
  }, [
    apply_translation_task_snapshot,
    options,
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
    if (task_snapshot.task_type !== 'translation') {
      return
    }

    apply_translation_task_snapshot(normalize_translation_task_snapshot_payload({
      task: task_snapshot,
    }))
  }, [apply_translation_task_snapshot, task_snapshot])

  useEffect(() => {
    const previous_status = previous_translation_status_ref.current
    const next_status = translation_task_snapshot.status
    previous_translation_status_ref.current = next_status

    if (!project_snapshot.loaded) {
      return
    }

    // 为什么：toast 只应该响应一次真实的生命周期跃迁，不能被首屏 hydration 或快照重刷重复触发。
    const feedback_message = resolve_translation_terminal_feedback_message({
      previous_status,
      next_status,
      has_result: has_translation_task_progress(translation_task_display_snapshot),
      t,
    })

    if (feedback_message !== null) {
      push_toast('success', feedback_message)
    }
  }, [
    project_snapshot.loaded,
    push_toast,
    t,
    translation_task_display_snapshot,
    translation_task_snapshot.status,
  ])

  useEffect(() => {
    if (translation_task_active) {
      return
    }

    // 为什么：结束态仍然要对齐最终指标，但波形采样只保留最后一跳，然后交给衰减尾巴继续前推。
    const next_now_seconds = Date.now() / 1000
    const next_visual_snapshot = translation_task_display_snapshot === null
      ? null
      : clone_translation_task_snapshot(translation_task_display_snapshot)
    set_translation_task_metrics(resolve_translation_task_metrics({
      snapshot: next_visual_snapshot,
      now_seconds: next_now_seconds,
    }))
    reset_translation_waveform_observation()
  }, [
    reset_translation_waveform_observation,
    translation_task_active,
    translation_task_display_snapshot,
  ])

  useEffect(() => {
    if (!should_animate_translation_waveform) {
      return
    }

    // 为什么：运行态和收尾态都需要继续推进采样，前者保持连贯，后者负责把尾巴渐渐扫干净。
    append_translation_waveform_sample()
    const timer_id = window.setInterval(() => {
      append_translation_waveform_sample()
    }, WORKBENCH_PROGRESS_UI_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer_id)
    }
  }, [should_animate_translation_waveform])

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
      open_translation_detail_sheet,
      close_translation_detail_sheet,
      request_start_or_continue_translation,
      request_task_action_confirmation,
      confirm_task_action,
      close_task_action_confirmation,
    }
  }, [
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
