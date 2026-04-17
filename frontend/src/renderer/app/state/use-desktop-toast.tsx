/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { toast, type ExternalToast } from 'sonner'
import { ProgressToastRing } from '@/widgets/progress-toast-ring/progress-toast-ring'

type DesktopToastKind = 'info' | 'warning' | 'error' | 'success'

type DesktopToastId = string | number

type ProgressToastPresentation = 'inline' | 'modal'

type ProgressToastOptions = {
  message: string
  progress_percent?: number
  presentation?: ProgressToastPresentation
}

type ProgressToastState = {
  owner_token: DesktopToastId
  message: string
  progress_percent?: number
  presentation: ProgressToastPresentation
  dismiss_timer: ReturnType<typeof setTimeout> | null
}

type DesktopToastApi = {
  push_toast: (kind: DesktopToastKind, message: string) => DesktopToastId
  push_progress_toast: (options: ProgressToastOptions) => DesktopToastId
  update_progress_toast: (toast_id: DesktopToastId, options: ProgressToastOptions) => DesktopToastId
  dismiss_toast: (toast_id?: DesktopToastId) => void
}

const PROGRESS_TOAST_DISMISS_DELAY_MS = 1500
const PROGRESS_TOAST_SONNER_ID = 'desktop-progress-toast'
const regular_toast_id_set = new Set<DesktopToastId>()
const progress_toast_modal_listener_set = new Set<() => void>()
let progress_toast_state: ProgressToastState | null = null
let progress_toast_owner_token_seed = 0

function resolve_toast_sender(kind: DesktopToastKind): (message: string, options?: ExternalToast) => DesktopToastId {
  if (kind === 'success') {
    return toast.success
  }

  if (kind === 'warning') {
    return toast.warning
  }

  if (kind === 'error') {
    return toast.error
  }

  return toast.info
}

function normalize_toast_message(message: string): string {
  // 所有通知统一只保留单行标题，避免普通 toast 和进度 toast 再次分叉成双行模型。
  return message.replaceAll(/\s*[\r\n]+\s*/g, ' ').trim()
}

function emit_progress_toast_modal_change(): void {
  for (const listener of progress_toast_modal_listener_set) {
    listener()
  }
}

function read_progress_toast_modal_active(): boolean {
  return progress_toast_state?.presentation === 'modal'
}

function subscribe_progress_toast_modal(listener: () => void): () => void {
  progress_toast_modal_listener_set.add(listener)

  return () => {
    progress_toast_modal_listener_set.delete(listener)
  }
}

function build_progress_toast_config(options: ProgressToastOptions, toast_id?: DesktopToastId): ExternalToast {
  const presentation = options.presentation ?? 'inline'
  return {
    id: toast_id,
    description: undefined,
    icon: <ProgressToastRing progress_percent={options.progress_percent} />,
    position: 'bottom-center',
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    closeButton: false,
    classNames: {
      toast: [
        'cn-toast',
        'cn-toast--progress',
        presentation === 'modal' ? 'cn-toast--progress-modal' : null,
      ].filter((value) => value !== null).join(' '),
    },
  }
}

function create_progress_toast_owner_token(): DesktopToastId {
  progress_toast_owner_token_seed += 1
  return progress_toast_owner_token_seed
}

function render_progress_toast(options: ProgressToastOptions): void {
  toast(options.message, build_progress_toast_config(options, PROGRESS_TOAST_SONNER_ID))
}

function sync_progress_toast_state(owner_token: DesktopToastId, options: ProgressToastOptions): void {
  const previous_state = progress_toast_state

  if (previous_state?.dismiss_timer != null) {
    clearTimeout(previous_state.dismiss_timer)
  }

  const normalized_message = normalize_toast_message(options.message)
  const presentation = options.presentation ?? 'inline'
  progress_toast_state = {
    owner_token,
    message: normalized_message,
    progress_percent: options.progress_percent,
    presentation,
    dismiss_timer: null,
  }
  render_progress_toast({
    message: normalized_message,
    progress_percent: options.progress_percent,
    presentation,
  })
  emit_progress_toast_modal_change()
}

