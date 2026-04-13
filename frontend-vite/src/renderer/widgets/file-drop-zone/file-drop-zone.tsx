import { type DragEvent, useRef, useState, type ReactNode } from 'react'

import {
  has_path_drop_payload,
  resolve_dropped_path,
} from '@/lib/file-drop'
import { cn } from '@/lib/utils'
import '@/widgets/file-drop-zone/file-drop-zone.css'

export type FileDropIssue = 'multiple' | 'unavailable'

type FileDropZoneProps = {
  label: string
  children: ReactNode
  className?: string
  disabled?: boolean
  on_path_drop: (path: string) => void | Promise<void>
  on_drop_issue?: (issue: FileDropIssue) => void
}


export function FileDropZone(props: FileDropZoneProps): JSX.Element {
  const drag_depth_ref = useRef(0)
  const [drop_active, set_drop_active] = useState(false)

  function reset_drop_state(): void {
    drag_depth_ref.current = 0
    set_drop_active(false)
  }

  function handle_drag_enter(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    drag_depth_ref.current += 1
    set_drop_active(true)
    event.dataTransfer.dropEffect = 'copy'
  }

  function handle_drag_over(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    if (!drop_active) {
      set_drop_active(true)
    }
    event.dataTransfer.dropEffect = 'copy'
  }

  function handle_drag_leave(event: DragEvent<HTMLDivElement>): void {
    if (props.disabled || !has_path_drop_payload(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    drag_depth_ref.current = Math.max(0, drag_depth_ref.current - 1)
    if (drag_depth_ref.current === 0) {
      set_drop_active(false)
    }
  }

  async function handle_drop(event: DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    reset_drop_state()

    if (props.disabled) {
      return
    }

    const dropped_path = resolve_dropped_path(event.dataTransfer)
    if (dropped_path.has_multiple_paths) {
      props.on_drop_issue?.('multiple')
      return
    }

    if (dropped_path.path === null || dropped_path.path === '') {
      props.on_drop_issue?.('unavailable')
      return
    }

    await props.on_path_drop(dropped_path.path)
  }

  return (
    <div
      className={cn('file-drop-zone', props.className)}
      data-drop-active={drop_active ? 'true' : undefined}
      onDragEnter={handle_drag_enter}
      onDragOver={handle_drag_over}
      onDragLeave={handle_drag_leave}
      onDrop={(event) => {
        void handle_drop(event)
      }}
    >
      <div className="file-drop-zone__content">
        {props.children}
      </div>
      <div className="file-drop-zone__overlay" aria-hidden={!drop_active}>
        <p className="file-drop-zone__label" data-ui-text="emphasis">
          {props.label}
        </p>
      </div>
    </div>
  )
}
