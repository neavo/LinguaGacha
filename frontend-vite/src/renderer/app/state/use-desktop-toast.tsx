import { toast, type ExternalToast } from 'sonner'
import { ProgressToastRing } from '@/ui/progress-toast-ring'

type DesktopToastKind = 'info' | 'warning' | 'error' | 'success'

type DesktopToastId = string | number

type ProgressToastOptions = {
  message: string
  progress_percent?: number
}

type ProgressToastState = {
  owner_token: DesktopToastId
  message: string
  progress_percent?: number
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

function build_progress_toast_config(options: ProgressToastOptions, toast_id?: DesktopToastId): ExternalToast {
  return {
    id: toast_id,
    description: undefined,
    icon: <ProgressToastRing progress_percent={options.progress_percent} />,
    position: 'bottom-center',
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    closeButton: false,
    classNames: {
      toast: 'cn-toast cn-toast--progress',
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

  progress_toast_state = {
    owner_token,
    message: normalize_toast_message(options.message),
    progress_percent: options.progress_percent,
    dismiss_timer: null,
  }
  render_progress_toast({
    message: normalize_toast_message(options.message),
    progress_percent: options.progress_percent,
  })
}

function schedule_progress_toast_dismiss(owner_token: DesktopToastId): void {
  const current_progress_state = progress_toast_state

  if (current_progress_state === null || current_progress_state.owner_token !== owner_token) {
    return
  }

  if (current_progress_state.dismiss_timer != null) {
    clearTimeout(current_progress_state.dismiss_timer)
  }

  if (current_progress_state.progress_percent !== undefined) {
    render_progress_toast({
      message: current_progress_state.message,
      progress_percent: undefined,
    })
    current_progress_state.progress_percent = undefined
  }

  current_progress_state.dismiss_timer = setTimeout(() => {
    if (progress_toast_state?.owner_token !== owner_token) {
      return
    }

    progress_toast_state = null
    toast.dismiss(PROGRESS_TOAST_SONNER_ID)
  }, PROGRESS_TOAST_DISMISS_DELAY_MS)
}

export function useDesktopToast(): DesktopToastApi {
  function push_toast(kind: DesktopToastKind, message: string): DesktopToastId {
    const send_toast = resolve_toast_sender(kind)
    const toast_id = send_toast(normalize_toast_message(message))
    regular_toast_id_set.add(toast_id)
    return toast_id
  }

  function push_progress_toast(options: ProgressToastOptions): DesktopToastId {
    const owner_token = create_progress_toast_owner_token()
    const normalized_options: ProgressToastOptions = {
      message: normalize_toast_message(options.message),
      progress_percent: options.progress_percent,
    }
    sync_progress_toast_state(owner_token, normalized_options)
    return owner_token
  }

  function update_progress_toast(toast_id: DesktopToastId, options: ProgressToastOptions): DesktopToastId {
    if (progress_toast_state === null || progress_toast_state.owner_token !== toast_id) {
      return toast_id
    }

    const normalized_options: ProgressToastOptions = {
      message: normalize_toast_message(options.message),
      progress_percent: options.progress_percent,
    }
    sync_progress_toast_state(toast_id, normalized_options)
    return toast_id
  }

  function dismiss_toast(toast_id?: DesktopToastId): void {
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
  }

  return {
    push_toast,
    push_progress_toast,
    update_progress_toast,
    dismiss_toast,
  }
}
