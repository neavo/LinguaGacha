/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'

import { Progress } from '@/ui/progress'
import { toast, type ExternalToast } from 'sonner'

type DesktopToastKind = 'info' | 'warning' | 'error' | 'success'

type DesktopToastId = string | number

type ProgressToastOptions = {
  message: string
  description?: string
  progress_percent?: number
}

type DesktopToastApi = {
  push_toast: (kind: DesktopToastKind, message: string, description?: string) => DesktopToastId
  push_progress_toast: (options: ProgressToastOptions) => DesktopToastId
  update_progress_toast: (toast_id: DesktopToastId, options: ProgressToastOptions) => DesktopToastId
  finish_progress_toast: (
    toast_id: DesktopToastId,
    kind: DesktopToastKind,
    message: string,
    description?: string,
  ) => DesktopToastId
  dismiss_toast: (toast_id?: DesktopToastId) => void
}

function build_progress_value(progress_percent?: number): number {
  if (progress_percent === undefined || Number.isNaN(progress_percent)) {
    return 0
  }

  return Math.max(0, Math.min(100, progress_percent))
}

function ProgressToastContent(props: ProgressToastOptions): JSX.Element {
  const normalized_progress = build_progress_value(props.progress_percent)

  return (
    <div className="cn-progress-toast">
      <div className="cn-progress-toast__head">
        <p className="cn-progress-toast__title">{props.message}</p>
        <span className="cn-progress-toast__value">{Math.round(normalized_progress)}%</span>
      </div>
      {props.description === undefined || props.description === ''
        ? null
        : <p className="cn-progress-toast__description">{props.description}</p>}
      <Progress
        value={normalized_progress}
        className="cn-progress-toast__bar h-1.5 bg-muted"
      />
    </div>
  )
}

function resolve_toast_sender(kind: DesktopToastKind): (message: ReactNode, options?: ExternalToast) => DesktopToastId {
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

export function useDesktopToast(): DesktopToastApi {
  function push_toast(kind: DesktopToastKind, message: string, description?: string): DesktopToastId {
    const send_toast = resolve_toast_sender(kind)
    return send_toast(message, {
      description,
    })
  }

  function push_progress_toast(options: ProgressToastOptions): DesktopToastId {
    return toast.custom(() => {
      return <ProgressToastContent {...options} />
    }, {
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      closeButton: false,
      classNames: {
        toast: 'cn-toast cn-toast--progress',
      },
    })
  }

  function update_progress_toast(toast_id: DesktopToastId, options: ProgressToastOptions): DesktopToastId {
    return toast.custom(() => {
      return <ProgressToastContent {...options} />
    }, {
      id: toast_id,
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
      closeButton: false,
      classNames: {
        toast: 'cn-toast cn-toast--progress',
      },
    })
  }

  function finish_progress_toast(
    toast_id: DesktopToastId,
    kind: DesktopToastKind,
    message: string,
    description?: string,
  ): DesktopToastId {
    const send_toast = resolve_toast_sender(kind)
    return send_toast(message, {
      id: toast_id,
      description,
    })
  }

  function dismiss_toast(toast_id?: DesktopToastId): void {
    toast.dismiss(toast_id)
  }

  return {
    push_toast,
    push_progress_toast,
    update_progress_toast,
    finish_progress_toast,
    dismiss_toast,
  }
}