function schedule_progress_toast_dismiss(owner_token: DesktopToastId): void {
  const current_progress_state = progress_toast_state

  if (current_progress_state === null || current_progress_state.owner_token !== owner_token) {
    return
  }

  if (current_progress_state.dismiss_timer != null) {
    clearTimeout(current_progress_state.dismiss_timer)
  }

  if (current_progress_state.presentation === 'modal') {
    progress_toast_state = null
    toast.dismiss(PROGRESS_TOAST_SONNER_ID)
    emit_progress_toast_modal_change()
    return
  }

  if (current_progress_state.progress_percent !== undefined) {
    render_progress_toast({
      message: current_progress_state.message,
      progress_percent: undefined,
      presentation: current_progress_state.presentation,
    })
    current_progress_state.progress_percent = undefined
  }

  current_progress_state.dismiss_timer = setTimeout(() => {
    if (progress_toast_state?.owner_token !== owner_token) {
      return
    }

    progress_toast_state = null
    toast.dismiss(PROGRESS_TOAST_SONNER_ID)
    emit_progress_toast_modal_change()
  }, PROGRESS_TOAST_DISMISS_DELAY_MS)
}

export function DesktopProgressToastModalLayer(): JSX.Element | null {
  const modal_active = useSyncExternalStore(
    subscribe_progress_toast_modal,
    read_progress_toast_modal_active,
    () => false,
  )

  if (!modal_active) {
    return null
  }

  return (
    <div
      className="cn-progress-toast-modal-layer"
      aria-hidden="true"
    />
  )
}

export function useDesktopToast(): DesktopToastApi {
  const push_toast = useCallback((kind: DesktopToastKind, message: string): DesktopToastId => {
    const send_toast = resolve_toast_sender(kind)
    const toast_id = send_toast(normalize_toast_message(message))
    regular_toast_id_set.add(toast_id)
    return toast_id
  }, [])

  const push_progress_toast = useCallback((options: ProgressToastOptions): DesktopToastId => {
    const owner_token = create_progress_toast_owner_token()
    const normalized_options: ProgressToastOptions = {
      message: normalize_toast_message(options.message),
      progress_percent: options.progress_percent,
      presentation: options.presentation,
    }
    sync_progress_toast_state(owner_token, normalized_options)
    return owner_token
  }, [])

  const update_progress_toast = useCallback((
    toast_id: DesktopToastId,
    options: ProgressToastOptions,
  ): DesktopToastId => {
    if (progress_toast_state === null || progress_toast_state.owner_token !== toast_id) {
      return toast_id
    }

    const normalized_options: ProgressToastOptions = {
      message: normalize_toast_message(options.message),
      progress_percent: options.progress_percent,
      presentation: options.presentation,
    }
    sync_progress_toast_state(toast_id, normalized_options)
    return toast_id
  }, [])

  const dismiss_toast = useCallback((toast_id?: DesktopToastId): void => {
    if (toast_id === undefined) {
      for (const regular_toast_id of regular_toast_id_set) {
        toast.dismiss(regular_toast_id)
      }
      regular_toast_id_set.clear()

      if (progress_toast_state !== null) {
        schedule_progress_toast_dismiss(progress_toast_state.owner_token)
      }
    } else if (progress_toast_state?.owner_token === toast_id) {
      schedule_progress_toast_dismiss(toast_id)
    } else {
      regular_toast_id_set.delete(toast_id)
      toast.dismiss(toast_id)
    }
  }, [])

  // Why: 页面里的 useEffect / useCallback 会把 toast API 放进依赖数组，
  // 如果这里每次渲染都返回新函数，就会把“首次刷新”误变成持续重跑。
  return useMemo<DesktopToastApi>(() => {
    return {
      push_toast,
      push_progress_toast,
      update_progress_toast,
      dismiss_toast,
    }
  }, [
    dismiss_toast,
    push_progress_toast,
    push_toast,
    update_progress_toast,
  ])
}

