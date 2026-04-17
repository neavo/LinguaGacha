import { GripVertical } from 'lucide-react'

import { useI18n } from '@/i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'
import type { AppTableDragHandle } from '@/widgets/app-table/app-table-types'

type AppTableDragIndicatorProps = {
  row_number: string
  can_drag: boolean
  dragging: boolean
  drag_handle: AppTableDragHandle | null
  show_tooltip?: boolean
}

type AppTableDragIndicatorState = 'enabled' | 'disabled' | 'dragging'

function resolve_drag_indicator_state(
  props: AppTableDragIndicatorProps,
): AppTableDragIndicatorState {
  // 为什么：拖拽中的 overlay 没有 handle，但视觉上仍然应该保持“可拖拽中”的手型语义。
  if (props.dragging && props.can_drag) {
    return 'dragging'
  }

  if (props.drag_handle !== null && !props.drag_handle.disabled) {
    return 'enabled'
  }

  return 'disabled'
}

export function AppTableDragIndicator(
  props: AppTableDragIndicatorProps,
): JSX.Element {
  const { t } = useI18n()
  const drag_state = resolve_drag_indicator_state(props)
  const tooltip_label = drag_state === 'disabled'
    ? t('app.drag.disabled')
    : t('app.drag.enabled')
  const drag_handle_attributes = drag_state === 'enabled'
    ? props.drag_handle?.attributes ?? {}
    : {}
  const drag_handle_listeners = drag_state === 'enabled'
    ? props.drag_handle?.listeners ?? {}
    : {}
  const indicator = (
    <div
      className="app-table__drag-indicator"
      data-drag-state={drag_state}
      data-app-table-ignore-box-select="true"
      data-app-table-ignore-row-click="true"
      aria-label={tooltip_label}
      {...drag_handle_attributes}
      {...drag_handle_listeners}
    >
      <span className="app-table__drag-icon" aria-hidden="true">
        <GripVertical />
      </span>
      <span className="app-table__drag-row-index">
        {props.row_number}
      </span>
    </div>
  )

  if (props.show_tooltip === false) {
    return indicator
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {indicator}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{tooltip_label}</p>
      </TooltipContent>
    </Tooltip>
  )
}
