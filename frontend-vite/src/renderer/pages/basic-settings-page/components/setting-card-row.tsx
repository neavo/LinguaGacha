import type { ReactNode } from 'react'

import { Card, CardContent } from '@/ui/card'
import { cn } from '@/lib/utils'

type SettingCardRowProps = {
  title: string
  description: string
  action: ReactNode
  status_text?: string
  className?: string
}

export function SettingCardRow(props: SettingCardRowProps): JSX.Element {
  return (
    <Card className={cn('basic-settings-page__card', props.className)}>
      <CardContent className="basic-settings-page__card-content">
        <div className="basic-settings-page__card-copy">
          <div className="basic-settings-page__card-heading">
            <h2 className="basic-settings-page__card-title">{props.title}</h2>
            {props.status_text !== undefined
              ? <span className="basic-settings-page__card-status">{props.status_text}</span>
              : null}
          </div>
          <p className="basic-settings-page__card-description">{props.description}</p>
        </div>

        <div className="basic-settings-page__card-action">
          {props.action}
        </div>
      </CardContent>
    </Card>
  )
}
