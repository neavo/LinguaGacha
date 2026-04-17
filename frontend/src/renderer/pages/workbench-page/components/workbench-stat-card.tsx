import { ArrowLeftRight } from 'lucide-react'

import { Card, CardContent, CardTitle } from '@/shadcn/card'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shadcn/tooltip'

type WorkbenchStatCardProps = {
  title: string
  value: number
  unit: string
  accent?: 'success' | 'warning' | 'failure'
  toggle_tooltip?: string
  on_toggle?: () => void
}

export function WorkbenchStatCard(props: WorkbenchStatCardProps): JSX.Element {
  const is_toggleable = props.on_toggle !== undefined

  const card = (
    <Card className="workbench-page__stat-card">
      <CardContent className="workbench-page__stat-card-content">
        <div className="workbench-page__stat-card-stack">
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--title">
            <CardTitle className="workbench-page__stat-card-title">{props.title}</CardTitle>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--value">
            <div className="workbench-page__stat-card-metric">
              <p
                className={cn(
                  'workbench-page__stat-card-value',
                  props.accent === 'success' && 'workbench-page__stat-card-value--success',
                  props.accent === 'warning' && 'workbench-page__stat-card-value--warning',
                  props.accent === 'failure' && 'workbench-page__stat-card-value--failure',
                )}
              >
                {props.value.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="workbench-page__stat-card-frame workbench-page__stat-card-frame--unit">
            <div className="workbench-page__stat-card-unit-row">
              <span className="workbench-page__stat-card-unit">{props.unit}</span>
              {is_toggleable
                ? <ArrowLeftRight className="workbench-page__stat-card-toggle-icon" aria-hidden="true" />
                : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  if (!is_toggleable || props.toggle_tooltip === undefined) {
    return card
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="workbench-page__stat-card-trigger"
          role="button"
          tabIndex={0}
          onClick={props.on_toggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.on_toggle?.()
            }
          }}
        >
          {card}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{props.toggle_tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

