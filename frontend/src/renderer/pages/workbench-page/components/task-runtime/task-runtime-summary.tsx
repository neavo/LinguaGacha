import './task-runtime.css'

import { cn } from '@/lib/utils'
import type {
  WorkbenchTaskSummaryViewModel,
  WorkbenchTaskTone,
} from '@/pages/workbench-page/types'
import { Badge } from '@/shadcn/badge'
import { Spinner } from '@/shadcn/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'

type TaskRuntimeSummaryProps = {
  class_name?: string
  view_model: WorkbenchTaskSummaryViewModel
  can_open: boolean
  on_open: () => void
}

function resolve_summary_badge_tone_class_name(tone: WorkbenchTaskTone): string {
  if (tone === 'warning') {
    return 'task-runtime__summary-badge--warning'
  }

  if (tone === 'success') {
    return 'task-runtime__summary-badge--success'
  }

  return 'task-runtime__summary-badge--neutral'
}

export function TaskRuntimeSummary(
  props: TaskRuntimeSummaryProps,
): JSX.Element {
  const summary_badge = (
    <Badge
      variant="outline"
      className={cn(
        'task-runtime__summary',
        'task-runtime__summary-badge',
        props.class_name,
        props.can_open ? 'task-runtime__summary-badge--clickable' : null,
        resolve_summary_badge_tone_class_name(props.view_model.tone),
      )}
    >
      {props.view_model.show_spinner ? <Spinner data-icon="inline-start" /> : null}
      <span>{props.view_model.status_text}</span>
      {props.view_model.trailing_text !== null
        ? (
            <span className="task-runtime__summary-trailing">
              {props.view_model.trailing_text}
            </span>
          )
        : null}
    </Badge>
  )

  if (!props.can_open) {
    return summary_badge
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="task-runtime__summary-trigger"
          onClick={props.on_open}
        >
          {summary_badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{props.view_model.detail_tooltip_text}</p>
      </TooltipContent>
    </Tooltip>
  )
}
